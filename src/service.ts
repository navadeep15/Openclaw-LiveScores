import { inferDeliveryUpdate } from "./ball-delta.js";
import { resolvePluginConfig } from "./config.js";
import { formatCompletionMessage, formatDeliveryMessage } from "./formatting.js";
import { toCompactLiveSnapshot } from "./live-state.js";
import type { CompactLiveSnapshot, CricketSubscription, MatchStatus } from "./models.js";
import type { PluginApiLike, ServiceDefinitionLike } from "./openclaw.js";
import type { CricbuzzProvider } from "./cricbuzz-provider.js";
import type { CricketStateStore } from "./state.js";
import { cleanText } from "./utils.js";

function isDue(subscription: CricketSubscription, now: number, livePollMs: number, preMatchPollMs: number): boolean {
  const interval = subscription.status === "live" ? livePollMs : preMatchPollMs;
  return now - (subscription.lastPolledAtMs ?? 0) >= interval;
}

function nextStatusFromSnapshot(snapshot: CompactLiveSnapshot): MatchStatus {
  return snapshot.status;
}

function shouldIgnoreLiveRegression(subscription: CricketSubscription, snapshot: CompactLiveSnapshot): boolean {
  const previouslyLive = subscription.status === "live" || subscription.lastSnapshot?.status === "live";
  if (!previouslyLive || snapshot.status === "completed") {
    return false;
  }

  return !cleanText(snapshot.liveScore);
}

async function sendText(api: PluginApiLike, subscription: CricketSubscription, text: string): Promise<void> {
  const adapter = await api.runtime.channel?.outbound?.loadAdapter(subscription.target.channel);
  if (typeof adapter?.sendText !== "function") {
    throw new Error(`No sendText adapter is available for ${subscription.target.channel}`);
  }

  await adapter.sendText({
    cfg: api.runtime.config.loadConfig?.() ?? api.config,
    to: subscription.target.to,
    text,
    accountId: subscription.target.accountId,
    threadId: subscription.target.threadId
  });
}

export function createCricketNotifierService(api: PluginApiLike, store: CricketStateStore, provider: CricbuzzProvider): ServiceDefinitionLike {
  let intervalHandle: NodeJS.Timeout | null = null;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;

    try {
      const config = resolvePluginConfig(api.pluginConfig);
      const now = Date.now();
      const state = await store.read();
      const dueSubscriptions = state.subscriptions.filter((item) => isDue(item, now, config.pollIntervalMs, config.preMatchPollIntervalMs));

      if (dueSubscriptions.length === 0) {
        return;
      }

      const snapshots = new Map<string, CompactLiveSnapshot>();

      for (const subscription of dueSubscriptions) {
        if (snapshots.has(subscription.matchId)) {
          continue;
        }

        try {
          const raw = await provider.fetchScore(subscription.matchId);
          snapshots.set(subscription.matchId, toCompactLiveSnapshot(raw));
        } catch (error) {
          api.logger.warn?.(`cricket-live-scores: failed to refresh match ${subscription.matchId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const patches = new Map<string, CricketSubscription | null>();

      for (const subscription of dueSubscriptions) {
        const snapshot = snapshots.get(subscription.matchId);
        if (!snapshot) {
          continue;
        }

        if (shouldIgnoreLiveRegression(subscription, snapshot)) {
          patches.set(subscription.id, {
            ...subscription,
            updatedAtMs: now,
            lastPolledAtMs: now,
            status: "live"
          });
          continue;
        }

        const nextStatus = nextStatusFromSnapshot(snapshot);
        const basePatch: CricketSubscription = {
          ...subscription,
          matchLabel: snapshot.title || subscription.matchLabel,
          updatedAtMs: now,
          lastPolledAtMs: now,
          status: nextStatus
        };

        if (snapshot.status === "completed") {
          if (!(await store.hasSubscription(subscription.id))) {
            patches.set(subscription.id, null);
            continue;
          }

          try {
            await sendText(api, subscription, formatCompletionMessage(basePatch, snapshot));
            patches.set(subscription.id, null);
          } catch (error) {
            api.logger.warn?.(`cricket-live-scores: failed to send completion update for ${subscription.matchId}: ${error instanceof Error ? error.message : String(error)}`);
          }

          continue;
        }

        const update = inferDeliveryUpdate(subscription.lastSnapshot, snapshot);
        if (!update) {
          basePatch.lastSnapshot = snapshot.status === "live" ? snapshot : subscription.lastSnapshot;
          patches.set(subscription.id, basePatch);
          continue;
        }

        try {
          if (!(await store.hasSubscription(subscription.id))) {
            patches.set(subscription.id, null);
            continue;
          }

          await sendText(api, subscription, formatDeliveryMessage(subscription, update));
          basePatch.lastSnapshot = snapshot;
          patches.set(subscription.id, basePatch);
        } catch (error) {
          api.logger.warn?.(`cricket-live-scores: failed to deliver update for ${subscription.matchId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (patches.size > 0) {
        await store.mutate((draft) => {
          draft.subscriptions = draft.subscriptions
            .map((subscription) => {
              if (!patches.has(subscription.id)) {
                return subscription;
              }

              return patches.get(subscription.id) ?? null;
            })
            .filter((subscription): subscription is CricketSubscription => subscription !== null);
        });
      }
    } finally {
      running = false;
    }
  };

  return {
    id: "cricket-live-scores-notifier",
    start: async () => {
      const config = resolvePluginConfig(api.pluginConfig);
      await tick().catch((error) => {
        api.logger.warn?.(`cricket-live-scores: initial poll failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      intervalHandle = setInterval(() => {
        tick().catch((error) => {
          api.logger.warn?.(`cricket-live-scores: poll failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, Math.min(config.pollIntervalMs, config.preMatchPollIntervalMs));
      intervalHandle.unref?.();
    },
    stop: async () => {
      if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    }
  };
}
