from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete as sql_delete
from src.db import SessionLocal
from src.models import Brand, Prompt, Run, Mention, Insight, ProbePerformance
from src.pipeline.scorer import score_brand

router = APIRouter(prefix="/brands")


class BrandCreate(BaseModel):
    name: str
    domain: str = ""


# ── Static routes FIRST (must come before /{brand_id} to avoid ambiguity) ──

@router.get("/compare")
async def compare_brands():
    """All brands with latest insight. Single DB pass — no N+1."""
    async with SessionLocal() as session:
        brands = (await session.scalars(select(Brand))).all()
        brand_ids = [b.id for b in brands]

        insights_raw = (await session.scalars(
            select(Insight).where(Insight.brand_id.in_(brand_ids))
            .order_by(Insight.brand_id, Insight.created_at.desc())
        )).all()

        by_brand: dict[int, list] = {}
        for ins in insights_raw:
            by_brand.setdefault(ins.brand_id, [])
            if len(by_brand[ins.brand_id]) < 2:
                by_brand[ins.brand_id].append(ins)

        result = []
        for brand in brands:
            ins_list = by_brand.get(brand.id, [])
            latest = ins_list[0] if ins_list else None
            previous = ins_list[1] if len(ins_list) > 1 else None
            trend = None
            if latest and previous and latest.visibility_pct is not None and previous.visibility_pct is not None:
                trend = round(latest.visibility_pct - previous.visibility_pct, 1)
            result.append({
                "id": brand.id,
                "name": brand.name,
                "domain": brand.domain,
                "visibility_pct": latest.visibility_pct if latest else None,
                "trend": trend,
                "probe_count": latest.probe_count if latest else None,
                "last_run": latest.created_at.isoformat() if latest else None,
            })

        audited = sorted([r for r in result if r["visibility_pct"] is not None],
                         key=lambda x: x["visibility_pct"], reverse=True)
        pending = [r for r in result if r["visibility_pct"] is None]
        for i, b in enumerate(audited):
            b["rank"] = i + 1
        for b in pending:
            b["rank"] = None
        return audited + pending


# ── Collection routes ──

@router.get("")
async def list_brands():
    async with SessionLocal() as session:
        brands = (await session.scalars(select(Brand))).all()
        return [{"id": b.id, "name": b.name, "domain": b.domain} for b in brands]


@router.post("", status_code=201)
async def create_brand(body: BrandCreate):
    async with SessionLocal() as session:
        brand = Brand(name=body.name, domain=body.domain or None, competitors=[])
        session.add(brand)
        await session.commit()
        return {"id": brand.id, "name": brand.name}


# ── Brand-specific routes ──

@router.delete("/{brand_id}", status_code=204)
async def delete_brand(brand_id: int):
    """Delete brand and all related data in correct FK order."""
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")

        # 1. Delete Insights and ProbePerformance (direct brand FK)
        await session.execute(sql_delete(Insight).where(Insight.brand_id == brand_id))
        await session.execute(sql_delete(ProbePerformance).where(ProbePerformance.brand_id == brand_id))

        # 2. Walk Prompt → Run → Mention chain
        prompt_ids = list(await session.scalars(select(Prompt.id).where(Prompt.brand_id == brand_id)))
        if prompt_ids:
            run_ids = list(await session.scalars(select(Run.id).where(Run.prompt_id.in_(prompt_ids))))
            if run_ids:
                await session.execute(sql_delete(Mention).where(Mention.run_id.in_(run_ids)))
                await session.execute(sql_delete(Run).where(Run.id.in_(run_ids)))
            await session.execute(sql_delete(Prompt).where(Prompt.brand_id == brand_id))

        await session.delete(brand)
        await session.commit()


@router.get("/{brand_id}/report")
async def get_report(brand_id: int):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        score = await score_brand(session, brand_id)
        return {
            "brand": brand.name,
            "visibility_pct": round(score.visibility_score * 100, 1),
            "share_of_voice": round(score.share_of_voice * 100, 1),
            "position_weighted_score": score.position_weighted_score,
            "total_runs": score.total_runs,
        }


@router.get("/{brand_id}/insights")
async def get_insights(brand_id: int):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        insights = (await session.scalars(
            select(Insight).where(Insight.brand_id == brand_id).order_by(Insight.created_at.desc())
        )).all()
        return [
            {
                "id": i.id,
                "created_at": i.created_at.isoformat(),
                "summary": i.summary,
                "key_findings": i.key_findings or [],
                "recommendations": i.recommendations or [],
                "probe_count": i.probe_count,
                "visibility_pct": i.visibility_pct,
                "model_breakdown": i.model_breakdown,
            }
            for i in insights
        ]


@router.delete("/{brand_id}/insights/{insight_id}", status_code=204)
async def delete_insight(brand_id: int, insight_id: int):
    async with SessionLocal() as session:
        insight = await session.get(Insight, insight_id)
        if not insight or insight.brand_id != brand_id:
            raise HTTPException(404, "Insight not found")
        await session.delete(insight)
        await session.commit()


@router.get("/{brand_id}/model-bias")
async def get_model_bias(brand_id: int):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        latest = await session.scalar(
            select(Insight)
            .where(Insight.brand_id == brand_id, Insight.model_breakdown.isnot(None))
            .order_by(Insight.created_at.desc())
        )
        if not latest or not latest.model_breakdown:
            return {"brand": brand.name, "models": []}
        models = [
            {"model": m, "visibility_pct": v}
            for m, v in sorted(latest.model_breakdown.items(), key=lambda x: -x[1])
        ]
        return {"brand": brand.name, "models": models}


@router.get("/{brand_id}/probe-performance")
async def get_probe_performance(brand_id: int):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        probes = (await session.scalars(
            select(ProbePerformance)
            .where(ProbePerformance.brand_id == brand_id, ProbePerformance.run_count >= 1)
        )).all()
        if not probes:
            return {"top": [], "bottom": []}
        ranked = sorted(probes, key=lambda p: p.hit_count / p.run_count, reverse=True)
        top = ranked[:3]
        bottom = [p for p in ranked[-3:] if p not in top]
        def fmt(p):
            return {"prompt": p.prompt_text, "hit_rate": round(p.hit_count / p.run_count * 100, 1)}
        return {"top": [fmt(p) for p in top], "bottom": [fmt(p) for p in bottom]}
