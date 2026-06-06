"""Unit tests for the sliding-window limiter and client_ip extraction."""
from dataclasses import dataclass

from src.api.ratelimit import SlidingWindowLimiter, client_ip


# ── SlidingWindowLimiter ──────────────────────────────────────────────────────

def test_allows_up_to_limit():
    lim = SlidingWindowLimiter(max_events=3, window_seconds=60)
    assert lim.allow("k", now=0) is True
    assert lim.allow("k", now=1) is True
    assert lim.allow("k", now=2) is True


def test_blocks_over_limit():
    lim = SlidingWindowLimiter(max_events=2, window_seconds=60)
    lim.allow("k", now=0)
    lim.allow("k", now=1)
    assert lim.allow("k", now=2) is False


def test_window_slides_and_reallows():
    lim = SlidingWindowLimiter(max_events=2, window_seconds=10)
    lim.allow("k", now=0)
    lim.allow("k", now=1)
    assert lim.allow("k", now=5) is False        # still in window
    assert lim.allow("k", now=11) is True         # first event aged out


def test_keys_are_independent():
    lim = SlidingWindowLimiter(max_events=1, window_seconds=60)
    assert lim.allow("a", now=0) is True
    assert lim.allow("b", now=0) is True          # different key, own budget
    assert lim.allow("a", now=1) is False


def test_blocked_attempt_does_not_extend_window():
    # A blocked caller hammering must not push the window out and starve itself forever.
    lim = SlidingWindowLimiter(max_events=1, window_seconds=10)
    assert lim.allow("k", now=0) is True
    assert lim.allow("k", now=3) is False         # blocked, NOT recorded
    assert lim.allow("k", now=11) is True         # original event aged out at t=10


# ── client_ip ─────────────────────────────────────────────────────────────────

@dataclass
class FakeClient:
    host: str


class FakeRequest:
    def __init__(self, headers: dict, host: str | None = "5.6.7.8"):
        self.headers = headers
        self.client = FakeClient(host) if host else None


def test_client_ip_prefers_x_real_ip():
    req = FakeRequest({"x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9"})
    assert client_ip(req) == "1.2.3.4"


def test_client_ip_uses_rightmost_xff():
    req = FakeRequest({"x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3"})
    assert client_ip(req) == "3.3.3.3"


def test_client_ip_strips_whitespace():
    req = FakeRequest({"x-real-ip": "  1.2.3.4  "})
    assert client_ip(req) == "1.2.3.4"


def test_client_ip_falls_back_to_socket_peer():
    req = FakeRequest({}, host="5.6.7.8")
    assert client_ip(req) == "5.6.7.8"


def test_client_ip_unknown_when_no_client():
    req = FakeRequest({}, host=None)
    assert client_ip(req) == "unknown"
