import os
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, field_validator
from sqlalchemy import select, delete as sql_delete
from src.api.auth import is_admin, require_read, require_owner_or_admin
from src.db import SessionLocal
from src.models import Brand, Prompt, Run, Mention, Insight, ProbePerformance
from src.pipeline.scorer import score_brand

router = APIRouter(prefix="/brands")

INDUSTRIES = [
    "HR Tech / Recruiting",
    "SaaS / B2B Software",
    "Healthcare",
    "Finance / Fintech",
    "E-commerce / Retail",
    "Education / EdTech",
    "Marketing / AdTech",
    "Developer Tools",
    "Security / Cybersecurity",
    "Other",
]


class BrandCreate(BaseModel):
    name: str
    domain: str = ""
    industry: str = ""
    session_id: str = ""

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Brand name cannot be empty")
        return v.strip()

    @field_validator("session_id")
    @classmethod
    def session_id_not_reserved(cls, v: str) -> str:
        if v in ("example", "admin"):
            raise ValueError("Reserved session_id")
        return v


def _brand_scope(stmt, session_id, x_admin_key):
    if is_admin(session_id, x_admin_key):
        return stmt
    if session_id and session_id != "admin":
        return stmt.where((Brand.session_id == session_id) | (Brand.session_id == "example"))
    return stmt.where(Brand.session_id == "example")


@router.get("/industries")
async def list_industries():
    return INDUSTRIES


@router.get("/compare")
async def compare_brands(session_id: str = None, x_admin_key: str = Header(None)):
    async with SessionLocal() as session:
        brands = (await session.scalars(_brand_scope(select(Brand), session_id, x_admin_key))).all()
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
                "industry": brand.industry,
                "visibility_pct": latest.visibility_pct if latest else None,
                "trend": trend,
                "probe_count": latest.probe_count if latest else None,
                "last_run": latest.created_at.isoformat() if latest else None,
                "is_example": brand.session_id == "example",
            })

        audited = sorted([r for r in result if r["visibility_pct"] is not None],
                         key=lambda x: x["visibility_pct"], reverse=True)
        pending = [r for r in result if r["visibility_pct"] is None]
        for i, b in enumerate(audited):
            b["rank"] = i + 1
        for b in pending:
            b["rank"] = None
        return audited + pending


@router.get("")
async def list_brands(session_id: str = None, x_admin_key: str = Header(None)):
    async with SessionLocal() as session:
        brands = (await session.scalars(_brand_scope(select(Brand), session_id, x_admin_key))).all()
        return [{"id": b.id, "name": b.name, "domain": b.domain, "industry": b.industry,
                 "is_example": b.session_id == "example"} for b in brands]


@router.post("", status_code=201)
async def create_brand(body: BrandCreate):
    async with SessionLocal() as session:
        brand = Brand(
            name=body.name,
            domain=body.domain or None,
            industry=body.industry or None,
            competitors=[],
            session_id=body.session_id if body.session_id else None,
        )
        session.add(brand)
        await session.commit()
        await session.refresh(brand)
        return {"id": brand.id, "name": brand.name}


@router.get("/{brand_id}")
async def get_brand(brand_id: int, session_id: str = None, x_admin_key: str = Header(None)):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        require_read(brand, session_id, x_admin_key)
        return {
            "id": brand.id,
            "name": brand.name,
            "domain": brand.domain,
            "industry": brand.industry,
            "session_id": brand.session_id,
            "is_example": brand.session_id == "example",
        }


@router.delete("/{brand_id}", status_code=204)
async def delete_brand(brand_id: int, session_id: str = None, x_admin_key: str = Header(None)):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        if brand.session_id == "example":
            raise HTTPException(status_code=403, detail="Cannot delete preloaded example brands")
        require_owner_or_admin(brand, session_id, x_admin_key)

        await session.execute(sql_delete(Insight).where(Insight.brand_id == brand_id))
        await session.execute(sql_delete(ProbePerformance).where(ProbePerformance.brand_id == brand_id))

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
async def get_report(brand_id: int, session_id: str = None, x_admin_key: str = Header(None)):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        require_read(brand, session_id, x_admin_key)
        score = await score_brand(session, brand_id)
        return {
            "brand": brand.name,
            "visibility_pct": round(score.visibility_score * 100, 1),
            "share_of_voice": round(score.share_of_voice * 100, 1),
            "position_weighted_score": score.position_weighted_score,
            "total_runs": score.total_runs,
        }


