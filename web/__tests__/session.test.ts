import {
  getSessionId,
  isAdminMode,
  setAdminMode,
  getAdminKey,
  setAdminKey
} from "../app/lib/session";

describe("Session Utilities (Browser Environment)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe("getSessionId", () => {
    it("generates and stores a new random session ID when none exists", () => {
      const sessionId = getSessionId();
      expect(sessionId).toMatch(/^sess_[a-f0-9]+/);
      expect(localStorage.getItem("aura_session_id")).toBe(sessionId);
    });

    it("retrieves an existing session ID if already stored", () => {
      localStorage.setItem("aura_session_id", "my-test-session-id");
      expect(getSessionId()).toBe("my-test-session-id");
    });

    it("returns admin when admin mode is enabled and key is in sessionStorage", () => {
      localStorage.setItem("aura_admin_mode", "true");
      sessionStorage.setItem("aura_admin_key", "secret-admin-token");
      expect(getSessionId()).toBe("admin");
    });

    it("falls back to guest session when admin mode set but key missing", () => {
      localStorage.setItem("aura_admin_mode", "true");
      const sessionId = getSessionId();
      expect(sessionId).not.toBe("admin");
      expect(sessionId).toMatch(/^sess_/);
    });
  });

  describe("isAdminMode", () => {
    it("returns true when mode enabled and key in sessionStorage", () => {
      localStorage.setItem("aura_admin_mode", "true");
      sessionStorage.setItem("aura_admin_key", "secret-key");
      expect(isAdminMode()).toBe(true);
    });

    it("returns false when mode false or key missing", () => {
      localStorage.setItem("aura_admin_mode", "false");
      sessionStorage.setItem("aura_admin_key", "secret-key");
      expect(isAdminMode()).toBe(false);

      localStorage.setItem("aura_admin_mode", "true");
      sessionStorage.removeItem("aura_admin_key");
      expect(isAdminMode()).toBe(false);
    });
  });

  describe("setAdminMode", () => {
    it("saves admin mode and clears key when disabled", () => {
      sessionStorage.setItem("aura_admin_key", "x");
      setAdminMode(true);
      expect(localStorage.getItem("aura_admin_mode")).toBe("true");
      setAdminMode(false);
      expect(localStorage.getItem("aura_admin_mode")).toBe("false");
      expect(sessionStorage.getItem("aura_admin_key")).toBeNull();
    });
  });

  describe("getAdminKey and setAdminKey", () => {
    it("stores and retrieves admin key from sessionStorage", () => {
      setAdminKey("admin-password-value");
      expect(sessionStorage.getItem("aura_admin_key")).toBe("admin-password-value");
      expect(getAdminKey()).toBe("admin-password-value");
    });

    it("returns empty string when key is not set", () => {
      expect(getAdminKey()).toBe("");
    });
  });
});
