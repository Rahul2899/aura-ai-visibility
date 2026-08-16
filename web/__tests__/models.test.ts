import { friendlyName, providerIcon, providerKey } from "../app/lib/models";

describe("Models library utilities", () => {
  describe("friendlyName", () => {
    it("maps the current OpenRouter panel to friendly names", () => {
      expect(friendlyName("openai/gpt-5.4-mini")).toBe("GPT-5.4 Mini");
      expect(friendlyName("google/gemini-3.7-flash")).toBe("Gemini 3.7 Flash");
      expect(friendlyName("x-ai/grok-4.3")).toBe("Grok 4.3");
      expect(friendlyName("anthropic/claude-haiku-4.5")).toBe("Claude Haiku 4.5");
    });

    it("still maps historical Bedrock IDs so old audits stay readable", () => {
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
      expect(providerIcon("google/gemini-3.7-flash")).toBe("🟢");
      expect(providerIcon("x-ai/grok-4.3")).toBe("⬛");
    });

    it("should return fallback emoji for unknown providers", () => {
      expect(providerIcon("unknown-provider-model")).toBe("⬜");
    });
  });

  describe("providerKey", () => {
    it("routes every current panel model to a themed provider, not 'generic'", () => {
      // ModelGrid looks up its badge theme by this key — an unmapped panel model
      // would silently render as an unbranded "AI Model" card.
      expect(providerKey("openai/gpt-5.4-mini")).toBe("openai");
      expect(providerKey("google/gemini-3.7-flash")).toBe("google");
      expect(providerKey("x-ai/grok-4.3")).toBe("xai");
      expect(providerKey("anthropic/claude-haiku-4.5")).toBe("anthropic");
    });
  });
});
