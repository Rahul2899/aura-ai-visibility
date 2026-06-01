/**
 * @jest-environment node
 */

import {
  getSessionId,
  isAdminMode,
  setAdminMode,
  getAdminKey,
  setAdminKey
} from "../app/lib/session";

describe("Session Utilities (SSR/Node Environment)", () => {
  it("should return empty string for getSessionId()", () => {
    expect(getSessionId()).toBe("");
  });

  it("should return false for isAdminMode()", () => {
    expect(isAdminMode()).toBe(false);
  });

  it("should do nothing or handle silently setAdminMode()", () => {
    expect(() => setAdminMode(true)).not.toThrow();
  });

  it("should return empty string for getAdminKey()", () => {
    expect(getAdminKey()).toBe("");
  });

  it("should do nothing or handle silently setAdminKey()", () => {
    expect(() => setAdminKey("secret")).not.toThrow();
  });
});
