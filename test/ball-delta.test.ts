import { describe, expect, it } from "vitest";

import { inferDeliveryUpdate } from "../src/ball-delta.js";
import { matchesQueryFilter } from "../src/cricbuzz-provider.js";
import { formatDeliveryMessage, formatScoreSnapshot } from "../src/formatting.js";
import { toCompactLiveSnapshot } from "../src/live-state.js";
import type { CompactLiveSnapshot, CricketSubscription, NormalizedMatch } from "../src/models.js";
import { buildTargetKey, sameChatConversation } from "../src/utils.js";

function liveSnapshot(partial: Partial<CompactLiveSnapshot>): CompactLiveSnapshot {
  return {
    title: "Mumbai Indians vs Chennai Super Kings",
    update: "MI need 42 runs in 27 balls",
    liveScore: "MI 128/3 (15.3)",
    teamLabel: "MI",
    totalRuns: 128,
    wickets: 3,
    balls: 93,
    oversText: "15.3",
    batsmen: [
      { name: "Rohit Sharma", runs: 45, balls: 31 },
      { name: "Suryakumar Yadav", runs: 12, balls: 8 }
    ],
    bowlers: [{ name: "Ravindra Jadeja", oversText: "3.3", runs: 29, wickets: 1 }],
    status: "live",
    ...partial
  };
}

describe("inferDeliveryUpdate", () => {
  it("detects a boundary from a single-ball score jump", () => {
    const previous = liveSnapshot({});
    const current = liveSnapshot({
      liveScore: "MI 132/3 (15.4)",
      totalRuns: 132,
      balls: 94,
      oversText: "15.4",
      batsmen: [
        { name: "Rohit Sharma", runs: 49, balls: 32 },
        { name: "Suryakumar Yadav", runs: 12, balls: 8 }
      ]
    });

    const update = inferDeliveryUpdate(previous, current);

    expect(update).not.toBeNull();
    expect(update?.ballLabel).toBe("15.4");
    expect(update?.shortResult).toBe("FOUR");
    expect(update?.commentary).toContain("FOUR");
  });

  it("detects a wicket when the scorecard swaps a batter", () => {
    const previous = liveSnapshot({});
    const current = liveSnapshot({
      liveScore: "MI 128/4 (15.4)",
      wickets: 4,
      balls: 94,
      oversText: "15.4",
      batsmen: [
        { name: "Rohit Sharma", runs: 45, balls: 32 },
        { name: "Tilak Varma", runs: 0, balls: 0 }
      ]
    });

    const update = inferDeliveryUpdate(previous, current);

    expect(update).not.toBeNull();
    expect(update?.wicketDelta).toBe(1);
    expect(update?.dismissedBatter).toBe("Suryakumar Yadav");
    expect(update?.commentary).toContain("Wicket");
  });

  it("bundles missed deliveries into a range update", () => {
    const previous = liveSnapshot({
      liveScore: "MI 120/3 (15.0)",
      totalRuns: 120,
      balls: 90,
      oversText: "15.0"
    });
    const current = liveSnapshot({
      liveScore: "MI 126/3 (15.3)",
      totalRuns: 126,
      balls: 93,
      oversText: "15.3",
      latestCommentary: "Jadeja to Rohit, no run, punched to cover"
    });

    const update = inferDeliveryUpdate(previous, current);

    expect(update).not.toBeNull();
    expect(update?.ballLabel).toBe("15.3");
    expect(update?.ballSpan).toBe(3);
    expect(update?.shortResult).toBe("Dot ball");
    expect(update?.commentary).toContain("no run");
  });
});

