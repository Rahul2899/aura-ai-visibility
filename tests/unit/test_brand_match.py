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
