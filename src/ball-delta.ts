import type { CompactLiveSnapshot, DeliveryUpdate } from "./models.js";
import { ballsToLabel, cleanText } from "./utils.js";

function describeRuns(runsDelta: number): string {
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

function summarizeCommentary(commentary: string | undefined): string | undefined {
  const value = cleanText(commentary);
  if (!value) {
    return undefined;
  }

  if (/\b(run out|stumped|lbw|bowled|caught|wicket)\b/i.test(value)) {
    return "WICKET";
  }

  if (/\bno ball\b/i.test(value)) {
    return "NO BALL";
  }

  if (/\bwide\b/i.test(value)) {
    return "WIDE";
  }

  if (/\bleg byes?\b/i.test(value)) {
    return "LEG BYE";
  }

  if (/\bbyes?\b/i.test(value)) {
    return "BYE";
  }

  if (/\bfour\b/i.test(value)) {
    return "FOUR";
  }

  if (/\bsix\b/i.test(value)) {
    return "SIX";
  }

  if (/\b(dot ball|no run)\b/i.test(value)) {
    return "Dot ball";
  }

  if (/\b(single|1 run|one run)\b/i.test(value)) {
    return "1 run";
  }

  if (/\b(couple|2 runs|two runs)\b/i.test(value)) {
    return "2 runs";
  }

  if (/\b(3 runs|three runs)\b/i.test(value)) {
    return "3 runs";
  }

  return undefined;
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
  if (current.latestCommentary) {
    return current.latestCommentary;
  }

  const facingBatter = detectFacingBatter(previous, current);
  const dismissedBatter = wicketDelta > 0 ? detectDismissedBatter(previous, current) : undefined;

  if (ballSpan > 1) {
    const wicketText = wicketDelta > 0 ? ` and ${wicketDelta} wicket${wicketDelta === 1 ? "" : "s"}` : "";
    return `Score updated by ${runsDelta} run${runsDelta === 1 ? "" : "s"}${wicketText}. Latest ball commentary was unavailable.`;
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

function detectMilestones(previous: CompactLiveSnapshot | undefined, current: CompactLiveSnapshot): string[] {
  const milestones: string[] = [];

  for (const batter of current.batsmen) {
    const runs = batter.runs ?? 0;
    const balls = batter.balls ?? 0;
    const prevBatter = previous?.batsmen.find((item) => item.name.toLowerCase() === batter.name.toLowerCase());
    const prevRuns = prevBatter?.runs ?? 0;

    if (runs >= 100 && prevRuns < 100) {
      milestones.push(`CENTURY! ${batter.name} reaches 100 (${runs} off ${balls} balls)`);
    } else if (runs >= 50 && prevRuns < 50) {
      milestones.push(`FIFTY! ${batter.name} reaches 50 (${runs} off ${balls} balls)`);
    }
  }

  for (const bowler of current.bowlers) {
    const wickets = bowler.wickets ?? 0;
    const prevBowler = previous?.bowlers.find((item) => item.name.toLowerCase() === bowler.name.toLowerCase());
    const prevWickets = prevBowler?.wickets ?? 0;

    if (wickets >= 5 && prevWickets < 5) {
      milestones.push(`5-WICKET HAUL! ${bowler.name} (${wickets}/${bowler.runs ?? 0})`);
    }
  }

  return milestones;
}

function resolveBallLabel(current: CompactLiveSnapshot, currentBalls: number, fromBall: number, toBall: number): string {
  if (current.oversText) {
    return current.oversText;
  }

  if (currentBalls > 0) {
    return ballsToLabel(currentBalls);
  }

  if (toBall > 0) {
    return ballsToLabel(toBall);
  }

  return ballsToLabel(fromBall);
}

function resolveShortResult(current: CompactLiveSnapshot, runsDelta: number, wicketDelta: number, ballSpan: number): string {
  const fromCommentary = summarizeCommentary(current.latestCommentary);
  if (fromCommentary) {
    if (wicketDelta > 0 && fromCommentary !== "WICKET") {
      return `${fromCommentary}, WICKET`;
    }

    return fromCommentary;
  }

  if (ballSpan > 1) {
    if (wicketDelta > 0 && runsDelta > 0) {
      return `Score update (+${runsDelta}), WICKET`;
    }

    if (wicketDelta > 0) {
      return "WICKET";
    }

    return runsDelta > 0 ? `Score update (+${runsDelta})` : "Score update";
  }

  return wicketDelta > 0 ? `${describeRuns(runsDelta)}${runsDelta > 0 ? ", " : ""}WICKET` : describeRuns(runsDelta);
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
      // Innings changed — don't produce a mega-update. Return null so the
      // service stores the current snapshot as the new baseline instead.
      return null;
    } else {
      fromBall = previous.balls + 1;
      ballSpan = Math.max(1, currentBalls - previous.balls);
      runsDelta = Math.max(0, currentRuns - previous.totalRuns);
      wicketDelta = Math.max(0, currentWickets - (previous.wickets ?? 0));
    }
  }

  const toBall = Math.max(fromBall, currentBalls);
  const shortResult = resolveShortResult(current, runsDelta, wicketDelta, ballSpan);
  const commentary = buildCommentary(previous, current, runsDelta, wicketDelta, ballSpan);
  const milestones = detectMilestones(previous, current);
  const isOverEnd = currentBalls > 0 && currentBalls % 6 === 0;

  return {
    key: `${current.teamLabel ?? "team"}|${currentRuns}|${currentWickets}|${currentBalls}|${current.batsmen.map((item) => `${item.name}:${item.runs ?? 0}:${item.balls ?? 0}`).join("|")}`,
    ballLabel: resolveBallLabel(current, currentBalls, fromBall, toBall),
    ballSpan,
    runsDelta,
    wicketDelta,
    shortResult,
    commentary,
    facingBatter: detectFacingBatter(previous, current),
    dismissedBatter: wicketDelta > 0 ? detectDismissedBatter(previous, current) : undefined,
    milestones,
    isOverEnd,
    current,
    previous
  };
}
