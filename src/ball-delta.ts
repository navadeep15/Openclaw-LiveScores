import type { CompactLiveSnapshot, DeliveryUpdate } from "./models.js";
import { ballRangeLabel } from "./utils.js";

function describeRuns(runsDelta: number, ballSpan: number): string {
  if (ballSpan > 1) {
    return `+${runsDelta} runs`;
  }

  switch (runsDelta) {
    case 0:
      return "Dot ball";
    case 1:
      return "1 run";
    case 2:
      return "2 runs";
    case 3:
      return "3 runs";
    case 4:
      return "FOUR";
    case 6:
      return "SIX";
    default:
      return `+${runsDelta} runs`;
  }
}

function detectDismissedBatter(previous: CompactLiveSnapshot | undefined, current: CompactLiveSnapshot): string | undefined {
  if (!previous) {
    return undefined;
  }

  const currentNames = new Set(current.batsmen.map((item) => item.name.toLowerCase()));
  const missing = previous.batsmen.find((item) => !currentNames.has(item.name.toLowerCase()));
  return missing?.name;
}

function detectFacingBatter(previous: CompactLiveSnapshot | undefined, current: CompactLiveSnapshot): string | undefined {
  if (!previous) {
    return current.batsmen[0]?.name;
  }

  for (const batter of current.batsmen) {
    const previousBatter = previous.batsmen.find((item) => item.name.toLowerCase() === batter.name.toLowerCase());
    if (!previousBatter) {
      return batter.name;
    }

    if ((batter.balls ?? 0) > (previousBatter.balls ?? 0)) {
      return batter.name;
    }
  }

  return current.batsmen[0]?.name;
}

function buildCommentary(previous: CompactLiveSnapshot | undefined, current: CompactLiveSnapshot, runsDelta: number, wicketDelta: number, ballSpan: number): string {
  if (ballSpan === 1 && current.latestCommentary) {
    return current.latestCommentary;
  }

  const facingBatter = detectFacingBatter(previous, current);
  const dismissedBatter = wicketDelta > 0 ? detectDismissedBatter(previous, current) : undefined;

  if (ballSpan > 1) {
    const wicketText = wicketDelta > 0 ? ` and ${wicketDelta} wicket${wicketDelta === 1 ? "" : "s"}` : "";
    return `Snapshot jump: ${runsDelta} run${runsDelta === 1 ? "" : "s"}${wicketText} across ${ballSpan} balls.`;
  }

  if (wicketDelta > 0) {
    const batterText = dismissedBatter ? ` ${dismissedBatter} departs.` : " A wicket falls.";
    const runText = runsDelta > 0 ? ` ${runsDelta} run${runsDelta === 1 ? "" : "s"} came with it.` : "";
    return `Wicket.${batterText}${runText}`.trim();
  }

  switch (runsDelta) {
    case 0:
      return facingBatter ? `Dot ball to ${facingBatter}.` : "Dot ball.";
    case 1:
      return facingBatter ? `${facingBatter} works a single.` : "A single is taken.";
    case 2:
      return facingBatter ? `${facingBatter} picks up a couple.` : "Two runs added.";
    case 3:
      return facingBatter ? `${facingBatter} hustles back for three.` : "Three runs added.";
    case 4:
      return facingBatter ? `FOUR. ${facingBatter} finds the boundary.` : "FOUR.";
    case 6:
      return facingBatter ? `SIX. ${facingBatter} clears the ropes.` : "SIX.";
    default:
      return `${runsDelta} runs added on the ball.`;
  }
}

export function inferDeliveryUpdate(previous: CompactLiveSnapshot | undefined, current: CompactLiveSnapshot): DeliveryUpdate | null {
  const currentBalls = current.balls;
  const currentRuns = current.totalRuns;
  const currentWickets = current.wickets ?? 0;

  if (current.status !== "live" || currentBalls == null || currentRuns == null) {
    return null;
  }

  let fromBall = 1;
  let ballSpan = currentBalls;
  let runsDelta = currentRuns;
  let wicketDelta = currentWickets;

  if (previous?.status === "live" && previous.balls != null && previous.totalRuns != null) {
    if (
      previous.balls === currentBalls &&
      previous.totalRuns === currentRuns &&
      (previous.wickets ?? 0) === currentWickets &&
      previous.liveScore === current.liveScore
    ) {
      return null;
    }

    if (currentBalls < previous.balls) {
      fromBall = 1;
      ballSpan = currentBalls;
      runsDelta = currentRuns;
      wicketDelta = currentWickets;
    } else {
      fromBall = previous.balls + 1;
      ballSpan = Math.max(1, currentBalls - previous.balls);
      runsDelta = Math.max(0, currentRuns - previous.totalRuns);
      wicketDelta = Math.max(0, currentWickets - (previous.wickets ?? 0));
    }
  }

  const toBall = Math.max(fromBall, currentBalls);
  const shortResult = wicketDelta > 0 ? `${describeRuns(runsDelta, ballSpan)}${runsDelta > 0 ? ", " : ""}WICKET` : describeRuns(runsDelta, ballSpan);
  const commentary = buildCommentary(previous, current, runsDelta, wicketDelta, ballSpan);

  return {
    key: `${current.teamLabel ?? "team"}|${currentRuns}|${currentWickets}|${currentBalls}|${current.batsmen.map((item) => `${item.name}:${item.runs ?? 0}:${item.balls ?? 0}`).join("|")}`,
    ballLabel: ballRangeLabel(fromBall, toBall),
    ballSpan,
    runsDelta,
    wicketDelta,
    shortResult,
    commentary,
    facingBatter: detectFacingBatter(previous, current),
    dismissedBatter: wicketDelta > 0 ? detectDismissedBatter(previous, current) : undefined,
    current,
    previous
  };
}
