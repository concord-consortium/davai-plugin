export interface LlmEntry {
  id: string;
  provider: string;
  effortLevels?: string[];
  defaultEffort?: string;
}

export function findEntryById(llmList: LlmEntry[], id: string): LlmEntry | undefined {
  return llmList.find((e) => e.id === id);
}

export function findEntryByLlmId(llmList: LlmEntry[], llmId: string): LlmEntry | undefined {
  try {
    const { id } = JSON.parse(llmId);
    return llmList.find((e) => e.id === id);
  } catch {
    return undefined;
  }
}

// Resolve a valid effort for the given model entry. Prefers an explicitly requested value,
// then the currently-selected value, then the model's default. Returns "" for models with
// no effort support (empty/disabled menu) — and as the safety net when a config entry's
// defaultEffort is unset or not one of its effortLevels ("" means no effort is sent, so the
// provider applies its own default rather than receiving an invalid value).
export function resolveEffort(
  entry: LlmEntry | undefined,
  requested: string | null | undefined,
  current: string
): string {
  const levels = entry?.effortLevels ?? [];
  if (levels.length === 0) return "";
  if (requested && levels.includes(requested)) return requested;
  if (levels.includes(current)) return current;
  const fallback = entry?.defaultEffort ?? "";
  return levels.includes(fallback) ? fallback : "";
}
