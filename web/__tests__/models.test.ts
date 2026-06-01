import { friendlyName, providerIcon } from "../app/lib/models";

describe("Models library utilities", () => {
  describe("friendlyName", () => {
    it("should map known model IDs to their friendly names", () => {
      expect(friendlyName("us.amazon.nova-pro-v1:0")).toBe("Nova Pro");
      expect(friendlyName("meta.llama3-3-70b-instruct-v1:0")).toBe("Llama 3.3 70B");
      expect(friendlyName("us.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe("Claude Haiku 4.5");
      expect(friendlyName("us.anthropic.claude-sonnet-4-5-20250929-v1:0")).toBe("Claude Sonnet 4.5");
      expect(friendlyName("google/gemma-4-31b-it:free")).toBe("Gemma 4 31B");
    });

    it("should format unknown model IDs gracefully", () => {
      expect(friendlyName("some-vendor/new-cool-model-v2")).toBe("New Cool Model");
      expect(friendlyName("unknown-brand")).toBe("Unknown Brand");
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
