from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.models import Brand

async def seed_example_brands(session: AsyncSession):
    hr_brands = [
        Brand(id=1003, name="Picked", domain="picked.ai", competitors=["Greenhouse", "Lever", "Ashby"], session_id="example"),
        Brand(id=1004, name="Greenhouse", domain="greenhouse.io", competitors=["Lever", "Ashby", "Workday"], session_id="example"),
        Brand(id=1005, name="Lever", domain="lever.co", competitors=["Greenhouse", "Ashby", "Workday"], session_id="example"),
        Brand(id=1006, name="Ashby", domain="ashbyhq.com", competitors=["Greenhouse", "Lever", "Rippling"], session_id="example"),
        Brand(id=1007, name="Workday", domain="workday.com", competitors=["SAP SuccessFactors", "Oracle HCM", "Rippling"], session_id="example"),
    ]
    for b in hr_brands:
        existing = await session.scalar(select(Brand).where(Brand.id == b.id))
        if not existing:
            session.add(b)

    await session.commit()
