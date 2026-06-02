import asyncio
from typing import Optional
import typer
import structlog
from dotenv import load_dotenv

load_dotenv()
structlog.configure(processors=[structlog.dev.ConsoleRenderer()])

from src.db import SessionLocal, engine, Base
from src.models import Brand, Prompt
from src.pipeline.runner import run_audit
from src.pipeline.scorer import score_brand
from src.eval.evaluate import run_eval as _run_eval
from src.agents.orchestrator import orchestrate

app = typer.Typer(help="Aura AI — Brand visibility analytics CLI")


@app.command()
def initdb():
    """Create all tables (run once after migrations are set up)."""
    async def _init():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    asyncio.run(_init())
    typer.echo("Tables created.")


@app.command()
def seed(
    brand_name: str = typer.Option(..., help="Brand name, e.g. Personio"),
    domain: str = typer.Option("", help="Brand domain"),
    prompts_file: Optional[str] = typer.Option(None, help="Path to .txt file with one prompt per line"),
):
    """Add a brand and its probe prompts to the database."""
    async def _seed():
        async with SessionLocal() as session:
            brand = Brand(name=brand_name, domain=domain or None, competitors=[])
            session.add(brand)
            await session.flush()

            if prompts_file:
                from pathlib import Path
                lines = Path(prompts_file).read_text().strip().splitlines()
                for line in lines:
                    line = line.strip()
                    if line:
                        session.add(Prompt(brand_id=brand.id, text=line, category="general"))
            else:
                # Default starter prompts
                defaults = [
                    f"What are the best HR software tools for German startups?",
                    f"Compare {brand_name} with its main competitors.",
                    f"Is {brand_name} recommended for mid-size companies?",
                    f"What do users say about {brand_name}?",
                    f"Best alternatives to {brand_name}?",
                ]
                for p in defaults:
                    session.add(Prompt(brand_id=brand.id, text=p, category="general"))

            await session.commit()
            typer.echo(f"Seeded brand '{brand_name}' (id={brand.id})")

    asyncio.run(_seed())


@app.command()
def audit(brand_id: int = typer.Argument(..., help="Brand ID from the database")):
    """Run a full audit for a brand across all configured models."""
    async def _audit():
        async with SessionLocal() as session:
            await run_audit(session, brand_id)

    asyncio.run(_audit())


@app.command()
def report(
    brand_id: int = typer.Argument(...),
    fmt: str = typer.Option("text", "--format", "-f", help="text or markdown"),
):
    """Print visibility scores for a brand."""
    async def _report():
        async with SessionLocal() as session:
            score = await score_brand(session, brand_id)

        if fmt == "markdown":
            print(f"## AI Visibility Report: {score.brand_name}\n")
            print(f"| Metric | Score |")
            print(f"|--------|-------|")
            print(f"| Visibility | {score.visibility_score:.1%} ({score.runs_with_target}/{score.total_runs} runs) |")
            print(f"| Share of Voice | {score.share_of_voice:.1%} |")
            print(f"| Position-Weighted Score | {score.position_weighted_score:.4f} |")
        else:
            print(f"\n=== {score.brand_name} ===")
            print(f"Visibility:              {score.visibility_score:.1%} ({score.runs_with_target}/{score.total_runs} runs)")
            print(f"Share of Voice:          {score.share_of_voice:.1%}")
            print(f"Position-Weighted Score: {score.position_weighted_score:.4f}")

    asyncio.run(_report())


@app.command()
def orchestrate_audit(
    brand_id: int = typer.Argument(..., help="Brand ID to audit"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Generate probes without making audit calls"),
):
    """Run an AI-orchestrated audit — Claude generates probes and synthesizes findings."""
    async def _run():
        async with SessionLocal() as session:
            insight = await orchestrate(session, brand_id, dry_run=dry_run)
        if insight:
            print(f"\n=== Orchestrated Audit Complete ===")
            print(f"Probes run:     {insight.probe_count}")
            print(f"Visibility:     {insight.visibility_pct:.1f}%")
            print(f"\nInsight:\n{insight.summary}")

    asyncio.run(_run())


@app.command()
def eval():
    """Run extractor precision/recall evaluation against labeled.jsonl."""
    asyncio.run(_run_eval())


if __name__ == "__main__":
    app()
