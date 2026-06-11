"use client";
import { useState } from "react";
import { ChevronDown, CheckCircle2, XCircle, HelpCircle, Eye } from "lucide-react";

type Probe = {
  question: string;
  found: boolean;
  result: "strong" | "weak";
};

export type ModelResponse = {
  model: string;
  response_text: string;
  brand_found: boolean;
  brand_position: number | null;
};
export type ResponseGroup = { question: string; responses: ModelResponse[] };

// Highlight every case-insensitive occurrence of `brand` in `text` with a brass mark.
// Rendered as React text nodes (never dangerouslySetInnerHTML) so model output can't
// inject markup — XSS-safe by construction.
function highlight(text: string, brand: string) {
  if (!brand || brand.length < 2) return text;
  const esc = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${esc})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === brand.toLowerCase()
      ? <mark key={i} style={{ background: "var(--accent-dim)", color: "var(--accent-2)", fontWeight: 700, borderRadius: 3, padding: "0 2px" }}>{part}</mark>
      : <span key={i}>{part}</span>
  );
}

function prettyModel(model: string) {
  // "nvidia.nemotron-super-3-120b" -> "Nemotron" style short label; fall back to raw.
  const base = model.split(/[./:]/).filter(Boolean).pop() ?? model;
  return base.replace(/-v\d.*$/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function AnswerReveal({ group, brandName }: { group: ResponseGroup; brandName: string }) {
  const [show, setShow] = useState(false);
  if (!group.responses.length) return null;
  return (
    <div className="mt-2">
      <button onClick={() => setShow(v => !v)}
        className="text-[11px] font-bold flex items-center gap-1 transition-colors"
        style={{ color: "var(--accent-2)" }}>
        <Eye className="w-3 h-3" />
        {show ? "Hide" : "See what each AI actually said"}
        <ChevronDown className={`w-3 h-3 transition-transform ${show ? "rotate-180" : ""}`} />
      </button>
      {show && (
        <div className="mt-2 space-y-2.5">
          {group.responses.map((r, i) => (
            <div key={i} className="rounded-lg border p-3" style={{ borderColor: "var(--border-solid)", background: "var(--surface-2-solid)" }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold" style={{ color: "var(--text-2)" }}>{prettyModel(r.model)}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                  r.brand_found ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-slate-400 bg-slate-50 border-slate-200"
                }`}>
                  {r.brand_found ? "✓ mentioned" : "not mentioned"}
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
                {highlight(r.response_text, brandName)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProbeDetail({
  probes, auditDate, responses = [], brandName = "",
}: {
  probes: Probe[];
  auditDate: string | null;
  responses?: ResponseGroup[];
  brandName?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!probes.length) return null;

  // Match each probe question to its stored model responses (by exact question text).
  const respByQ = new Map(responses.map(r => [r.question, r]));

  return (
    <details
      className="card overflow-hidden"
      open={open}
      onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="px-6 py-4 cursor-pointer flex items-center justify-between select-none hover:bg-slate-50/50 transition-colors">
        <div>
          <p className="text-slate-800 font-bold text-sm">
            The {probes.length} Questions We Asked AI Models
          </p>
          <p className="text-slate-400 text-xs mt-0.5">
            See exactly how we measured your brand&apos;s visibility — and what each model said
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </summary>

      <div className="border-t border-slate-100">
        <div className="px-6 py-3 bg-slate-50/50 flex items-center gap-2">
          <HelpCircle className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <p className="text-[11px] text-slate-400 font-semibold">
            Each question was sent to the AI models. &quot;Found&quot; means at least one model named your brand. Expand a question to read the verbatim answers.
          </p>
        </div>

        <div className="divide-y divide-slate-50">
          {probes.map((p, i) => {
            const group = respByQ.get(p.question);
            return (
              <div key={i} className="px-6 py-3.5">
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-400 tabular w-4 font-semibold flex-shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="text-sm text-slate-700 font-medium flex-1 leading-relaxed">{p.question}</p>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {p.found ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-lg border ${
                      p.found
                        ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                        : "text-red-600 bg-red-50 border-red-200"
                    }`}>
                      {p.found ? "Found" : "Not found"}
                    </span>
                  </div>
                </div>
                {group && <div className="pl-8"><AnswerReveal group={group} brandName={brandName} /></div>}
              </div>
            );
          })}
        </div>

        {auditDate && (
          <div className="px-6 py-3 border-t border-slate-100 text-[10px] text-slate-400 font-semibold">
            Audit run:{" "}
            {new Date(auditDate).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        )}
      </div>
    </details>
  );
}
