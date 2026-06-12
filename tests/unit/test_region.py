"""Region inference is deterministic — a ccTLD or a clear web-context phrase maps to a
home market; generic TLDs with no signal default to None (= Global)."""
from src.agents.orchestrator import infer_region


def test_cctld_maps_to_region():
    assert infer_region("kaufland.de", None) == "Germany"
    assert infer_region("https://www.kaufland.de/shop", None) == "Germany"
    assert infer_region("brand.fr", None) == "France"
    assert infer_region("shop.co.uk", None) == "the UK"
    assert infer_region("store.com.au", None) == "Australia"
    assert infer_region("brand.in", None) == "India"
    assert infer_region("brand.eu", None) == "Europe"


def test_generic_tld_no_signal_is_global():
    # .com/.io/.app carry no region signal and no context -> None (Global).
    assert infer_region("notion.so", None) is None
    assert infer_region("stripe.com", None) is None
    assert infer_region("brand.io", None) is None
    assert infer_region(None, None) is None


def test_web_context_fallback_when_tld_generic():
    assert infer_region("brand.com", "A retailer based in Germany serving local shoppers.") == "Germany"
    assert infer_region("brand.com", "We operate across Europe and beyond.") == "Europe"
    # no clear phrase -> still Global
    assert infer_region("brand.com", "A great product loved by customers.") is None


def test_cctld_beats_context():
    # An explicit ccTLD is authoritative even if context is vague.
    assert infer_region("brand.de", "loved worldwide") == "Germany"
