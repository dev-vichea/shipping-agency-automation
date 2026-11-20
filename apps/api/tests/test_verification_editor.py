from test_auto_suggestions import archive
from test_phase_three import analysis, decision, save


def test_autosaved_cell_is_audited_but_needs_individual_confirmation(staff):
    path = archive(staff)
    current = analysis(staff, path)
    invoice = next(doc for doc in current["extractions"] if doc["role"] == "invoice")
    edit = {
        "document_id": invoice["document_id"],
        "role": "invoice",
        "row": 10,
        "name": "unit_price",
        "value": "2.50",
        "unit": "PCS",
        "currency": "USD",
        "note": "Autosaved manual edit; awaiting individual confirmation.",
        "confirmed": False,
    }
    draft = save(staff, path, current, corrections=[edit])
    assert not draft["ready"]
    assert any("Confirm the saved unit price" in reason for reason in draft["blockers"])
    assert draft["corrections"][0]["confirmed"] is False
    assert staff.post(f"{path}/approve", json=decision(current, draft)).status_code == 409
    verified = save(
        staff,
        path,
        current,
        previous=draft["id"],
        corrections=[
            {
                **edit,
                "confirmed": True,
                "note": "Individually verified against the original price cell.",
            }
        ],
    )
    assert verified["ready"]
    assert verified["corrections"][0]["confirmed"] is True
    assert staff.get(f"{path}/review/{draft['id']}").json()["corrections"][0]["confirmed"] is False


def test_sequential_cell_edits_keep_both_values_and_stale_saves_fail(staff):
    path = archive(staff)
    current = analysis(staff, path)
    invoice = next(doc for doc in current["extractions"] if doc["role"] == "invoice")
    edits = [
        {
            "document_id": invoice["document_id"],
            "role": "invoice",
            "row": None,
            "name": key,
            "value": invoice["fields"][key]["value"],
            "note": "Saved in the document editor for individual review.",
            "confirmed": False,
        }
        for key in ("origin", "destination")
    ]
    first = save(staff, path, current, corrections=edits[:1])
    second = save(staff, path, current, previous=first["id"], corrections=edits)
    assert {change["edit"]["name"] for change in second["changes"]} == {"origin", "destination"}
    stale = staff.post(
        f"{path}/review",
        json={
            "expected_revision": current["revision"],
            "expected_review_id": first["id"],
            "corrections": edits[:1],
        },
    )
    assert stale.status_code == 409
    assert staff.get(f"{path}/review").json()["review"]["id"] == second["id"]
