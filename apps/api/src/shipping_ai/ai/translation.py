"""Translate only evidence-bound text. Keep model output outside staff review and approval."""

from hashlib import sha256
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from shipping_ai.documents.languages import languages, token_signature
from shipping_ai.documents.text_representation import TRANSLATABLE, field_groups
from shipping_ai.review.schemas import EnglishText

from .provider import InvalidAdvisory, ProviderUnavailable

TRANSLATION_VERSION = "shipping-en-1"
MAX_VALUES = 8
MAX_TEXT = 220


class Translation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{32}$")]
    status: Literal["translated", "ambiguous"]
    english: Annotated[str, StringConstraints(strip_whitespace=True, max_length=350)] | None


class TranslationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    translations: list[Translation] = Field(max_length=MAX_VALUES)


def pending_fields(docs):
    for doc in docs:
        for fields in field_groups(doc):
            for name, candidate in fields.items():
                if (
                    name in TRANSLATABLE
                    and candidate.english
                    and candidate.english.status == "pending"
                ):
                    yield name, candidate


def key_for(name, source):
    family = name if name in {"description", "cargo_summary"} else "place"
    return sha256(f"{family}\0{source}".encode()).hexdigest()[:32]


def safe_source(candidate):
    return bool(candidate.evidence) and (
        candidate.status == "present"
        or all(e.confidence is not None and e.confidence >= 60 for e in candidate.evidence)
    )


def choices(docs):
    values = {}
    fields = sorted(
        pending_fields(docs), key=lambda pair: pair[0] not in {"description", "cargo_summary"}
    )
    for name, candidate in fields:
        if not safe_source(candidate) or len(candidate.value) > MAX_TEXT:
            continue
        key = key_for(name, candidate.value)
        values.setdefault(key, {"key": key, "field": name, "text": candidate.value})
        if len(values) == MAX_VALUES:
            break
    return values


def propose(provider, requested):
    try:
        output, digest = provider.translate(list(requested.values()), TranslationOutput)
        received = {item.key: item for item in output.translations}
        if len(received) != len(output.translations) or not received.keys() <= requested.keys():
            raise InvalidAdvisory()
    except ProviderUnavailable:
        return {"state": "unavailable", "results": {}}
    except InvalidAdvisory:
        return {"state": "invalid_output", "results": {}}

    results = {}
    for key, source in requested.items():
        item = received.get(key)
        text = item.english if item else None
        valid = (
            text
            and item.status == "translated"
            and languages(text) == ["en"]
            and token_signature(text) == token_signature(source["text"])
            and all(c.isprintable() for c in text)
        )
        results[key] = EnglishText(
            status="proposed" if valid else "ambiguous",
            value=text if valid else None,
            reason=(
                "Verify the English wording against the original before accepting it."
                if valid
                else "The model could not supply unambiguous English with unchanged numbers and codes."
            ),
            model=provider.config.ollama_model,
            model_digest=digest,
            prompt_version=TRANSLATION_VERSION,
        ).model_dump(mode="json")
    return {"state": "ready", "results": results}


def overlay(docs, stored, *, ai_state):
    results = (stored or {}).get("results", {})
    requested = choices(docs)
    for name, candidate in pending_fields(docs):
        key = key_for(name, candidate.value)
        if not safe_source(candidate):
            candidate.english.status = "ambiguous"
            candidate.english.reason = "Verify the extracted source value before translating."
        elif key in results:
            candidate.english = EnglishText.model_validate(results[key])
            candidate.english.evidence = candidate.evidence
            if candidate.english.status == "proposed" and candidate.status != "present":
                candidate.english.reason = (
                    "Verify the OCR text and the English wording against the original."
                )
        elif ai_state in {"disabled", "unavailable", "invalid_output"} or (
            stored and stored.get("state") != "ready"
        ):
            candidate.english.status = "unavailable"
            candidate.english.reason = (
                "English translation is unavailable. Enter verified English during review."
            )
        elif key not in requested:
            candidate.english.status = "limit_reached"
            candidate.english.reason = (
                "Automatic translation limit reached. Enter verified English during review."
            )
