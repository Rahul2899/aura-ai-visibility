"""Brand-name matching: case- and diacritic-insensitive whole-word match."""
from src.agents.orchestrator import _brand_matches, _fold


def test_exact_match():
    assert _brand_matches("Lever", "Lever")


def test_case_insensitive():
    assert _brand_matches("ALDISUD", "aldisud")
    assert _brand_matches("Notion", "NOTION")


def test_diacritics_folded():
    # "Aldi Süd" should match its plain spelling, and vice versa.
    assert _brand_matches("Aldi Süd", "Aldi Sud")
    assert _brand_matches("Nestlé", "nestle")
    assert _brand_matches("nestle", "Nestlé")


def test_whole_word_only():
    # Substring false-positives must still be rejected after folding.
    assert not _brand_matches("Lever", "Cleverbit")
    assert not _brand_matches("Lever", "leverage")


def test_token_within_name():
    assert _brand_matches("Lever", "Lever ATS")


def test_fold_helper():
    assert _fold("Süd") == "sud"
    assert _fold("Nestlé") == "nestle"
    assert _fold("ABC") == "abc"


def test_separator_insensitive_match():
    # Users type brand names with spacing/punctuation the brand itself doesn't use.
    # A real audit was submitted as "star bucks": models said "Starbucks" in 74 of 80
    # answers, none matched, and the brand scored 0% instead of ~88%.
    assert _brand_matches("star bucks", "Starbucks")
    assert _brand_matches("Coca Cola", "Coca-Cola")
    assert _brand_matches("Pay Pal", "PayPal")


def test_separator_stripping_does_not_create_false_positives():
    # Stripping separators must not turn a substring into a match: comparing the
    # tightened forms is exact-only, so a short target can't swallow a longer name.
    assert not _brand_matches("Lever", "Clever Bit")
    assert not _brand_matches("HP", "H P")  # too short to tighten safely
