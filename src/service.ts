import { inferDeliveryUpdate } from "./ball-delta.js";
import { resolvePluginConfig } from "./config.js";
import { formatCompletionMessage, formatDeliveryMessage, formatInningsChange, formatMatchStarted, formatStaleRemoval } from "./formatting.js";
import { toCompactLiveSnapshot } from "./live-state.js";
import type { CompactLiveSnapshot, CricketSubscription, MatchStatus, TargetConfig } from "./models.js";
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

function isInQuietHours(config: TargetConfig | undefined): boolean {
  if (!config?.quietStart || !config?.quietEnd) {
    return false;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startHour = 0, startMinute = 0] = config.quietStart.split(":").map(Number);
  const [endHour = 0, endMinute = 0] = config.quietEnd.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function isInningsChange(previous: CompactLiveSnapshot | undefined, current: CompactLiveSnapshot): boolean {
  if (!previous || previous.balls == null || current.balls == null) {
    return false;
  }

  return current.balls < previous.balls || (current.teamLabel != null && previous.teamLabel != null && current.teamLabel !== previous.teamLabel);
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
        const targetConfig = state.targetConfigs[subscription.target.key];

        // --- Stale subscription cleanup ---
        if (subscription.status === "upcoming" && snapshot.status === "upcoming" && now - subscription.createdAtMs > config.staleSubscriptionMs) {
          try {
            await sendText(api, subscription, formatStaleRemoval(basePatch));
          } catch (error) {
            api.logger.warn?.(`cricket-live-scores: failed to send stale removal for ${subscription.matchId}: ${error instanceof Error ? error.message : String(error)}`);
          }
          patches.set(subscription.id, null);
          continue;
        }

        // --- Match start alert ---
        if (subscription.status !== "live" && snapshot.status === "live" && !isInQuietHours(targetConfig)) {
          try {
            const freshState = await store.read();
            if (freshState.subscriptions.some((s) => s.id === subscription.id)) {
              await sendText(api, subscription, formatMatchStarted(basePatch, snapshot));
            }
          } catch (error) {
            api.logger.warn?.(`cricket-live-scores: failed to send match start alert for ${subscription.matchId}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        if (snapshot.status === "completed") {
          if (!(await store.hasSubscription(subscription.id))) {
            patches.set(subscription.id, null);
            continue;
          }

          try {
            const freshState = await store.read();
            if (!freshState.subscriptions.some((s) => s.id === subscription.id)) {
              continue;
            }
            // Always send completion messages even during quiet hours
            await sendText(api, subscription, formatCompletionMessage(basePatch, snapshot));
            patches.set(subscription.id, null);
          } catch (error) {
            api.logger.warn?.(`cricket-live-scores: failed to send completion update for ${subscription.matchId}: ${error instanceof Error ? error.message : String(error)}`);
          }

          continue;
        }

        const update = inferDeliveryUpdate(subscription.lastSnapshot, snapshot);
        if (!update) {
          // --- Innings change notification ---
          if (isInningsChange(subscription.lastSnapshot, snapshot) && !isInQuietHours(targetConfig)) {
            try {
              const freshState = await store.read();
              if (freshState.subscriptions.some((s) => s.id === subscription.id) && subscription.lastSnapshot) {
                await sendText(api, subscription, formatInningsChange(basePatch, subscription.lastSnapshot, snapshot));
              }
            } catch (error) {
              api.logger.warn?.(`cricket-live-scores: failed to send innings change for ${subscription.matchId}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          basePatch.lastSnapshot = snapshot.status === "live" ? snapshot : subscription.lastSnapshot;
          patches.set(subscription.id, basePatch);
          continue;
        }

        // --- Quiet hours: still update state but skip sending ---
        if (isInQuietHours(targetConfig)) {
          basePatch.lastSnapshot = snapshot;
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
