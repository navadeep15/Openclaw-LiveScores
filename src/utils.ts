import type { ChatTarget } from "./models.js";
import type { CommandContextLike } from "./openclaw.js";

export function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeText(value: string): string {
  return cleanText(value).toLowerCase();
}

export function buildTargetKey(target: Omit<ChatTarget, "key">): string {
  return [
    target.channel.trim().toLowerCase(),
    target.to.trim(),
    target.accountId?.trim() ?? "",
    target.threadId == null ? "" : String(target.threadId)
  ].join("|");
}

export function resolveChatTarget(ctx: CommandContextLike): ChatTarget | null {
  const channel = cleanText(ctx.channel);
  const to = cleanText(ctx.from) || cleanText(ctx.to) || cleanText(ctx.senderId);

  if (!channel || !to) {
    return null;
  }

  const target = {
    channel,
    to,
    accountId: cleanText(ctx.accountId) || undefined,
    threadId: ctx.messageThreadId ?? undefined
  };

  return {
    ...target,
    key: buildTargetKey(target)
  };
}

export function parseCommandTokens(args: string | undefined): string[] {
  return cleanText(args).split(/\s+/).filter(Boolean);
}

export function normalizeSelectionToken(value: string | undefined): string {
  return cleanText(value).replace(/^[<([{]+/, "").replace(/[>\])}]+$/, "");
}

export function oversToBalls(oversText: string | undefined): number | undefined {
  const value = cleanText(oversText);
  if (!value) {
    return undefined;
  }

  const [oversPart, ballsPart] = value.split(".");
  const overs = Number.parseInt(oversPart ?? "", 10);

  if (!Number.isFinite(overs)) {
    return undefined;
  }

  if (!ballsPart) {
    return overs * 6;
  }

  const balls = Number.parseInt(ballsPart, 10);
  if (!Number.isFinite(balls)) {
    return undefined;
  }

  return overs * 6 + balls;
}

export function ballsToLabel(totalBalls: number): string {
  const zeroBased = Math.max(1, totalBalls) - 1;
  const over = Math.floor(zeroBased / 6);
  const ball = (zeroBased % 6) + 1;
  return `${over}.${ball}`;
}


export function uniqBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
}

export function trimRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function parseIntegerFromText(value: string | undefined): number | undefined {
  const match = cleanText(value).match(/-?\d+/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
