import { friendlyName, providerIcon } from "../app/lib/models";

describe("Models library utilities", () => {
  describe("friendlyName", () => {
    it("maps the current Frankfurt (eu.) lineup to friendly names", () => {
      expect(friendlyName("eu.anthropic.claude-sonnet-4-6")).toBe("Claude Sonnet 4.6");
      expect(friendlyName("eu.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe("Claude Haiku 4.5");
      expect(friendlyName("eu.amazon.nova-2-lite-v1:0")).toBe("Nova 2 Lite");
      expect(friendlyName("eu.amazon.nova-pro-v1:0")).toBe("Nova Pro");
    });

    it("never leaks a raw model ID for unknown models", () => {
      // The defensive fallback must strip region prefixes, provider namespace, and
      // version/date suffixes — a user must never see "eu.anthropic..." in a report.
      const out = friendlyName("eu.anthropic.claude-opus-9-9-v1:0");
      expect(out).not.toMatch(/^eu\.|^us\.|anthropic\.|amazon\.|-v\d/);
      expect(out).toBe("Claude Opus 9 9");
      expect(friendlyName("some-vendor/new-cool-model-v2")).toBe("New Cool Model");
    });
  });

  describe("providerIcon", () => {
    it("should map model IDs to correct provider emojis", () => {
      expect(providerIcon("us.amazon.nova-pro-v1:0")).toBe("🟡");
      expect(providerIcon("us.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe("🟠");
      expect(providerIcon("meta.llama3-3-70b-instruct-v1:0")).toBe("🔵");
      expect(providerIcon("google/gemma-4-31b-it:free")).toBe("🟢");
      expect(providerIcon("openai/gpt-oss-120b:free")).toBe("⚫");
    });

    it("should return fallback emoji for unknown providers", () => {
      expect(providerIcon("unknown-provider-model")).toBe("⬜");
    });
  });
});
