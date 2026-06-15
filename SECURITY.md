# Security Policy

## Supported Versions

This is an actively developed project; only the latest version on the `master`
branch (matching the live deployment) receives security updates.

## Reporting a Vulnerability

If you find a security issue, please report it privately rather than opening a
public issue. Open a [GitHub security advisory](https://github.com/Rahul2899/aura-ai-visibility/security/advisories/new)
or email the maintainer. You can expect an initial response within a few days.

A few deliberate protections are in place that testers may find relevant: SSRF
guards on outbound homepage fetches (per-redirect-hop revalidation),
parameterized database access, a global daily audit cap, and admin actions
gated behind a server-side key.
