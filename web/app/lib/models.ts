const MODEL_NAMES: Record<string, string> = {
  "us.amazon.nova-pro-v1:0": "Nova Pro",
  "amazon.nova-micro-v1:0": "Nova Micro",
  "us.amazon.nova-micro-v1:0": "Nova Micro",
  "meta.llama3-3-70b-instruct-v1:0": "Llama 3.3 70B",
  "us.meta.llama3-3-70b-instruct-v1:0": "Llama 3.3 70B",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0": "Claude Haiku 4.5",
  "anthropic.claude-haiku-4-5": "Claude Haiku 4.5",
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0": "Claude Sonnet 4.5",
  "anthropic.claude-sonnet-4-5-20250929-v1:0": "Claude Sonnet 4.5",
  "google/gemma-4-31b-it:free": "Gemma 4 31B",
  "openai/gpt-oss-120b:free": "GPT-OSS 120B",
  "openai/gpt-oss-20b:free": "GPT-OSS 20B",
  "z-ai/glm-4.5-air:free": "GLM 4.5 Air",
  "nvidia/nemotron-super-49b-v1:free": "Nemotron Super",
  "meta-llama/llama-3.3-70b-instruct:free": "Llama 3.3 70B",
  "nousresearch/hermes-3-llama-3.1-405b:free": "Hermes 3 405B",
};

const PROVIDER_ICONS: Record<string, string> = {
  "nova": "🟡", "anthropic": "🟠", "claude": "🟠",
  "llama": "🔵", "meta": "🔵", "gemma": "🟢", "google": "🟢",
  "gpt": "⚫", "openai": "⚫", "glm": "🔷", "nemotron": "🟩", "hermes": "⚪",
};

export function friendlyName(modelId: string): string {
  if (MODEL_NAMES[modelId]) return MODEL_NAMES[modelId];
  const slug = modelId.split("/").pop()?.split(":")[0] ?? modelId;
  return slug.replace(/[-_]/g, " ").replace(/v\d+$/, "").trim()
    .split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function providerIcon(modelId: string): string {
  const lower = modelId.toLowerCase();
  for (const [key, icon] of Object.entries(PROVIDER_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "⬜";
}

export function providerKey(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes("nova") || lower.includes("amazon")) return "amazon";
  if (lower.includes("claude") || lower.includes("anthropic")) return "anthropic";
  if (lower.includes("llama") || lower.includes("meta")) return "meta";
  if (lower.includes("gemma") || lower.includes("google")) return "google";
  if (lower.includes("gpt") || lower.includes("openai")) return "openai";
  return "generic";
}
