"use client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function DeleteInsightButton({ brandId, insightId }: { brandId: number; insightId: number }) {
  async function handleDelete() {
    if (!confirm("Delete this audit run?")) return;
    await fetch(`${API}/brands/${brandId}/insights/${insightId}`, { method: "DELETE" });
    window.location.reload();
  }

  return (
    <button onClick={handleDelete}
      className="text-gray-600 hover:text-red-400 text-xs transition-colors"
      title="Delete this audit run"
    >
      ✕ delete
    </button>
  );
}
