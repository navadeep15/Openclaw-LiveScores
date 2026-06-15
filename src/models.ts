export type CommandPreset = "cricket" | "ipl";
export type SubscriptionMode = "balls" | "commentary";
export type MatchStatus = "live" | "upcoming" | "completed" | "unknown";

export interface MatchTeamLine {
  team: string;
  run?: string;
}

export interface NormalizedMatch {
  id: string;
  title: string;
  teams: MatchTeamLine[];
  overview: string;
  scoreLine?: string;
  venue?: string;
  startsAtLabel?: string;
  status: MatchStatus;
  queryText: string;
}

export interface BatterState {
  name: string;
  runs?: number;
  balls?: number;
}

export interface BowlerState {
  name: string;
  oversText?: string;
  runs?: number;
  wickets?: number;
}

export interface CompactLiveSnapshot {
  title: string;
  update: string;
  liveScore: string;
  runRate?: string;
  latestCommentary?: string;
  teamLabel?: string;
  totalRuns?: number;
  wickets?: number;
  balls?: number;
  oversText?: string;
  batsmen: BatterState[];
  bowlers: BowlerState[];
  status: MatchStatus;
}

export interface ChatTarget {
  channel: string;
  to: string;
  accountId?: string;
  threadId?: string | number;
  key: string;
}

export interface CricketSubscription {
  id: string;
  matchId: string;
  matchLabel: string;
  mode: SubscriptionMode;
  createdAtMs: number;
  updatedAtMs: number;
  lastPolledAtMs?: number;
  status: MatchStatus;
  target: ChatTarget;
  lastSnapshot?: CompactLiveSnapshot;
}

export interface LookupCacheEntry {
  storedAtMs: number;
  preset: CommandPreset;
  query: string;
  matches: NormalizedMatch[];
}

export interface PersistedState {
  version: 1;
  subscriptions: CricketSubscription[];
  lookups: Record<string, LookupCacheEntry>;
  targetConfigs: Record<string, TargetConfig>;
}

export interface TargetConfig {
  quietStart?: string;
  quietEnd?: string;
}

export interface DeliveryUpdate {
  key: string;
  ballLabel: string;
  ballSpan: number;
  runsDelta: number;
  wicketDelta: number;
  shortResult: string;
  commentary?: string;
  facingBatter?: string;
  dismissedBatter?: string;
  milestones: string[];
  isOverEnd: boolean;
  current: CompactLiveSnapshot;
  previous?: CompactLiveSnapshot;
}
