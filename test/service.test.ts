import { describe, expect, it, vi } from "vitest";

import { createCricketNotifierService } from "../src/service.js";
import type { CompactLiveSnapshot, PersistedState } from "../src/models.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function liveSnapshot(partial: Partial<CompactLiveSnapshot> = {}): CompactLiveSnapshot {
  return {
    title: "Sunrisers Hyderabad vs Rajasthan Royals, 21st Match",
    update: "Rajasthan Royals need 118 runs in 47 balls",
    liveScore: "RR 99-5 (12.1)",
    teamLabel: "RR",
    totalRuns: 99,
    wickets: 5,
    balls: 73,
    oversText: "12.1",
    batsmen: [
      { name: "Dhruv Jurel", runs: 14, balls: 9 },
      { name: "Shimron Hetmyer", runs: 8, balls: 5 }
    ],
    bowlers: [{ name: "Pat Cummins", oversText: "3.1", runs: 24, wickets: 1 }],
    status: "live",
    ...partial
  };
}

function createStore(state: PersistedState) {
  return {
    state: clone(state),
    async read(): Promise<PersistedState> {
      return clone(this.state);
    },
    async hasSubscription(subscriptionId: string): Promise<boolean> {
      return this.state.subscriptions.some((item) => item.id === subscriptionId);
    },
    async mutate<T>(mutator: (draft: PersistedState) => Promise<T> | T): Promise<T> {
      const draft = clone(this.state);
      const result = await mutator(draft);
      this.state = draft;
      return result;
    }
  };
}

describe("createCricketNotifierService", () => {
  it("keeps a live subscription polling live when a scrape temporarily loses the score line", async () => {
    const sendText = vi.fn(async () => undefined);
    const warn = vi.fn();
    const store = createStore({
      version: 1,
      lookups: {},
      subscriptions: [
        {
          id: "telegram|5362414540|default||149800",
          matchId: "149800",
          matchLabel: "Sunrisers Hyderabad vs Rajasthan Royals, 21st Match",
          mode: "balls",
          createdAtMs: 1,
          updatedAtMs: 1,
          status: "live",
          target: {
            channel: "telegram",
            to: "telegram:5362414540",
            accountId: "default",
            key: "telegram|5362414540|default|"
          },
          lastSnapshot: liveSnapshot()
        }
      ]
    });

    const api = {
      config: {},
      pluginConfig: {
        pollIntervalMs: 10_000,
        preMatchPollIntervalMs: 45_000
      },
      runtime: {
        state: {
          resolveStateDir: () => "C:\\Users\\navad\\.openclaw"
        },
        channel: {
          outbound: {
            loadAdapter: async () => ({
              sendText
            })
          }
        },
        config: {
          loadConfig: () => ({})
        }
      },
      logger: {
        warn
      }
    };

    const provider = {
      fetchScore: vi.fn(async () => ({
        title: "Sunrisers Hyderabad vs Rajasthan Royals, 21st Match",
        update: "Match update unavailable",
        liveScore: ""
      }))
    };

    const service = createCricketNotifierService(api as never, store as never, provider as never);

    await service.start();
    await service.stop();

    expect(provider.fetchScore).toHaveBeenCalledWith("149800");
    expect(sendText).not.toHaveBeenCalled();
    expect(store.state.subscriptions).toHaveLength(1);
    expect(store.state.subscriptions[0]?.status).toBe("live");
    expect(store.state.subscriptions[0]?.lastSnapshot?.liveScore).toBe("RR 99-5 (12.1)");
  });
});
