"""In-memory sliding-window rate limiter.

Used to cap cheap-but-spammable operations (e.g. brand creation) so a bot cannot
flood Postgres. State is per-process and resets on restart — acceptable here because
the threat is volume, not a hard quota. For audit limits (which must survive restarts)
the DB-backed AuditLimit table is used instead.
"""
import time
from collections import defaultdict, deque


def client_ip(request) -> str:
    """Real client IP for rate limiting. Prefers X-Real-IP (single, unspoofable
    through one trusted reverse proxy), then the rightmost X-Forwarded-For entry
    (both set by the Caddy proxy in front of the app), then the socket peer."""
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


class SlidingWindowLimiter:
    def __init__(self, max_events: int, window_seconds: float):
        self.max_events = max_events
        self.window = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str, now: float | None = None) -> bool:
        """Record an attempt for `key`. Returns True if under the limit, False if over.
        Only counts the event when allowed, so a blocked caller cannot push the window
        further out by hammering."""
        now = time.monotonic() if now is None else now
        q = self._hits[key]
        cutoff = now - self.window
        while q and q[0] <= cutoff:
            q.popleft()
        if len(q) >= self.max_events:
            return False
        q.append(now)
        return True
