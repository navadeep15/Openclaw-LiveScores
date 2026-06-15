import { promises as fs } from "node:fs";
import path from "node:path";

import type { CricketSubscription, LookupCacheEntry, PersistedState, TargetConfig } from "./models.js";
import type { PluginApiLike } from "./openclaw.js";
import { resolvePluginConfig } from "./config.js";
import { trimRecord } from "./utils.js";

const STATE_FILE = "cricket-live-scores.state.json";

function normalizeSnapshot(raw: unknown): import("./models.js").CompactLiveSnapshot | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;

  if (typeof record.title !== "string" || typeof record.update !== "string" || typeof record.liveScore !== "string") {
    return undefined;
  }

  if (!Array.isArray(record.batsmen) || !Array.isArray(record.bowlers)) {
    return undefined;
  }

  return trimRecord(record) as unknown as import("./models.js").CompactLiveSnapshot;
}

function normalizeSubscription(raw: unknown): CricketSubscription | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const target = typeof record.target === "object" && record.target !== null ? (record.target as Record<string, unknown>) : null;

  if (!target) {
    return null;
  }

  if (typeof record.id !== "string" || typeof record.matchId !== "string" || typeof record.matchLabel !== "string") {
    return null;
  }

  if (typeof target.channel !== "string" || typeof target.to !== "string" || typeof target.key !== "string") {
    return null;
  }

  return {
    id: record.id,
    matchId: record.matchId,
    matchLabel: record.matchLabel,
    mode: record.mode === "commentary" ? "commentary" : "balls",
    createdAtMs: typeof record.createdAtMs === "number" ? record.createdAtMs : Date.now(),
    updatedAtMs: typeof record.updatedAtMs === "number" ? record.updatedAtMs : Date.now(),
    lastPolledAtMs: typeof record.lastPolledAtMs === "number" ? record.lastPolledAtMs : undefined,
    status:
      record.status === "live" || record.status === "upcoming" || record.status === "completed" || record.status === "unknown"
        ? record.status
        : "unknown",
    target: {
      channel: target.channel,
      to: target.to,
      accountId: typeof target.accountId === "string" ? target.accountId : undefined,
      threadId: typeof target.threadId === "string" || typeof target.threadId === "number" ? target.threadId : undefined,
      key: target.key
    },
    lastSnapshot: normalizeSnapshot(record.lastSnapshot)
  } as CricketSubscription;
}

function normalizeLookup(raw: unknown): LookupCacheEntry | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (
    !Array.isArray(record.matches) ||
    typeof record.storedAtMs !== "number" ||
    (record.preset !== "cricket" && record.preset !== "ipl") ||
    typeof record.query !== "string"
  ) {
    return null;
  }

  return {
    storedAtMs: record.storedAtMs,
    preset: record.preset,
    query: record.query,
    matches: trimRecord(record.matches)
  };
}

function normalizeTargetConfig(raw: unknown): TargetConfig | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const config: TargetConfig = {};

  if (typeof record.quietStart === "string" && /^\d{1,2}:\d{2}$/.test(record.quietStart)) {
    config.quietStart = record.quietStart;
  }
  if (typeof record.quietEnd === "string" && /^\d{1,2}:\d{2}$/.test(record.quietEnd)) {
    config.quietEnd = record.quietEnd;
  }

  return config;
}

function emptyState(): PersistedState {
  return {
    version: 1,
    subscriptions: [],
    lookups: {},
    targetConfigs: {}
  };
}

function isLegacyPlaceholderSubscription(subscription: CricketSubscription): boolean {
  if (subscription.lastSnapshot) {
    return false;
  }

  if (!/^\d+$/.test(subscription.matchId)) {
    return false;
  }

  return subscription.matchLabel === `Match ${subscription.matchId}`;
}

export class CricketStateStore {
  private cache: PersistedState | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly api: PluginApiLike) {}

  private resolveStatePath(): string {
    return path.join(this.api.runtime.state.resolveStateDir(), STATE_FILE);
  }

  private async loadState(): Promise<PersistedState> {
    if (this.cache) {
      return trimRecord(this.cache);
    }

    try {
      const content = await fs.readFile(this.resolveStatePath(), "utf8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const lookups = typeof parsed.lookups === "object" && parsed.lookups !== null ? (parsed.lookups as Record<string, unknown>) : {};
      const rawTargetConfigs = typeof parsed.targetConfigs === "object" && parsed.targetConfigs !== null ? (parsed.targetConfigs as Record<string, unknown>) : {};
      const next: PersistedState = {
        version: 1,
        subscriptions: Array.isArray(parsed.subscriptions)
          ? parsed.subscriptions.map((entry) => normalizeSubscription(entry)).filter((entry): entry is CricketSubscription => entry !== null)
          : [],
        lookups: Object.fromEntries(
          Object.entries(lookups)
            .map(([key, value]) => [key, normalizeLookup(value)] as const)
            .filter((entry): entry is [string, LookupCacheEntry] => entry[1] !== null)
        ),
        targetConfigs: Object.fromEntries(
          Object.entries(rawTargetConfigs)
            .map(([key, value]) => [key, normalizeTargetConfig(value)] as const)
            .filter((entry): entry is [string, TargetConfig] => entry[1] !== null)
        )
      };

      this.cache = next;
      return trimRecord(next);
    } catch {
      const next = emptyState();
      this.cache = next;
      return trimRecord(next);
    }
  }

  private async saveState(state: PersistedState): Promise<void> {
    this.cache = trimRecord(state);
    const filePath = this.resolveStatePath();
    const tmpPath = `${filePath}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tmpPath, filePath);
  }

  async read(): Promise<PersistedState> {
    const state = await this.loadState();
    return this.cleanup(state);
  }

  async hasSubscription(subscriptionId: string): Promise<boolean> {
    const state = await this.read();
    return state.subscriptions.some((item) => item.id === subscriptionId);
  }

  async mutate<T>(mutator: (state: PersistedState) => Promise<T> | T): Promise<T> {
    const operation = this.writeQueue.then(async () => {
      const loaded = await this.loadState();
      const cleaned = this.cleanup(loaded);
      const result = await mutator(cleaned);
      await this.saveState(cleaned);
      return result;
    });

    this.writeQueue = operation.then(
      () => undefined,
      () => undefined
    );

    return await operation;
  }

  private cleanup(state: PersistedState): PersistedState {
    const config = resolvePluginConfig(this.api.pluginConfig);
    const now = Date.now();
    const lookups = Object.fromEntries(
      Object.entries(state.lookups).filter(([, value]) => now - value.storedAtMs <= config.lookupCacheTtlMs)
    );
    const subscriptions = state.subscriptions.filter((subscription) => !isLegacyPlaceholderSubscription(subscription));

    return {
      ...state,
      subscriptions,
      lookups
    };
  }
}
