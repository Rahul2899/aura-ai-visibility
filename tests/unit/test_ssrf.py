"""Unit tests for SSRF protection in _safe_https_url.

DNS resolution is monkeypatched so tests are deterministic and offline. We verify:
  - malformed/unsafe hostnames are rejected before any resolution
  - hostnames resolving to private/loopback/metadata IPs are blocked
  - hostnames resolving to a public IP are allowed
"""
import socket

import pytest

from src.agents.orchestrator import _safe_https_url


def _fake_getaddrinfo(ip: str):
    """Return a getaddrinfo replacement that resolves everything to `ip`."""
    def _inner(host, port, *args, **kwargs):
        family = socket.AF_INET6 if ":" in ip else socket.AF_INET
        return [(family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, port))]
    return _inner


# ── hostname format rejection (no DNS) ────────────────────────────────────────

@pytest.mark.parametrize("bad", [
    "http://evil.com",        # scheme not allowed
    "https://evil.com",       # scheme not allowed
    "evil.com/path",          # path not allowed
    "evil.com:8080",          # port not allowed
    "evil .com",              # space
    "",                        # empty
    "-bad.com",               # leading hyphen
    "a..b.com",               # empty label
])
def test_malformed_hostname_rejected(bad):
    assert _safe_https_url(bad) is None


# ── blocked IP ranges ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("blocked_ip", [
    "127.0.0.1",       # loopback
    "10.0.0.5",        # RFC1918
    "172.16.0.1",      # RFC1918
    "192.168.1.1",     # RFC1918
    "169.254.169.254", # AWS metadata / link-local
    "0.0.0.0",         # this-network
    "100.64.0.1",      # shared address space
    "::1",             # IPv6 loopback
])
def test_private_ip_blocked(blocked_ip, monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo(blocked_ip))
    assert _safe_https_url("attacker-controlled.com") is None


# ── allowed public IPs ────────────────────────────────────────────────────────

def test_public_ipv4_allowed(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo("93.184.216.34"))  # example.com
    assert _safe_https_url("example.com") == "https://example.com"


def test_public_subdomain_allowed(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo("8.8.8.8"))
    assert _safe_https_url("api.example.co.uk") == "https://api.example.co.uk"


def test_dns_failure_returns_none(monkeypatch):
    def _raise(*a, **k):
        raise OSError("no such host")
    monkeypatch.setattr(socket, "getaddrinfo", _raise)
    assert _safe_https_url("nonexistent.invalid") is None
