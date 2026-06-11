from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.models import Brand

# Demo brands shown to every visitor — deliberately spread across four DIFFERENT
# domains (SaaS, chocolate/CPG, fintech, retail) so a first-time visitor sees that
# Aura audits ANY industry, not just one vertical. Each carries real audit data
# (scores are produced by a genuine audit run, never hand-written).
async def seed_example_brands(session: AsyncSession):
    example_brands = [
        Brand(id=1004, name="Notion", domain="notion.so", industry="SaaS / Productivity Software", competitors=["Coda", "Confluence", "Obsidian"], session_id="example"),
        Brand(id=1005, name="Lindt", domain="lindt.com", industry="Premium Chocolate", competitors=["Godiva", "Ghirardelli", "Ferrero Rocher"], session_id="example"),
        Brand(id=1006, name="Wise", domain="wise.com", industry="Fintech / Money Transfer", competitors=["Revolut", "PayPal", "Remitly"], session_id="example"),
        Brand(id=1007, name="Nike", domain="nike.com", industry="Retail / Athletic Apparel", competitors=["Adidas", "Puma", "New Balance"], session_id="example"),
    ]
    for b in example_brands:
        existing = await session.scalar(select(Brand).where(Brand.id == b.id))
        if not existing:
            session.add(b)

    await session.commit()
