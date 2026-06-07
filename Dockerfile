FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Schema is managed by the app's lifespan startup (create_all + idempotent
# migrations in src/api/main.py) — no separate migration tool needed.
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
