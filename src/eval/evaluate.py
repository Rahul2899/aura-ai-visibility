"""
Precision/recall evaluation for the brand-mention extractor.
Runs against eval/labeled.jsonl — each line is:
  {"response_text": "...", "expected": [{"brand_name": "...", "position": N, "sentiment": "..."}]}

Usage: python -m src.eval.evaluate
"""

import asyncio
import json
from pathlib import Path
import structlog

from src.llm.extractor import extract_mentions
from src.llm.bedrock_client import BEDROCK_MODELS

log = structlog.get_logger()

LABELED_PATH = Path(__file__).parent / "labeled.jsonl"
EVAL_MODEL = BEDROCK_MODELS[0]  # use first Bedrock model for eval


def _normalize(name: str) -> str:
    return name.lower().strip()


def score_pair(expected: list[dict], predicted: list[dict]) -> tuple[int, int, int]:
    """Returns (true_positives, false_positives, false_negatives)."""
    exp_names = {_normalize(e["brand_name"]) for e in expected}
    pred_names = {_normalize(p["brand_name"]) for p in predicted}
    tp = len(exp_names & pred_names)
    fp = len(pred_names - exp_names)
    fn = len(exp_names - pred_names)
    return tp, fp, fn


async def run_eval():
    if not LABELED_PATH.exists():
        print(f"No labeled data found at {LABELED_PATH}")
        print("Create it with lines like:")
        print('  {"response_text": "...", "expected": [{"brand_name": "Personio", "position": 1, "sentiment": "positive"}]}')
        return

    examples = [json.loads(l) for l in LABELED_PATH.read_text().strip().splitlines() if l.strip()]
    if not examples:
        print("labeled.jsonl is empty")
        return

    client = OpenRouterClient()
    total_tp = total_fp = total_fn = 0
    failures = []

    for i, ex in enumerate(examples):
        result = await extract_mentions(client, EVAL_MODEL, ex["response_text"])
        predicted = [m.model_dump() for m in result.mentions]
        tp, fp, fn = score_pair(ex["expected"], predicted)
        total_tp += tp
        total_fp += fp
        total_fn += fn
        if fp > 0 or fn > 0:
            failures.append({"example": i + 1, "tp": tp, "fp": fp, "fn": fn, "expected": ex["expected"], "predicted": predicted})

    await client.close()

    precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) else 0
    recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) else 0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0

    print(f"\n=== Extractor Evaluation ({len(examples)} examples) ===")
    print(f"Precision: {precision:.3f}")
    print(f"Recall:    {recall:.3f}")
    print(f"F1:        {f1:.3f}")
    print(f"TP={total_tp}  FP={total_fp}  FN={total_fn}")

    if failures:
        print(f"\nFailure cases ({len(failures)}):")
        for f in failures[:5]:
            print(f"  Example {f['example']}: TP={f['tp']} FP={f['fp']} FN={f['fn']}")
            missing = {_normalize(e["brand_name"]) for e in f["expected"]} - {_normalize(p["brand_name"]) for p in f["predicted"]}
            extra = {_normalize(p["brand_name"]) for p in f["predicted"]} - {_normalize(e["brand_name"]) for e in f["expected"]}
            if missing:
                print(f"    Missed: {missing}")
            if extra:
                print(f"    Hallucinated: {extra}")


if __name__ == "__main__":
    asyncio.run(run_eval())
