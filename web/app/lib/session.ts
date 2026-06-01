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

export function isAdminMode(): boolean {
  if (typeof window === "undefined") return false;
  // Key lives in sessionStorage — clears when tab closes
  return localStorage.getItem("aura_admin_mode") === "true" && !!sessionStorage.getItem("aura_admin_key");
}

export function setAdminMode(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("aura_admin_mode", enabled ? "true" : "false");
  if (!enabled) sessionStorage.removeItem("aura_admin_key");
}

export function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem("aura_admin_key") || "";
}

export function setAdminKey(key: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem("aura_admin_key", key);
}
