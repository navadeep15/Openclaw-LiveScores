import { describe, expect, it } from "vitest";

import { inferDeliveryUpdate } from "../src/ball-delta.js";
import { matchesQueryFilter } from "../src/cricbuzz-provider.js";
import type { CompactLiveSnapshot, NormalizedMatch } from "../src/models.js";

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
      oversText: "15.3"
    });

    const update = inferDeliveryUpdate(previous, current);

    expect(update).not.toBeNull();
    expect(update?.ballLabel).toBe("15.1-15.3");
    expect(update?.ballSpan).toBe(3);
    expect(update?.commentary).toContain("Snapshot jump");
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
