"""Score the fictional fixture corpus against the current Python import path."""

import json
from collections import Counter
from uuid import uuid4

from multilingual_examples import TEXT, document, expected, observed

from shipping_ai.documents.extract import extract
from shipping_ai.review.values import decimal

NUMBERS = {"quantity", "unit_price", "amount"}


def measure():
    matrix = {}
    for language in TEXT:
        results = {}
        for suffix in ("pdf", "xls", "xlsx", "scan"):
            ext = "pdf" if suffix == "scan" else suffix
            [doc] = extract(document(language, suffix), f"fictional.{ext}", uuid4(), "other")
            actual, fields = observed(doc)
            scores = {}
            for key, value in expected(language).items():
                scores[key] = (
                    decimal(value) == decimal(actual[key])
                    if key in NUMBERS
                    else value == actual[key]
                )
            evidence = Counter()
            for key, correct in scores.items():
                if key in {"role", "item_count", "currency"}:
                    continue
                evidence["total"] += 1
                saved = fields[key].evidence if key in fields else []
                if correct and saved and all(e.bbox or e.cell for e in saved):
                    evidence["cited_correct"] += 1
            results[suffix] = {
                "fields": [sum(scores.values()), len(scores)],
                "incorrect": [key for key, result in scores.items() if not result],
                "correct_with_location": [evidence["cited_correct"], evidence["total"]],
                "crops": [a for a in doc.recovery if a["stage"] == "crop"],
            }
        matrix[language] = results
    return matrix


if __name__ == "__main__":
    print(json.dumps(measure(), indent=2))
