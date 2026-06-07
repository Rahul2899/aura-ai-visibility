const MODEL_NAMES: Record<string, string> = {
  // Current Frankfurt (eu.) lineup
  "eu.anthropic.claude-sonnet-4-6": "Claude Sonnet 4.6",
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0": "Claude Haiku 4.5",
  "eu.amazon.nova-2-lite-v1:0": "Nova 2 Lite",
  "eu.amazon.nova-pro-v1:0": "Nova Pro",
  // Historical / cross-region IDs that may appear in older stored audits
  "us.amazon.nova-pro-v1:0": "Nova Pro",
  "amazon.nova-micro-v1:0": "Nova Micro",
  "us.amazon.nova-micro-v1:0": "Nova Micro",
  "meta.llama3-3-70b-instruct-v1:0": "Llama 3.3 70B",
  "us.meta.llama3-3-70b-instruct-v1:0": "Llama 3.3 70B",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0": "Claude Haiku 4.5",
  "anthropic.claude-haiku-4-5": "Claude Haiku 4.5",
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0": "Claude Sonnet 4.5",
  "anthropic.claude-sonnet-4-5-20250929-v1:0": "Claude Sonnet 4.5",
  "mistral.mistral-large-2402-v1:0": "Mistral Large",
  "eu.mistral.pixtral-large-2502-v1:0": "Pixtral Large",
};

const PROVIDER_ICONS: Record<string, string> = {
  "nova": "🟡", "anthropic": "🟠", "claude": "🟠",
  "llama": "🔵", "meta": "🔵", "gemma": "🟢", "google": "🟢",
  "gpt": "⚫", "openai": "⚫", "glm": "🔷", "nemotron": "🟩", "hermes": "⚪",
};

export function friendlyName(modelId: string): string {
  if (MODEL_NAMES[modelId]) return MODEL_NAMES[modelId];
  // Defensive fallback: never surface a raw model ID. Strip cross-region prefixes
  // (eu./us./global./apac.), provider namespace, version/date suffixes, then title-case.
  let slug = modelId.split("/").pop()?.split(":")[0] ?? modelId;
  slug = slug.replace(/^(eu|us|global|apac)\./, "");          // region prefix
  slug = slug.replace(/^(anthropic|amazon|meta|mistral|ai21|cohere)\./, ""); // provider
  slug = slug.replace(/-v\d+(:\d+)?$/, "");                     // version (-v1:0)
  slug = slug.replace(/-\d{8}$/, "");                           // date stamp (-20251001)
  return slug.replace(/[-_.]/g, " ").trim()
    .split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
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
  if (lower.includes("mistral") || lower.includes("pixtral")) return "mistral";
  return "generic";
}