@router.get("/{brand_id}/insights")
async def get_insights(brand_id: int, session_id: str = None, x_admin_key: str = Header(None)):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        require_read(brand, session_id, x_admin_key)
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
async def delete_insight(
    brand_id: int,
    insight_id: int,
    session_id: str = None,
    x_admin_key: str = Header(None),
):
    async with SessionLocal() as session:
        insight = await session.get(Insight, insight_id)
        if not insight or insight.brand_id != brand_id:
            raise HTTPException(404, "Insight not found")

        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")

        if brand.session_id == "example" and not is_admin(session_id, x_admin_key):
            raise HTTPException(status_code=403, detail="Cannot delete insights of preloaded example brands")
        require_owner_or_admin(brand, session_id, x_admin_key)

        await session.delete(insight)
        await session.commit()


@router.get("/{brand_id}/model-bias")
async def get_model_bias(brand_id: int, session_id: str = None, x_admin_key: str = Header(None)):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        require_read(brand, session_id, x_admin_key)

        latest = await session.scalar(
            select(Insight)
            .where(Insight.brand_id == brand_id, Insight.model_breakdown.isnot(None))
            .order_by(Insight.created_at.desc())
        )
        if not latest or not latest.model_breakdown:
            return {"brand": brand.name, "models": []}

        prompt_ids = list(await session.scalars(select(Prompt.id).where(Prompt.brand_id == brand_id)))
        latency_by_model: dict[str, list[int]] = {}
        if prompt_ids:
            runs = (await session.scalars(
                select(Run).where(Run.prompt_id.in_(prompt_ids), Run.latency_ms.isnot(None))
            )).all()
            for r in runs:
                latency_by_model.setdefault(r.model, []).append(r.latency_ms)

        models = []
        for m, v in sorted(latest.model_breakdown.items(), key=lambda x: -x[1]):
            lats = latency_by_model.get(m, [])
            avg_latency = round(sum(lats) / len(lats)) if lats else None
            models.append({"model": m, "visibility_pct": v, "avg_latency_ms": avg_latency})
        return {"brand": brand.name, "models": models}


@router.get("/{brand_id}/dark-matter")
async def get_dark_matter(brand_id: int, session_id: str = None, x_admin_key: str = Header(None)):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        require_read(brand, session_id, x_admin_key)

        probes = (await session.scalars(
            select(ProbePerformance)
            .where(ProbePerformance.brand_id == brand_id, ProbePerformance.run_count >= 1)
        )).all()

        dark = [p for p in probes if p.hit_count == 0]
        return {
            "dark_matter_count": len(dark),
            "total_probes": len(probes),
            "dark_matter_pct": round(len(dark) / max(len(probes), 1) * 100),
            "probes": [
                {"question": p.prompt_text, "times_tested": p.run_count}
                for p in dark[:5]
            ],
        }


@router.get("/{brand_id}/probe-detail")
async def get_probe_detail(brand_id: int, session_id: str = None, x_admin_key: str = Header(None)):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        require_read(brand, session_id, x_admin_key)

        latest_insight = await session.scalar(
            select(Insight).where(Insight.brand_id == brand_id)
            .order_by(Insight.created_at.desc())
        )
        if not latest_insight:
            return {"probes": [], "audit_date": None}

        probes = (await session.scalars(
            select(ProbePerformance)
            .where(ProbePerformance.brand_id == brand_id, ProbePerformance.run_count >= 1)
            .order_by(ProbePerformance.last_used.desc())
            .limit(10)
        )).all()

        return {
            "probes": [
                {
                    "question": p.prompt_text,
                    "hit_rate": round(p.hit_count / p.run_count * 100, 1) if p.run_count else 0,
                    "mentioned": p.hit_count,
                    "total_models": p.run_count,
                    "result": "strong" if p.hit_count / max(p.run_count, 1) >= 0.6 else "weak",
                }
                for p in probes
            ],
            "audit_date": latest_insight.created_at.isoformat(),
        }


@router.get("/{brand_id}/probe-performance")
async def get_probe_performance(brand_id: int, session_id: str = None, x_admin_key: str = Header(None)):
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        require_read(brand, session_id, x_admin_key)

        probes = (await session.scalars(
            select(ProbePerformance)
            .where(ProbePerformance.brand_id == brand_id, ProbePerformance.run_count >= 1)
        )).all()
        if not probes:
            return {"top": [], "bottom": []}

        def hit_rate(p):
            return p.hit_count / p.run_count

        ranked = sorted(probes, key=hit_rate, reverse=True)
        strong = [p for p in ranked if hit_rate(p) >= 0.6][:3]
        weak = [p for p in ranked if hit_rate(p) < 0.6][:3]

        def fmt(p):
            return {"prompt": p.prompt_text, "hit_rate": round(hit_rate(p) * 100, 1)}

        return {"top": [fmt(p) for p in strong], "bottom": [fmt(p) for p in weak]}
