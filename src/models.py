from datetime import datetime
from typing import Optional
from sqlalchemy import (
    Integer, String, Text, DateTime, Float, Boolean, ForeignKey,
    Enum as SAEnum, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from src.db import Base
import enum


class SentimentEnum(str, enum.Enum):
    positive = "positive"
    neutral = "neutral"
    negative = "negative"


class Brand(Base):
    __tablename__ = "brands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    domain: Mapped[Optional[str]] = mapped_column(String(255))
    industry: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    competitors: Mapped[Optional[dict]] = mapped_column(JSONB, default=list)
    session_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Opaque token for read-only public sharing of this brand's report. Null until
    # the owner generates a share link.
    share_token: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True)
    # Soft delete: a user removing a brand sets this (hidden from THEIR dashboard but
    # kept in the DB so admin still sees it). An admin delete is a hard DB delete.
    hidden_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    prompts: Mapped[list["Prompt"]] = relationship(back_populates="brand")


class Prompt(Base):
    __tablename__ = "prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(100))

    brand: Mapped["Brand"] = relationship(back_populates="prompts")
    runs: Mapped[list["Run"]] = relationship(back_populates="prompt")


class Run(Base):
    __tablename__ = "runs"
    __table_args__ = (UniqueConstraint("content_hash", name="uq_runs_content_hash"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    prompt_id: Mapped[int] = mapped_column(ForeignKey("prompts.id"), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, default="bedrock")
    response_text: Mapped[Optional[str]] = mapped_column(Text)
    raw_json: Mapped[Optional[dict]] = mapped_column(JSONB)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer)
    tokens_in: Mapped[Optional[int]] = mapped_column(Integer)
    tokens_out: Mapped[Optional[int]] = mapped_column(Integer)
    run_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    prompt: Mapped["Prompt"] = relationship(back_populates="runs")
    mentions: Mapped[list["Mention"]] = relationship(back_populates="run")


class Mention(Base):
    __tablename__ = "mentions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), nullable=False)
    brand_name: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    sentiment: Mapped[SentimentEnum] = mapped_column(SAEnum(SentimentEnum), nullable=False)
    is_target_brand: Mapped[bool] = mapped_column(Boolean, default=False)
    cited_urls: Mapped[Optional[list]] = mapped_column(JSONB, default=list)

    run: Mapped["Run"] = relationship(back_populates="mentions")


class ApiCall(Base):
    __tablename__ = "api_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens_in: Mapped[Optional[int]] = mapped_column(Integer)
    tokens_out: Mapped[Optional[int]] = mapped_column(Integer)
    cost_usd: Mapped[Optional[float]] = mapped_column(Float)
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Insight(Base):
    __tablename__ = "insights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    probe_count: Mapped[int] = mapped_column(Integer, default=0)
    visibility_pct: Mapped[Optional[float]] = mapped_column(Float)
    model_breakdown: Mapped[Optional[dict]] = mapped_column(JSONB)
    key_findings: Mapped[Optional[list]] = mapped_column(JSONB)
    recommendations: Mapped[Optional[list]] = mapped_column(JSONB)
    cost_usd: Mapped[Optional[float]] = mapped_column(Float)
    raw_tool_calls: Mapped[Optional[list]] = mapped_column(JSONB)


class ProbePerformance(Base):
    __tablename__ = "probe_performance"
    __table_args__ = (
        UniqueConstraint("brand_id", "prompt_hash", name="uq_probe_brand_hash"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id"), nullable=False)
    prompt_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_text: Mapped[str] = mapped_column(Text, nullable=False)
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    run_count: Mapped[int] = mapped_column(Integer, default=0)
    last_used: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLimit(Base):
    __tablename__ = "audit_limits"

    # Rate-limit key: a session_id when available, else "ip:<addr>". Named generically
    # because it is no longer always an IP (see src.api.auth.limit_key).
    rate_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    audit_count: Mapped[int] = mapped_column(Integer, default=0)
    last_audit_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
