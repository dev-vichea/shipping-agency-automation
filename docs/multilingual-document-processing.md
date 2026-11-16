# Multilingual document processing

The existing FastAPI, Celery, PostgreSQL, PDF, and Excel paths now share a vocabulary for English, Khmer, and Simplified and Traditional Chinese shipping labels. The parser also handles mixed-language fields and tables. Language labels report scripts observed in extracted values and document excerpts.

## Extraction and English representations

- The workbook reader uses the original sheet and cell positions across XLS and XLSX. Localized titles, headings, units, and totals feed the existing panel and worksheet logic. Numeric values use deterministic normalization, including Khmer numerals.
- The PDF reader uses positioned native text where it can. Image pages use Tesseract with language selection based on available text and a bounded multilingual reread when important labels or table headings are missing. The runtime includes `eng`, `khm`, `chi_sim`, and `chi_tra`. Field retries derive their crops from line and table geometry. [Tesseract language data](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html)
- Each extracted text field can retain its original text, source languages, source evidence, and a separate English representation. Printed English descriptions cite their own cells or PDF boxes. The import record stores the original goods description and a separate English description when staff approve it.
- Optional Qwen translation runs in the existing AI worker stage. It receives a bounded batch of evidence-backed descriptions and place names. Company fields, identifiers, dedicated product codes, amounts, and quantities stay outside the translation request. Embedded numbers and recognizable product codes must survive validation. Text containing recognized legal names is routed to manual translation. Missing, ambiguous, and unavailable proposals have distinct review statuses.
- Workspace administrators can add a **Verified English name** to a company in the existing company form. A unique directory match can supply an English alias with a link to the printed legal name. Duplicate matches require review. Legal names in the approved record retain their source spelling.

Staff can inspect original text and English proposals in document review. To use a model suggestion for an invoice item, check its wording against the original, enter it under **English description** in field corrections, and include a review note. The import approval workflow requires a printed or staff-verified English description for a recognized non-English invoice item. The PDF or workbook evidence and original text remain in the extraction snapshot. Translation proposals have their own model, digest, and prompt version and cannot approve or alter an import.

## English intake and CDC descriptions

Intake shows English wording first when the text is available. Model wording carries an English proposal label. The original remains linked to its source. Translated goods descriptions help rank workbook rows for staff review. The Invoice tab can show a read-only comparison against a unique English workbook when the case company and invoice year identify a single approval reference. Staff choose the applicable version and verify the match before the import item and permit draft use the exact CDC description.

## Fictional regression results

Sixteen fictional invoices cover four language profiles and four input types. Each document has 13 checks spanning role, header values, first item, quantity, unit, price, amount, currency, and item count. Numeric checks compare decimal values. Other checks require exact text, so additional OCR spacing, character substitutions, and missing code punctuation count as errors.

| Profile | Searchable PDF | Raster PDF | XLS | XLSX |
| --- | ---: | ---: | ---: | ---: |
| English | 1 → 13 | 1 → 13 | 13 → 13 | 13 → 13 |
| Chinese | 0 → 13 | 0 → 8 | 0 → 13 | 0 → 13 |
| Khmer | 0 → 13 | 0 → 11 | 0 → 13 | 0 → 13 |
| Mixed | 1 → 13 | 0 → 9 | 10 → 13 | 10 → 13 |

Each cell is the number correct out of 13 before and after this change. The host comparison uses the same documents and checks against commit `206b210`. The Docker image reproduced the after scores. Overall, 49/208 checks passed before and 197/208 passed after. Correct values with a page box or workbook cell rose from 34/160 to 149/160. The digital fixture assertions also check the exact workbook cells, the PDF description box and text, and separate quantity and unit citations.

One of four targeted table-cell OCR retries recovered an exact missing value. Two found no candidate, and one Khmer quantity reading conflicted with the printed price and amount. The parser kept that conflicting reading and its evidence for staff without substituting an inferred quantity. The 25% retry rate describes those four crop attempts only.

The ten-shipment reference replay reproduced the preceding reliability scores, including 24/24 PDF roles, 142/144 B/L core fields, 104/104 native B/L core fields, and 2,030/2,065 selected workbook fields. It also reproduced complete token coverage on 135/139 eligible B/L checks and exact cell citations on 2,001/2,047 eligible workbook checks.

The real `qwen3.5:4b-q4_K_M` model with digest prefix `d8b0f5e9760cd168` produced a translation through the isolated Docker worker. The API returned the original string, source cell, unchanged quantity, and model proposal while the case stayed in staff review. In a separate three-description spot check, the Chinese and mixed descriptions preserved the checked meaning. The Khmer proposal omitted the source material term for cotton. All three retained the embedded product code. This sample is too small to justify fine-tuning.

An independent, staff-labelled evaluation grouped by shipment is still required before treating these results as representative of production accuracy.

## Docker and verification

Migration `0010` adds the company alias and translation storage. The API and worker use the same OCR-equipped image. The regular development stack starts migration before the API and worker.

```sh
docker compose -f compose.dev.yml up -d --build --wait
docker compose -f compose.dev.yml exec -T worker tesseract --list-langs
docker compose -f compose.dev.yml exec -T api alembic check
```

To enable the model, use `SHIPPING_OLLAMA_ENABLED=true` and set the local model name and its Ollama digest with `SHIPPING_OLLAMA_MODEL` and `SHIPPING_OLLAMA_MODEL_DIGEST`. Docker Desktop uses `SHIPPING_OLLAMA_URL=http://host.docker.internal:11434` for a host Ollama service. Reprocess existing intakes to populate multilingual metadata on a new analysis revision.

```sh
uv run --project apps/api ruff check apps/api
uv run --project apps/api pytest apps/api/tests/test_multilingual_documents.py -q
uv run --project apps/api python apps/api/tests/measure_multilingual.py
```

The backend suite passed all 116 tests, including 27 new multilingual cases and the opt-in reference replay. The legacy Python suite passed all 35 tests. Frontend lint, type checks, and the Docker build passed. The browser suite passed 9 of 13 tests. The four prior selector failures recurred around the staff-review button, watched-folder row, line-items button, and original-download link. The browser test for document evidence passed. The backend test suite includes an integration case that verifies a Qwen proposal cannot substitute for a staff correction when approving a multilingual invoice.

The XLS fixtures contain fictional data. They use the same worksheet content as the XLSX generator in `apps/api/tests/multilingual_examples.py`. The PDF fixture font is Noto Sans Khmer under SIL OFL 1.1. [Noto Khmer source and license](https://github.com/notofonts/khmer)

## Remaining review cases

- Raster Chinese and mixed documents can contain fragmented words, changed character forms, or lost punctuation in names and product codes. Low-confidence scans, unusual fonts, vertical text, and handwriting need visual verification.
- Khmer scans can lose a short unit or misread a numeral. The parser flags missing or inconsistent values for staff. Printed trade terms and modifiers still require source comparison when Qwen supplies an English proposal.
- Ambiguous company directory matches, unsupported scripts, formulas without cached values, and PDF continuation tables without an identifiable header can require manual input. Language detection uses script cues, so Latin-only text in other languages and Han-only text without language context can be misidentified.
