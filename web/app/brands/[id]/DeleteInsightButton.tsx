"use client";

import { Trash2 } from "lucide-react";
import { reloadPage } from "../../lib/navigation";
import { getSessionId, getAdminKey, isAdminMode } from "../../lib/session";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function DeleteInsightButton({ 
  brandId, 
  insightId, 
  brandSessionId 
}: { 
  brandId: number; 
  insightId: number; 
  brandSessionId?: string | null;
}) {
  const admin = isAdminMode();
  const isExample = brandSessionId === "example";

  // Hide delete button completely for preloaded example brands unless in admin mode
  if (isExample && !admin) {
    return null;
  }

  async function handleDelete() {
    if (!confirm("Delete this audit run?")) return;
    const sess = getSessionId();
    const headers: Record<string, string> = {};
    if (sess === "admin") {
      headers["X-Admin-Key"] = getAdminKey();
    }

    const res = await fetch(`${API}/brands/${brandId}/insights/${insightId}?session_id=${sess}`, { 
      method: "DELETE",
      headers
    });

    if (res.ok) {
      reloadPage();
    } else if (res.status === 401) {
      alert("Unauthorized: Invalid Admin Key");
    } else if (res.status === 403) {
      alert("Forbidden: You cannot delete this audit run");
    } else {
      alert("Failed to delete audit run");
    }
  }

  return (
    <button onClick={handleDelete}
      className="inline-flex items-center gap-1.5 text-zinc-500 hover:text-red-400 text-xs font-bold transition-colors py-2 px-3.5 rounded-lg hover:bg-red-500/10 min-h-[44px] min-w-[44px] justify-center"
      title="Delete this audit run"
      aria-label="Delete this audit run"
    >
      <Trash2 className="w-3.5 h-3.5" />
      <span>Delete</span>
    </button>
  );
}
