from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from hashlib import sha256
from io import BytesIO
from uuid import uuid4

from fixtures.build_samples import COMPANY, XLSX, draft_bill, encoded, master, supplier
from openpyxl import load_workbook
from test_phase_two import finish_queue

API = "/api/v1"
ORIGIN = "http://localhost:3000"


def archive(staff, *, packing=12, missing_ref=False, **metadata):
    response = staff.post(
        f"{API}/intakes/simulate",
        data={"provider_message_id": str(uuid4()), **metadata},
        files=[
            (
                "files",
                (
                    "supplier.xlsx",
                    supplier(packing_quantity=packing, missing_ref=missing_ref),
                    XLSX,
                ),
            ),
            ("files", ("draft.pdf", draft_bill(), "application/pdf")),
        ],
    )
    assert response.status_code == 201
    finish_queue()
    return f"{API}/intakes/{response.json()['case_id']}"


def analysis(staff, path):
    return staff.get(f"{path}/analysis").json()


def save(staff, path, current, previous=None, **extra):
    response = staff.post(
        f"{path}/review",
        json={
            "expected_revision": current["revision"],
            "expected_review_id": previous,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def decision(current, review, notes="Verified against the source files."):
    return {
        "expected_revision": current["revision"],
        "review_id": review["id"] if review else None,
        "notes": notes,
    }


def apply_master(staff, path, current, *, balance="60"):
    response = staff.post(
        f"{API}/cdc/versions",
        data={
            "company": COMPANY,
            "year": "2026",
            "approval_ref": "DEMO-2026",
            "verified": "true",
            "balance_as_of": datetime.now(UTC).date().isoformat(),
        },
        files={"file": ("master.xlsx", master(balance=balance), XLSX)},
    )
    assert response.status_code in {200, 201}, response.text
    assert (
        staff.post(
            f"{path}/cdc-version",
            json={
                "expected_revision": current["revision"],
                "version_id": response.json()["id"],
            },
        ).status_code
        == 202
    )
    finish_queue()
    updated = analysis(staff, path)
    mappings = [
        {"invoice_row": row["invoice_row"], "master_row": row["master_row"]}
        for row in updated["candidates"]
    ]
    assert mappings
    return updated, mappings


def test_approval_updates_existing_draft_once_and_produces_auditable_workbooks(staff, api):
    path = archive(staff)
    case = staff.get(path).json()
    assert case["state"] == "ready_for_approval"
    existing = staff.post(
        f"{API}/imports",
        json={
            "intake_case_id": case["id"],
            "company": COMPANY,
            "invoice_no": "OLD-DRAFT",
        },
    ).json()
    current, mappings = apply_master(staff, path, analysis(staff, path))
    review = save(staff, path, current, mappings=mappings, verify_cdc_mappings=True)
    assert review["ready"]
    payload = decision(current, review)
    assert (
        staff.post(
            f"{path}/approve", json=payload, headers={"Origin": "https://example.invalid"}
        ).status_code
        == 403
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        a, b = executor.map(lambda _: staff.post(f"{path}/approve", json=payload), range(2))
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json()
    assert a.json()["permit_pending"] is None
    assert a.json()["import_id"] == existing["id"]
    record_path = f"{API}/imports/{existing['id']}"
    record = staff.get(record_path).json()
    assert record["state"] == "approved" and record["etd"] is None and record["eta"] is None
    assert record["items"][0]["amount"] == "30.000000"
    assert record["items"][0]["source_document_id"] in {doc["id"] for doc in case["documents"]}
    drafts = staff.get(f"{record_path}/permit-drafts").json()
    assert len(drafts) == 1 and drafts[0]["current"] and drafts[0]["recipient"] is None
    draft_path = f"{record_path}/permit-drafts/{drafts[0]['id']}"
    response = staff.get(f"{draft_path}/download")
    assert sha256(response.content).hexdigest() == drafts[0]["sha256"]
    workbook = load_workbook(BytesIO(response.content))
    assert workbook.sheetnames == ["INV", "PL"]
    assert "DRAFT" in workbook["INV"]["A1"].value
    assert workbook["INV"]["G12"].value == 30
    assert workbook["INV"]["A12"].value == "#1"
    workbook.close()
    release = {"recipient": "broker@example.com", "notes": "Test authorization."}
    sent = staff.post(f"{draft_path}/release", json=release)
    assert sent.json()["state"] == "authorized"
    assert staff.post(f"{draft_path}/release", json=release).json() == sent.json()
    assert (
        staff.post(
            f"{draft_path}/release", json={**release, "recipient": "different@example.com"}
        ).status_code
        == 409
    )
    events = staff.get(f"{path}/review").json()["decisions"]
    assert {event["scope"] for event in events} == {"intake", "permit_release"}
    assert (
        next(e for e in events if e["scope"] == "intake")["snapshot_hash"]
        == review["snapshot_hash"]
    )
    report = staff.get(f"{API}/reports/imports").json()
    row = next(row for row in report["rows"] if row["id"] == existing["id"])
    assert row["currency"] == "USD" and row["amount"] == "30.000000"
    workbook = load_workbook(BytesIO(staff.get(f"{API}/reports/imports?excel=true").content))
    assert "OLD-DRAFT" not in {row[0] for row in workbook["Approved imports"].values}
    assert existing["id"] in {row[-1] for row in workbook["Approved imports"].values}
    workbook.close()


def test_conflict_requires_field_correction_and_stale_approval_is_rejected(staff):
    path = archive(staff, packing=10)
    current = analysis(staff, path)
    original = next(doc for doc in current["extractions"] if doc["role"] == "packing_list")
    review = save(staff, path, current)
    assert not review["ready"]
    assert staff.post(f"{path}/approve", json=decision(current, review)).status_code == 409
    response = staff.post(
        f"{path}/review",
        json={
            "expected_revision": current["revision"],
            "expected_review_id": review["id"],
            "resolutions": [{"key": "invoice_packing.quantity.10.11", "note": "ignore"}],
        },
    )
    assert response.status_code == 422
    correction = {
        "document_id": original["document_id"],
        "role": "packing_list",
        "row": original["items"][0]["row"],
        "name": "quantity",
        "value": "12",
        "note": "Checked the corrected quantity with the supplier.",
    }
    corrected = save(staff, path, current, review["id"], corrections=[correction])
    assert corrected["ready"]
    assert staff.post(f"{path}/approve", json=decision(current, review)).status_code == 409
    result = staff.post(f"{path}/approve", json=decision(current, corrected)).json()
    assert result["decision"] == "approved" and result["permit_pending"]
    assert staff.get(f"{API}/imports/{result['import_id']}/permit-drafts").json() == []
    untouched = next(
        doc for doc in analysis(staff, path)["extractions"] if doc["role"] == "packing_list"
    )
    assert untouched["items"][0]["fields"]["quantity"]["value"] == "10"


def test_guided_review_keeps_blockers_and_records_processing_separately(staff):
    path = archive(staff, packing=10)
    current = analysis(staff, path)
    state = staff.get(f"{path}/review").json()
    issue = next(
        issue for issue in state["issues"] if issue["key"].startswith("invoice_packing.quantity.")
    )
    assert issue["blocking"] and issue["severity"] == "mismatch"
    assert len({cite["sheet"] for cite in issue["evidence"] if cite["cell"]}) == 2
    assert (
        staff.post(
            f"{path}/review",
            json={
                "expected_revision": current["revision"],
                "expected_review_id": None,
                "issue_actions": [{"key": issue["key"], "action": "accept_ai"}],
            },
        ).status_code
        == 422
    )
    confirmed = save(
        staff, path, current, issue_actions=[{"key": issue["key"], "action": "confirm"}]
    )
    assert not confirmed["ready"] and confirmed["open_issues"][issue["key"]]
    review = save(
        staff,
        path,
        current,
        confirmed["id"],
        issue_actions=[{"key": issue["key"], "action": "cannot_verify"}],
    )
    assert review["open_issues"][issue["key"]]
    assert any("could not be verified" in blocker for blocker in review["blockers"])
    assert review["issue_log"][0]["evidence"] == issue["evidence"]
    assert staff.post(f"{path}/approve", json=decision(current, review)).status_code == 409
    processed = {"expected_revision": current["revision"], "approval_id": str(uuid4())}
    assert staff.post(f"{path}/processed", json=processed).status_code == 409

    packing = next(doc for doc in current["extractions"] if doc["role"] == "packing_list")
    corrected = save(
        staff,
        path,
        current,
        review["id"],
        corrections=[
            {
                "document_id": packing["document_id"],
                "role": "packing_list",
                "name": "quantity",
                "row": packing["items"][0]["row"],
                "value": "12",
                "note": "Verified on the source worksheet.",
            }
        ],
    )
    assert corrected["ready"] and issue["key"] not in corrected["open_issues"]
    change = corrected["changes"][0]
    assert change["before"]["value"] == "10" and change["after"]["value"] == "12"
    assert change["before"]["evidence"] == change["after"]["evidence"]
    guide = staff.get(f"{path}/review").json()
    assert [entry["id"] for entry in guide["history"]] == [
        corrected["id"],
        review["id"],
        confirmed["id"],
    ]
    assert staff.get(f"{path}/review/{review['id']}").json()["issue_log"] == review["issue_log"]
    approval = staff.post(f"{path}/approve", json=decision(current, corrected))
    assert approval.status_code == 200, approval.text
    assert staff.get(f"{path}/review").json()["processed"] is None
    processed["approval_id"] = approval.json()["approval_id"]
    result = staff.post(f"{path}/processed", json=processed)
    assert result.status_code == 200, result.text
    assert result.json()["actor_id"] == corrected["actor_id"]
    assert staff.post(f"{path}/processed", json=processed).json() == result.json()
    assert staff.get(f"{path}/review").json()["processed"] == result.json()


def test_guided_review_navigates_to_a_discrepancy_introduced_by_a_correction(staff):
    path = archive(staff)
    current = analysis(staff, path)
    packing = next(doc for doc in current["extractions"] if doc["role"] == "packing_list")
    correction = {
        "document_id": packing["document_id"],
        "role": "packing_list",
        "name": "quantity",
        "row": packing["items"][0]["row"],
        "value": "10",
        "note": "Check quantity on the worksheet.",
    }
    first = save(staff, path, current, corrections=[correction])
    guide = staff.get(f"{path}/review").json()
    issue = next(
        entry for entry in guide["issues"] if entry["key"].startswith("invoice_packing.quantity.")
    )
    assert first["open_issues"][issue["key"]]
    assert issue["comparison"] == ["12 PCS", "10 PCS"]
    amended = save(
        staff,
        path,
        current,
        first["id"],
        corrections=[
            {
                **correction,
                "value": "12",
                "issue_key": issue["key"],
            }
        ],
    )
    assert amended["ready"] and issue["key"] not in amended["open_issues"]
    assert amended["changes"][0]["edit"]["issue_key"] == issue["key"]


def test_confirm_correct_promotes_an_uncertain_pdf_field_with_its_evidence():
    from shipping_ai.approvals.guidance import build_queue
    from shipping_ai.approvals.review import SaveReview, apply_guided_actions, checked_number
    from shipping_ai.review.schemas import Evidence, Extraction
    from shipping_ai.review.values import field

    document_id = uuid4()
    cite = Evidence(
        document_id=document_id, page=1, bbox=(24, 36, 150, 55), raw="FABLE-12", method="ocr"
    )
    doc = Extraction(
        document_id=document_id,
        role="draft_bl",
        status="partial",
        method="tesseract",
        fields={"bl_no": field("FABLE-12", cite, uncertain=True)},
    )
    issues = build_queue([doc], [], [], checked_number)
    assert len(issues) == 1 and issues[0].can_confirm
    request = SaveReview(
        expected_revision=1,
        expected_review_id=None,
        issue_actions=[{"key": issues[0].key, "action": "confirm"}],
    )
    changes, decisions = apply_guided_actions(issues, [doc], request)
    assert changes[0]["before"]["status"] == "uncertain"
    assert doc.fields["bl_no"].status == "present"
    assert doc.fields["bl_no"].value == "FABLE-12" and doc.fields["bl_no"].evidence == [cite]
    assert decisions[issues[0].key]["evidence"] == [cite.model_dump(mode="json")]


def test_consignee_choices_compare_the_three_original_documents(staff):
    invoice_name = "Fictional Coast Trading Ltd."
    packing_name = "Fictional Bay Warehouse Ltd."
    bill_name = "Fictional Harbor Imports Ltd."
    workbook = load_workbook(BytesIO(supplier()))
    workbook["invoice"]["B4"] = invoice_name
    workbook["PackingList"]["B4"] = packing_name
    response = staff.post(
        f"{API}/intakes/simulate",
        data={"provider_message_id": str(uuid4())},
        files=[
            ("files", ("different-parties.xlsx", encoded(workbook), XLSX)),
            ("files", ("bill.pdf", draft_bill(company=bill_name), "application/pdf")),
        ],
    )
    assert response.status_code == 201, response.text
    finish_queue()
    path = f"{API}/intakes/{response.json()['case_id']}"
    current = analysis(staff, path)
    workflow = staff.get(f"{path}/review").json()
    parties = {option["value"]: option["sources"] for option in workflow["consignee_options"]}
    assert set(parties) == {bill_name, invoice_name, packing_name}
    assert parties[invoice_name][0]["evidence"][0]["cell"] == "B4"
    assert parties[packing_name][0]["evidence"][0]["sheet"] == "PackingList"
    bill = parties[bill_name][0]
    assert bill["ref"]["role"] == "draft_bl" and bill["evidence"][0]["page"] == 1

    invoice = next(doc for doc in current["extractions"] if doc["role"] == "invoice")
    edit = {
        "document_id": invoice["document_id"],
        "role": "invoice",
        "name": "consignee",
        "value": bill_name,
        "consignee_source": bill["ref"],
        "note": "Checked the printed B/L consignee.",
    }
    for invalid in [
        {**edit, "value": "Unsupported Name Ltd."},
        {**edit, "consignee_source": {**bill["ref"], "document_id": str(uuid4())}},
        {**edit, "name": "supplier"},
    ]:
        assert (
            staff.post(
                f"{path}/review",
                json={
                    "expected_revision": current["revision"],
                    "expected_review_id": None,
                    "corrections": [invalid],
                },
            ).status_code
            == 422
        )
    confirmed = save(staff, path, current, corrections=[edit])
    change = confirmed["changes"][0]
    assert change["before"]["value"] == invoice_name
    assert change["before"]["evidence"][0]["sheet"] == "invoice"
    assert change["after"]["value"] == bill_name
    assert change["after"]["evidence"] == bill["evidence"]
    assert not confirmed["ready"]
    assert (
        next(doc for doc in analysis(staff, path)["extractions"] if doc["role"] == "invoice")[
            "fields"
        ]["consignee"]["value"]
        == invoice_name
    )


def test_matching_consignee_names_share_one_option_with_both_sources(staff):
    path = archive(staff)
    [option] = staff.get(f"{path}/review").json()["consignee_options"]
    assert option["value"] == COMPANY
    assert {source["ref"]["role"] for source in option["sources"]} == {
        "draft_bl",
        "invoice",
        "packing_list",
    }


def test_original_candidate_review_binds_its_own_evidence():
    from fastapi import HTTPException
    from pytest import raises

    from shipping_ai.approvals.review import Correction, apply_corrections
    from shipping_ai.review.schemas import Evidence, Extraction, FieldCandidate
    from shipping_ai.review.values import field

    document_id = uuid4()
    first = Evidence(document_id=document_id, page=1, bbox=(1, 2, 3, 4), raw="Harbor Fabric")
    second = Evidence(document_id=document_id, page=2, bbox=(1, 2, 3, 4), raw="Harbor Fabric Co.")
    original = field(first.raw, first, uncertain=True)
    original.alternatives = [FieldCandidate(value=second.raw, evidence=[second])]
    document = Extraction(
        document_id=document_id,
        role="draft_bl",
        status="partial",
        method="pdf_text",
        fields={"consignee": original},
    )
    correction = Correction(
        document_id=document_id,
        role="draft_bl",
        name="consignee",
        value=second.raw,
        note="Selected the original source candidate.",
        alternative_index=0,
    )
    with raises(HTTPException) as invalid:
        apply_corrections([document], [correction.model_copy(update={"value": "Uncited company"})])
    assert invalid.value.status_code == 422
    changes = apply_corrections([document], [correction])
    assert document.fields["consignee"].evidence == [second]
    assert changes[0]["before"]["evidence"] == [first.model_dump(mode="json")]


def test_apply_corrections_allows_adding_unextracted_fields():
    from shipping_ai.approvals.review import Correction, apply_corrections
    from shipping_ai.review.schemas import Extraction
    from shipping_ai.review.values import field

    doc_id = uuid4()
    doc = Extraction(
        document_id=doc_id,
        role="invoice",
        status="extracted",
        method="deterministic",
        fields={"invoice_no": field("INV-101")},
        items=[],
    )
    # supplier_address is NOT in doc.fields originally
    correction = Correction(
        document_id=doc_id,
        role="invoice",
        row=None,
        name="supplier_address",
        value="123 Export St, Shanghai",
        note="Entered supplier address manually.",
    )
    changes = apply_corrections([doc], [correction])
    assert len(changes) == 1
    assert doc.fields["supplier_address"].value == "123 Export St, Shanghai"


def test_missing_ref_correction_request_rejection_and_unauthorized_approval(staff):
    import httpx

    path = archive(staff, missing_ref=True)
    current = analysis(staff, path)
    with httpx.Client(
        transport=staff._transport, base_url=ORIGIN, headers={"Origin": ORIGIN}
    ) as unauthenticated:
        assert (
            unauthenticated.post(f"{path}/approve", json=decision(current, None)).status_code == 401
        )
    review = save(
        staff, path, current, request_correction="Ask staff to verify the invoice number."
    )
    assert not review["ready"] and "correction" in review["blockers"][0]
    payload = decision(current, review, "Missing invoice reference.")
    result = staff.post(f"{path}/reject", json=payload).json()
    assert result["decision"] == "rejected" and result["import_id"] is None
    assert staff.post(f"{path}/reject", json=payload).json() == result
    assert staff.get(path).json()["state"] == "rejected"
    assert staff.post(f"{path}/approve", json=payload).status_code == 409
    assert staff.get(path).json()["documents"]


def test_unknown_balance_keeps_permit_pending(staff):
    path = archive(staff)
    current, mappings = apply_master(staff, path, analysis(staff, path), balance="=G3-5")
    review = save(staff, path, current, mappings=mappings, verify_cdc_mappings=True)
    result = staff.post(f"{path}/approve", json=decision(current, review)).json()
    assert result["decision"] == "approved"
    assert "unknown" in result["permit_pending"]
    assert staff.get(f"{API}/imports/{result['import_id']}/permit-drafts").json() == []


def test_reapproval_keeps_original_decision_and_replaces_current_items(staff):
    path = archive(staff)
    first = analysis(staff, path)
    initial = save(staff, path, first)
    accepted = staff.post(f"{path}/approve", json=decision(first, initial)).json()
    assert accepted["decision"] == "approved"
    updated = staff.post(f"{path}/process", json={"expected_revision": first["revision"]})
    assert updated.status_code == 202
    finish_queue()
    current = analysis(staff, path)
    second = save(staff, path, current)
    confirmed = staff.post(f"{path}/approve", json=decision(current, second)).json()
    assert confirmed["import_id"] == accepted["import_id"]
    assert confirmed["approval_id"] != accepted["approval_id"]
    assert staff.post(f"{path}/approve", json=decision(first, initial)).json() == accepted
    assert (
        staff.get(f"{path}/review/{initial['id']}").json()["snapshot_hash"]
        == initial["snapshot_hash"]
    )
    assert len(staff.get(f"{API}/imports/{accepted['import_id']}").json()["items"]) == 1
