// Shared brand-creation logic used by the homepage form and the compare page,
// so validation and the create call behave identically everywhere.
import { getSessionId, getAdminKey } from "./session";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type NewBrand = { name: string; domain?: string; industry?: string };

export function validateBrand(name: string, domain?: string): string | null {
  const n = name.trim();
  if (n.length < 2) return "Brand name must be at least 2 characters.";
  if (n.length > 100) return "Brand name is too long (max 100 characters).";
  const d = (domain ?? "").trim();
  if (d) {
    const bare = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(bare)) {
      return "Domain looks invalid. Use a format like example.com.";
    }
  }
  return null;
}

export type CreateResult =
  | { ok: true; id: number; name: string }
  | { ok: false; error: string };

export async function createBrand(input: NewBrand): Promise<CreateResult> {
  try {
    const sess = getSessionId();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // In admin mode getSessionId() returns "admin"; the backend only accepts that
    // session_id with a valid X-Admin-Key, so forward it (else admin create -> 422).
    if (sess === "admin") headers["X-Admin-Key"] = getAdminKey();
    const res = await fetch(`${API}/brands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: input.name.trim(),
        domain: input.domain?.trim() || "",
        industry: input.industry || "",
        session_id: sess,
      }),
    });
    if (res.status === 429) {
      return { ok: false, error: "You've added a lot of brands recently. Please wait and try again." };
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.detail?.[0]?.msg ?? err.detail ?? "Couldn't create the brand. Please try again.";
      return { ok: false, error: typeof msg === "string" ? msg : "Couldn't create the brand." };
    }
    const brand = await res.json();
    return { ok: true, id: brand.id, name: brand.name };
  } catch {
    return { ok: false, error: "Network error. Check your connection and try again." };
  }
}
