"use client";
import { useState } from "react";
import { ChevronDown, CheckCircle2, XCircle, HelpCircle } from "lucide-react";

type Probe = {
  question: string;
  found: boolean;
  result: "strong" | "weak";
};

export default function ProbeDetail({ probes, auditDate }: { probes: Probe[]; auditDate: string | null }) {
  const [open, setOpen] = useState(false);
  if (!probes.length) return null;

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
            See exactly how we measured your brand&apos;s visibility
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </summary>

      <div className="border-t border-slate-100">
        <div className="px-6 py-3 bg-slate-50/50 flex items-center gap-2">
          <HelpCircle className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <p className="text-[11px] text-slate-400 font-semibold">
            Each question was sent to the AI models. &quot;Found&quot; means at least one model named your brand. The per-model breakdown is in Model Breakdown above.
          </p>
        </div>

        <div className="divide-y divide-slate-50">
          {probes.map((p, i) => (
            <div key={i} className="px-6 py-3.5 flex items-center gap-4">
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
          ))}
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
