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
  });

  describe("getSessionId", () => {
    it("should generate and store a new random session ID when none exists", () => {
      const sessionId = getSessionId();
      expect(sessionId).toMatch(/^sess_[a-z0-9]+/);
      expect(localStorage.getItem("aura_session_id")).toBe(sessionId);
    });

    it("should retrieve an existing session ID if already stored", () => {
      localStorage.setItem("aura_session_id", "my-test-session-id");
      const sessionId = getSessionId();
      expect(sessionId).toBe("my-test-session-id");
    });

    it("should return 'admin' if admin mode is enabled and an admin key is present", () => {
      localStorage.setItem("aura_admin_mode", "true");
      localStorage.setItem("aura_admin_key", "secret-admin-token");
      const sessionId = getSessionId();
      expect(sessionId).toBe("admin");
    });

    it("should fallback to generating session ID if admin mode is set but key is empty", () => {
      localStorage.setItem("aura_admin_mode", "true");
      localStorage.removeItem("aura_admin_key");
      const sessionId = getSessionId();
      expect(sessionId).not.toBe("admin");
      expect(sessionId).toMatch(/^sess_[a-z0-9]+/);
    });
  });

  describe("isAdminMode", () => {
    it("should return true when mode is enabled and key is present", () => {
      localStorage.setItem("aura_admin_mode", "true");
      localStorage.setItem("aura_admin_key", "secret-key");
      expect(isAdminMode()).toBe(true);
    });

    it("should return false when mode is false or key is missing", () => {
      localStorage.setItem("aura_admin_mode", "false");
      localStorage.setItem("aura_admin_key", "secret-key");
      expect(isAdminMode()).toBe(false);

      localStorage.setItem("aura_admin_mode", "true");
      localStorage.removeItem("aura_admin_key");
      expect(isAdminMode()).toBe(false);
    });
  });

  describe("setAdminMode", () => {
    it("should save admin mode enabled state in localStorage", () => {
      setAdminMode(true);
      expect(localStorage.getItem("aura_admin_mode")).toBe("true");

      setAdminMode(false);
      expect(localStorage.getItem("aura_admin_mode")).toBe("false");
    });
  });

  describe("getAdminKey and setAdminKey", () => {
    it("should store and retrieve admin key from localStorage", () => {
      setAdminKey("admin-password-value");
      expect(localStorage.getItem("aura_admin_key")).toBe("admin-password-value");
      expect(getAdminKey()).toBe("admin-password-value");
    });

    it("should return empty string when key is not set", () => {
      expect(getAdminKey()).toBe("");
    });
  });
});
