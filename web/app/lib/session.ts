// Session and admin mode helpers.
//
// Session ID: localStorage (persists across tabs — intentional, user sees same brands)
// Admin key: sessionStorage only (clears on tab close, not accessible cross-tab)
//   Rationale: admin key in localStorage survives browser restarts and is readable
//   by any JS on the page. sessionStorage limits exposure to the current tab lifetime.

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  if (isAdminMode()) return "admin";

  let session = localStorage.getItem("aura_session_id");
  if (!session) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    session = "sess_" + Array.from(buf, b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("aura_session_id", session);
  }
  return session;
}

// Admin key lives in localStorage so admin mode survives a reload or tab close —
// otherwise brands created as admin (owned by session "admin") would vanish from the
// new session on refresh. The server still verifies the real key on every privileged
// call, so this client persistence is a convenience, not a security boundary. Use
// exitAdmin() to clear it explicitly.
export function isAdminMode(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("aura_admin_mode") === "true" && !!localStorage.getItem("aura_admin_key");
}

export function setAdminMode(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("aura_admin_mode", enabled ? "true" : "false");
  if (!enabled) localStorage.removeItem("aura_admin_key");
}

export function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("aura_admin_key") || "";
}

export function setAdminKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("aura_admin_key", key);
}

export function exitAdmin(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("aura_admin_mode");
  localStorage.removeItem("aura_admin_key");
}

// Standard auth headers for API calls. The session token goes in the X-Session-Id
// HEADER (not a URL query param) so this bearer credential stays out of URLs, proxy
// access logs, and browser history. Admin key is added only in admin mode. Spread the
// result into a fetch's headers; merge with Content-Type when POSTing JSON.
export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "X-Session-Id": getSessionId() };
  if (isAdminMode()) h["X-Admin-Key"] = getAdminKey();
  return h;
}
