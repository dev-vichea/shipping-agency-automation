"""Keep source fields and their English representations independently auditable."""

import re
from collections import defaultdict

from shipping_ai.review.schemas import EnglishText
from shipping_ai.review.values import decimal, folded, usable

from .languages import languages, token_signature

TRANSLATABLE = {
    "description",
    "cargo_summary",
    "origin",
    "destination",
    "port",
    "discharge",
    "delivery",
    "destination_port",
    "receipt",
}
PARTY_KEYS = {"supplier", "shipper", "consignee", "notify_party", "billed_to", "carrier"}
LEGAL_FORM = re.compile(r"有限公司|股份公司|ក្រុមហ៊ុន|\b(?:ltd|llc|gmbh|sarl)\b", re.I)


def field_groups(doc):
    yield doc.fields
    for item in doc.items:
        yield item.fields
    for section in doc.sections:
        yield from field_groups(section)


def annotate_languages(doc):
    detected = set()
    for section in doc.sections:
        annotate_languages(section)
        detected.update(section.source_languages)
    for source in doc.source_excerpt:
        detected.update(languages(source.raw))
    legal_names = {
        folded(candidate.value)
        for name, candidate in doc.fields.items()
        if name in PARTY_KEYS and candidate.value and len(candidate.value) > 3
    }
    for fields in (doc.fields, *(item.fields for item in doc.items)):
        for key, candidate in fields.items():
            if not candidate.value:
                continue
            source = candidate.evidence[0].raw if candidate.evidence else None
            candidate.original_text = (
                source
                if source
                and (
                    folded(source) == folded(candidate.value)
                    or decimal(candidate.value) is not None
                    and decimal(candidate.value) == decimal(source)
                )
                else candidate.value
            )
            candidate.source_languages = languages(candidate.original_text)
            detected.update(candidate.source_languages)
            if key not in TRANSLATABLE or (candidate.english and candidate.english.status == "source"):
                continue
            if key == "description":
                printed = fields.get("english_description")
                if usable(printed):
                    if (
                        languages(printed.value) == ["en"]
                        and token_signature(printed.value)[1] == token_signature(candidate.value)[1]
                    ):
                        candidate.english = EnglishText(
                            value=printed.value,
                            status="source",
                            evidence=printed.evidence,
                        )
                        continue
                    printed.status = "uncertain"
                    printed.review_reason = "verify_printed_english_description"
                    candidate.english = EnglishText(
                        status="ambiguous",
                        evidence=printed.evidence,
                        reason="Verify the printed English description and product references.",
                    )
                    continue
            if candidate.source_languages == ["en"]:
                candidate.english = EnglishText(
                    value=candidate.value,
                    status="source",
                    evidence=candidate.evidence,
                )
            elif "und" in candidate.source_languages:
                candidate.english = EnglishText(
                    status="unsupported", reason="This source script requires staff translation."
                )
            elif candidate.source_languages and (
                LEGAL_FORM.search(candidate.value)
                or any(name in folded(candidate.value) for name in legal_names)
            ):
                candidate.english = EnglishText(
                    status="ambiguous",
                    evidence=candidate.evidence,
                    reason="This text contains a legal company name. Verify the English wording manually.",
                )
            elif candidate.source_languages:
                candidate.english = EnglishText(
                    status="pending", reason="An English translation requires staff verification."
                )
    doc.source_languages = sorted(detected)
    return doc


def apply_company_aliases(docs, companies):
    """Only a unique exact directory match may carry an admin-maintained English alias."""
    index = defaultdict(list)
    for company in companies:
        # Keep punctuation and Khmer combining marks significant for legal names.
        names = [company.name, *company.aliases, company.verified_english_name]
        for key in {alias.strip().casefold() for alias in names if alias}:
            index[key].append(company)
    for doc in docs:
        for fields in field_groups(doc):
            for key in PARTY_KEYS & fields.keys():
                candidate = fields[key]
                if not usable(candidate):
                    continue
                companies = index[candidate.value.strip().casefold()]
                if len(companies) == 1 and companies[0].verified_english_name:
                    candidate.english = EnglishText(
                        status="verified_company_alias",
                        value=companies[0].verified_english_name,
                        company_id=companies[0].id,
                        evidence=candidate.evidence,
                    )
                elif len(companies) > 1 and any(c.verified_english_name for c in companies):
                    candidate.english = EnglishText(
                        status="ambiguous", reason="Several companies match this legal name."
                    )
