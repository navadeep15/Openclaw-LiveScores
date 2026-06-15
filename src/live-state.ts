import type { BatterState, BowlerState, CompactLiveSnapshot, MatchStatus } from "./models.js";
import { cleanText, oversToBalls, parseIntegerFromText } from "./utils.js";

export interface RawLiveScoreSnapshot {
  title: string;
  update: string;
  liveScore: string;
  runRate?: string;
  latestCommentary?: string;
  batsmanOne?: string;
  batsmanOneRun?: string;
  batsmanOneBall?: string;
  batsmanTwo?: string;
  batsmanTwoRun?: string;
  batsmanTwoBall?: string;
  bowlerOne?: string;
  bowlerOneOver?: string;
  bowlerOneRun?: string;
  bowlerOneWickets?: string;
  bowlerTwo?: string;
  bowlerTwoOver?: string;
  bowlerTwoRun?: string;
  bowlerTwoWicket?: string;
}

const COMPLETE_PATTERNS = /\b(won by|beat|abandoned|abandon|no result|match drawn|drawn|tied)\b/i;
const LIVE_PATTERNS = /\b(need|requires|trail|lead|session|stumps|lunch|tea|innings break|rain)\b/i;

function parseBatter(name: string | undefined, runs: string | undefined, balls: string | undefined): BatterState | null {
  const displayName = cleanText(name);
  if (!displayName) {
    return null;
  }

  return {
    name: displayName,
    runs: parseIntegerFromText(runs),
    balls: parseIntegerFromText(balls)
  };
}

function parseBowler(name: string | undefined, oversText: string | undefined, runs: string | undefined, wickets: string | undefined): BowlerState | null {
  const displayName = cleanText(name);
  if (!displayName) {
    return null;
  }

  return {
    name: displayName,
    oversText: cleanText(oversText) || undefined,
    runs: parseIntegerFromText(runs),
    wickets: parseIntegerFromText(wickets)
  };
}

function inferStatus(liveScore: string, update: string): MatchStatus {
  if (cleanText(liveScore)) {
    return "live";
  }

  if (COMPLETE_PATTERNS.test(update)) {
    return "completed";
  }

  if (LIVE_PATTERNS.test(update)) {
    return "live";
  }

  return "upcoming";
}

function parseLiveScoreLine(liveScore: string): {
  teamLabel?: string;
  totalRuns?: number;
  wickets?: number;
  oversText?: string;
  balls?: number;
} {
  const value = cleanText(liveScore);
  if (!value) {
    return {};
  }

  // Cricbuzz has used both slash and hyphen score separators (for example 46/0 and 46-0).
  const scoreMatch = value.match(/^(.*?)(\d+)(?:[/-](\d+))?\s*\((\d+(?:\.\d+)?)\)\s*$/);
  if (!scoreMatch) {
    return {};
  }

  const teamLabel = cleanText(scoreMatch[1]);
  const totalRuns = Number.parseInt(scoreMatch[2] ?? "", 10);
  let wickets = scoreMatch[3] ? Number.parseInt(scoreMatch[3], 10) : undefined;
  const oversText = cleanText(scoreMatch[4]);
  const balls = oversToBalls(oversText);

  // When wickets are omitted (e.g. "MI 180 (20.0)"), the team is likely all out
  if (wickets == null || !Number.isFinite(wickets)) {
    wickets = 10;
  }

  return {
    teamLabel: teamLabel || undefined,
    totalRuns: Number.isFinite(totalRuns) ? totalRuns : undefined,
    wickets,
    oversText: oversText || undefined,
    balls
  };
}

export function toCompactLiveSnapshot(raw: RawLiveScoreSnapshot): CompactLiveSnapshot {
  const title = cleanText(raw.title);
  const update = cleanText(raw.update);
  const liveScore = cleanText(raw.liveScore);
  const parsedScore = parseLiveScoreLine(liveScore);

  const batsmen = [parseBatter(raw.batsmanOne, raw.batsmanOneRun, raw.batsmanOneBall), parseBatter(raw.batsmanTwo, raw.batsmanTwoRun, raw.batsmanTwoBall)].filter(
    (value): value is BatterState => value !== null
  );

  const bowlers = [parseBowler(raw.bowlerOne, raw.bowlerOneOver, raw.bowlerOneRun, raw.bowlerOneWickets), parseBowler(raw.bowlerTwo, raw.bowlerTwoOver, raw.bowlerTwoRun, raw.bowlerTwoWicket)].filter(
    (value): value is BowlerState => value !== null
  );

  return {
    title,
    update,
    liveScore,
    runRate: cleanText(raw.runRate) || undefined,
    latestCommentary: cleanText(raw.latestCommentary) || undefined,
    ...parsedScore,
    batsmen,
    bowlers,
    status: inferStatus(liveScore, update)
  };
}