describe("formatting", () => {
  it("does not append commentary in balls mode", () => {
    const update = inferDeliveryUpdate(
      liveSnapshot({}),
      liveSnapshot({
        liveScore: "MI 132/3 (15.4)",
        totalRuns: 132,
        balls: 94,
        oversText: "15.4",
        latestCommentary: "Jadeja to Rohit, FOUR, drilled past cover",
        batsmen: [
          { name: "Rohit Sharma", runs: 49, balls: 32 },
          { name: "Suryakumar Yadav", runs: 12, balls: 8 }
        ]
      })
    );

    const subscription: CricketSubscription = {
      id: "telegram|123|1",
      matchId: "1",
      matchLabel: "Mumbai Indians vs Chennai Super Kings",
      mode: "balls",
      createdAtMs: 1,
      updatedAtMs: 1,
      status: "live",
      target: {
        channel: "telegram",
        to: "123",
        key: "telegram|123||"
      }
    };

    const text = formatDeliveryMessage(subscription, update!);

    expect(text).toContain("15.4 | FOUR");
    expect(text).not.toContain("drilled past cover");
  });

  it("keeps one-shot score snapshots free of commentary text", () => {
    const text = formatScoreSnapshot(
      "Mumbai Indians vs Chennai Super Kings",
      liveSnapshot({
        latestCommentary: "Jadeja to Rohit, FOUR, drilled past cover"
      }),
      "ipl"
    );

    expect(text).not.toContain("Latest commentary");
    expect(text).not.toContain("drilled past cover");
  });
});

describe("matchesQueryFilter", () => {
  it("matches plain text tournament names", () => {
    const match: NormalizedMatch = {
      id: "1",
      title: "Mumbai Indians vs Chennai Super Kings, Indian Premier League 2026",
      teams: [
        { team: "Mumbai Indians" },
        { team: "Chennai Super Kings" }
      ],
      overview: "Match starts tonight",
      status: "upcoming",
      queryText: "mumbai indians chennai super kings indian premier league 2026 match starts tonight"
    };

    expect(matchesQueryFilter(match, "indian premier league")).toBe(true);
    expect(matchesQueryFilter(match, "mumbai")).toBe(true);
    expect(matchesQueryFilter(match, "royal challengers")).toBe(false);
  });
});

describe("toCompactLiveSnapshot", () => {
  it("parses hyphen-separated live scores from Cricbuzz", () => {
    const snapshot = toCompactLiveSnapshot({
      title: "Punjab Kings vs Sunrisers Hyderabad, 17th Match, Indian Premier League 2026",
      update: "Punjab Kings need 174 runs",
      liveScore: "PBKS 46-0 (3.1)",
      latestCommentary: "Jaydev Unadkat to Prabhsimran Singh, SIX"
    });

    expect(snapshot.teamLabel).toBe("PBKS");
    expect(snapshot.totalRuns).toBe(46);
    expect(snapshot.wickets).toBe(0);
    expect(snapshot.balls).toBe(19);
  });
});

describe("sameChatConversation", () => {
  it("treats prefixed and unprefixed Telegram recipients as the same chat", () => {
    expect(
      sameChatConversation(
        {
          channel: "telegram",
          to: "telegram:5362414540",
          accountId: "default",
          threadId: undefined
        },
        {
          channel: "telegram",
          to: "5362414540",
          accountId: "default",
          threadId: undefined
        }
      )
    ).toBe(true);
  });

  it("matches the same chat even when the current command has no thread id", () => {
    expect(
      sameChatConversation(
        {
          channel: "telegram",
          to: "5362414540",
          accountId: "default",
          threadId: "42"
        },
        {
          channel: "telegram",
          to: "5362414540",
          accountId: "default",
          threadId: undefined
        }
      )
    ).toBe(true);
  });

  it("does not cross channel or recipient boundaries", () => {
    expect(
      sameChatConversation(
        {
          channel: "telegram",
          to: "5362414540",
          accountId: "default",
          threadId: undefined
        },
        {
          channel: "whatsapp",
          to: "5362414540",
          accountId: "default",
          threadId: undefined
        }
      )
    ).toBe(false);
  });

  it("builds the same target key for prefixed and unprefixed Telegram recipients", () => {
    expect(
      buildTargetKey({
        channel: "telegram",
        to: "telegram:5362414540",
        accountId: "default",
        threadId: undefined
      })
    ).toBe(
      buildTargetKey({
        channel: "telegram",
        to: "5362414540",
        accountId: "default",
        threadId: undefined
      })
    );
  });
});
