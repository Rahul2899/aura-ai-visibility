"""Unit tests for compute_visibility — the corrected, authoritative visibility metric.

Overall visibility = total brand mentions across every (probe × model) result
divided by the total number of results. Failed model calls are already excluded
upstream (they never enter model_hits), so this function only sees real results.
"""
from src.agents.orchestrator import compute_visibility


def test_no_results_returns_none():
    # An audit with zero successful probes is "unknown", not 0%.
    assert compute_visibility({}) is None


def test_all_models_empty_returns_none():
    assert compute_visibility({"nova": [], "claude": []}) is None


def test_all_hits_is_100():
    assert compute_visibility({"nova": [True, True], "claude": [True]}) == 100.0


def test_no_hits_is_zero():
    assert compute_visibility({"nova": [False, False], "claude": [False]}) == 0.0


def test_mixed_is_fraction_of_total_results():
    # 1 hit out of 4 total results = 25%
    assert compute_visibility({"nova": [True, False], "claude": [False, False]}) == 25.0


def test_weights_by_result_count_not_model_count():
    # nova ran 3 probes (all hit), claude ran 1 (miss): 3/4 = 75%, NOT average of
    # per-model rates (which would be (100 + 0)/2 = 50%).
    assert compute_visibility({"nova": [True, True, True], "claude": [False]}) == 75.0


def test_rounding_to_one_decimal():
    # 1 of 3 = 33.333... -> 33.3
    assert compute_visibility({"nova": [True, False, False]}) == 33.3


def test_single_model_single_hit():
    assert compute_visibility({"nova": [True]}) == 100.0
