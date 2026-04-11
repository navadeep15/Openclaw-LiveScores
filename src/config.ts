function asInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const next = value ?? fallback;
  return Math.max(min, Math.min(max, next));
}

export interface ResolvedPluginConfig {
  cricbuzzBaseUrl: string;
  pollIntervalMs: number;
  preMatchPollIntervalMs: number;
  requestTimeoutMs: number;
  defaultQuery: string;
  listLimit: number;
  maxSubscriptionsPerChat: number;
  lookupCacheTtlMs: number;
}

export function resolvePluginConfig(raw: unknown): ResolvedPluginConfig {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  return {
    cricbuzzBaseUrl: asString(source.cricbuzzBaseUrl) ?? "https://www.cricbuzz.com",
    pollIntervalMs: clamp(asInteger(source.pollIntervalMs), 10_000, 5_000, 120_000),
    preMatchPollIntervalMs: clamp(asInteger(source.preMatchPollIntervalMs), 45_000, 10_000, 300_000),
    requestTimeoutMs: clamp(asInteger(source.requestTimeoutMs), 12_000, 1_000, 30_000),
    defaultQuery: asString(source.defaultQuery) ?? "ipl",
    listLimit: clamp(asInteger(source.listLimit), 8, 3, 30),
    maxSubscriptionsPerChat: clamp(asInteger(source.maxSubscriptionsPerChat), 5, 1, 20),
    lookupCacheTtlMs: clamp(asInteger(source.lookupCacheTtlMs), 30 * 60 * 1000, 60_000, 30 * 60 * 1000)
  };
}
