import os
import secrets
from datetime import timedelta
from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import select, delete as sql_delete
from src.api.auth import is_admin, require_read, require_owner_or_admin
from src.api.ratelimit import SlidingWindowLimiter, client_ip
from src.db import SessionLocal
from src.models import Brand, Prompt, Run, Mention, Insight, ProbePerformance
from src.pipeline.scorer import score_brand

router = APIRouter(prefix="/brands")

# Cap brand creation so a bot cannot flood the DB. 30 new brands per IP per hour is
# far above any legitimate use (the audit limit allows only 2 audits per session).
_create_limiter = SlidingWindowLimiter(max_events=30, window_seconds=3600)

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
        v = (v or "").strip()
        if not v:
            raise ValueError("Brand name cannot be empty")
        # Cap at the DB column width (String(255)) so an over-long name returns a
        # clean 422 instead of crashing on a DB truncation error (500).
        if len(v) > 200:
            raise ValueError("Brand name is too long (max 200 characters)")
        return v

    @field_validator("domain", "industry")
    @classmethod
    def field_within_db_width(cls, v: str) -> str:
        # domain/industry map to String(255)/String(100). Cap below those so an
        # over-long value returns 422 rather than a 500 DB truncation error.
        if v and len(v) > 100:
            raise ValueError("Value is too long (max 100 characters)")
        return v

    # Note: the reserved-session check ("admin"/"example") lives in the create_brand
    # route, not here, because it must allow session_id="admin" for an authenticated
    # admin (verified via X-Admin-Key) while still rejecting it for everyone else.


def _brand_scope(stmt, session_id, x_admin_key):
    if is_admin(session_id, x_admin_key):
        return stmt
    if session_id and session_id != "admin":
        return stmt.where((Brand.session_id == session_id) | (Brand.session_id == "example"))
    return stmt.where(Brand.session_id == "example")


@router.get("/industries")
async def list_industries():
    return INDUSTRIES


async def _build_report(session, brand: Brand) -> dict:
    """Assemble the read-only report payload for a brand: latest insight + model
    breakdown. Shared by the owner view and the public share link."""
    latest = await session.scalar(
        select(Insight).where(Insight.brand_id == brand.id)
        .order_by(Insight.created_at.desc())
    )
    if not latest:
        return {"brand": brand.name, "industry": brand.industry, "insight": None}
    return {
        "brand": brand.name,
        "industry": brand.industry,
        "insight": {
            "visibility_pct": latest.visibility_pct,
            "summary": latest.summary,
            "key_findings": latest.key_findings or [],
            "recommendations": latest.recommendations or [],
            "model_breakdown": latest.model_breakdown or {},
            "probe_count": latest.probe_count,
            "created_at": latest.created_at.isoformat(),
        },
    }


@router.get("/share/{token}")
async def get_shared_report(token: str):
    """Public, read-only report for a brand by its share token. No session required."""
    async with SessionLocal() as session:
        brand = await session.scalar(select(Brand).where(Brand.share_token == token))
        if not brand:
            raise HTTPException(404, "Shared report not found")
        return await _build_report(session, brand)


@router.post("/{brand_id}/share")
async def create_share_link(brand_id: int, session_id: str = None, x_admin_key: str = Header(None)):
    """Owner generates (or returns existing) a read-only share token for a brand."""
    async with SessionLocal() as session:
        brand = await session.get(Brand, brand_id)
        if not brand:
            raise HTTPException(404, "Brand not found")
        require_owner_or_admin(brand, session_id, x_admin_key)
        if not brand.share_token:
            brand.share_token = secrets.token_urlsafe(24)
            await session.commit()
        return {"token": brand.share_token}


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
async def create_brand(body: BrandCreate, request: Request, x_admin_key: str = Header(None)):
    # "example" is never assignable. "admin" is allowed only for an authenticated
    # admin (so the admin can create brands); a normal user faking session_id="admin"
    # without the real key is rejected.
    if body.session_id == "example":
        raise HTTPException(status_code=422, detail="Reserved session_id")
    if body.session_id == "admin" and not is_admin("admin", x_admin_key):
        raise HTTPException(status_code=422, detail="Reserved session_id")

    # Admins (verified above) are exempt from the per-IP create limiter, same as
    # they're exempt from the audit limit.
    if not is_admin(body.session_id, x_admin_key) and not _create_limiter.allow(client_ip(request)):
        raise HTTPException(
            status_code=429,
            detail="Too many brands created. Please wait before adding more.",
        )
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

        # Show only probes from the latest audit. Probes are updated (last_used = now)
        # during the run, then the insight is committed seconds later; so probes from the
        # latest audit have last_used within a short window before the insight timestamp.
        # The 10-minute buffer comfortably covers a full audit run.
        run_window_start = latest_insight.created_at - timedelta(minutes=10)
        probes = (await session.scalars(
            select(ProbePerformance)
            .where(
                ProbePerformance.brand_id == brand_id,
                ProbePerformance.run_count >= 1,
                ProbePerformance.last_used >= run_window_start,
            )
            .order_by(ProbePerformance.last_used.desc())
            .limit(10)
        )).all()

        # ProbePerformance aggregates per QUESTION (hit_count = times any model named
        # the brand, run_count = times asked), not per model. So the honest per-question
        # signal is simply found-vs-not. The per-MODEL breakdown lives in model-bias.
        return {
            "probes": [
                {
                    "question": p.prompt_text,
                    "found": p.hit_count > 0,
                    "result": "strong" if p.hit_count > 0 else "weak",
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
