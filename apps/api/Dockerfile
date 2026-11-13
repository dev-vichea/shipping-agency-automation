FROM ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490 AS uv
FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b
COPY --from=uv /uv /bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH" UV_LINK_MODE=copy
WORKDIR /app
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --locked --no-install-project --no-dev
COPY apps/api/src ./src
COPY services/__init__.py services/extraction.py services/packing.py services/bill_extractor.py services/matching.py ./services/
RUN uv sync --locked --no-dev --no-editable
COPY apps/api/alembic.ini ./
COPY apps/api/alembic ./alembic
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system shipping && useradd --system --gid shipping shipping \
    && install -d -o shipping -g shipping -m 0700 /var/lib/shipping/documents \
    && touch /var/lib/shipping/documents/.volume \
    && chown shipping:shipping /var/lib/shipping/documents/.volume
USER shipping
EXPOSE 8000
CMD ["uvicorn", "shipping_ai.main:app", "--host", "0.0.0.0", "--port", "8000"]
