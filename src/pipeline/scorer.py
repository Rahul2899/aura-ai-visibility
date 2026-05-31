from dataclasses import dataclass
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from src.models import Run, Mention, Prompt


@dataclass
class AuditScore:
    brand_name: str
    total_runs: int
    runs_with_target: int
    visibility_score: float       # % of runs where target appears
    share_of_voice: float         # target mentions / all mentions
    position_weighted_score: float  # sum(1/pos) target / sum(1/pos) all


async def score_brand(session: AsyncSession, brand_id: int) -> AuditScore:
    from src.models import Brand
    brand = await session.get(Brand, brand_id)

    # All runs for this brand's prompts
    run_ids_query = (
        select(Run.id)
        .join(Prompt, Run.prompt_id == Prompt.id)
        .where(Prompt.brand_id == brand_id)
    )
    run_ids = (await session.scalars(run_ids_query)).all()

    if not run_ids:
        return AuditScore(brand.name, 0, 0, 0.0, 0.0, 0.0)

    total_runs = len(run_ids)

    # Runs where target brand appears
    target_runs = await session.scalar(
        select(func.count(func.distinct(Mention.run_id)))
        .where(Mention.run_id.in_(run_ids), Mention.is_target_brand == True)
    )

    # All mentions in these runs
    all_mentions = await session.scalars(
        select(Mention).where(Mention.run_id.in_(run_ids))
    )
    all_mentions = list(all_mentions)

    target_mentions = [m for m in all_mentions if m.is_target_brand]

    total_mention_count = len(all_mentions)
    target_mention_count = len(target_mentions)

    visibility = target_runs / total_runs if total_runs else 0.0
    sov = target_mention_count / total_mention_count if total_mention_count else 0.0

    # Position-weighted: sum(1/position) — higher position (lower number) = more weight
    pw_target = sum(1.0 / m.position for m in target_mentions if m.position > 0)
    pw_all = sum(1.0 / m.position for m in all_mentions if m.position > 0)
    pw_score = pw_target / pw_all if pw_all else 0.0

    return AuditScore(
        brand_name=brand.name,
        total_runs=total_runs,
        runs_with_target=target_runs or 0,
        visibility_score=round(visibility, 4),
        share_of_voice=round(sov, 4),
        position_weighted_score=round(pw_score, 4),
    )
