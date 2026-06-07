from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.models import Brand

async def seed_example_brands(session: AsyncSession):
    hr_brands = [
        Brand(id=1004, name="Greenhouse", domain="greenhouse.io", industry="Applicant Tracking System", competitors=["Lever", "Ashby", "Workday"], session_id="example"),
        Brand(id=1005, name="Lever", domain="lever.co", industry="Applicant Tracking System", competitors=["Greenhouse", "Ashby", "Workday"], session_id="example"),
        Brand(id=1006, name="Ashby", domain="ashbyhq.com", industry="Applicant Tracking System", competitors=["Greenhouse", "Lever", "Rippling"], session_id="example"),
        Brand(id=1007, name="Workday", domain="workday.com", industry="HR Software", competitors=["SAP SuccessFactors", "Oracle HCM", "Rippling"], session_id="example"),
    ]
    for b in hr_brands:
        existing = await session.scalar(select(Brand).where(Brand.id == b.id))
        if not existing:
            session.add(b)

    await session.commit()
