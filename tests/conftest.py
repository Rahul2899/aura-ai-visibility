"""Shared test setup.

Unit tests exercise pure logic (auth decisions, SSRF blocking, rate limiting,
scoring math) and must not require a real database. src.db reads DATABASE_URL at
import time, so we set a dummy value here before any src import. No connection is
ever opened by the unit tests, so the dummy URL is never dialed.
"""
import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("ADMIN_KEY", "test-admin-key")
