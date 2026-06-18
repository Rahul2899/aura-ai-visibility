FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a non-root user so a future code-exec bug can't act as root inside the
# container. Deps were installed as root above (system site-packages); the app only
# needs to read /app and bind a port, which an unprivileged user can do.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

# Schema is managed by the app's lifespan startup (create_all + idempotent
# migrations in src/api/main.py) — no separate migration tool needed.
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
