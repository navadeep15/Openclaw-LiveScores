import type { ChatTarget } from "./models.js";
import type { CommandContextLike } from "./openclaw.js";

export function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeText(value: string): string {
  return cleanText(value).toLowerCase();
}

export function normalizeChatRecipient(channel: string | undefined, value: string | undefined): string {
  const recipient = cleanText(value);
  const channelPrefix = cleanText(channel).toLowerCase();

  if (!recipient || !channelPrefix) {
    return recipient;
  }

  const prefix = `${channelPrefix}:`;
  return recipient.toLowerCase().startsWith(prefix) ? recipient.slice(prefix.length) : recipient;
}

function selectChatRecipient(channel: string, candidates: Array<string | undefined>): string {
  const cleaned = candidates.map((value) => cleanText(value)).filter(Boolean);
  if (cleaned.length === 0) {
    return "";
  }

  const preferred = cleaned.find((value) => value.toLowerCase().startsWith(`${channel.toLowerCase()}:`));
  return preferred ?? cleaned[0] ?? "";
}

export function buildTargetKey(target: Omit<ChatTarget, "key">): string {
  return [
    target.channel.trim().toLowerCase(),
    normalizeChatRecipient(target.channel, target.to),
    target.accountId?.trim() ?? "",
    target.threadId == null ? "" : String(target.threadId)
  ].join("|");
}

export function sameChatConversation(left: Pick<ChatTarget, "channel" | "to" | "accountId" | "threadId">, right: Pick<ChatTarget, "channel" | "to" | "accountId" | "threadId">): boolean {
  if (normalizeText(left.channel) !== normalizeText(right.channel)) {
    return false;
  }

  if (normalizeChatRecipient(left.channel, left.to) !== normalizeChatRecipient(right.channel, right.to)) {
    return false;
  }

  if (cleanText(left.accountId) !== cleanText(right.accountId)) {
    return false;
  }

  if (right.threadId == null || right.threadId === "") {
    return true;
  }

  return String(left.threadId ?? "") === String(right.threadId);
}

export function resolveChatTarget(ctx: CommandContextLike): ChatTarget | null {
  const channel = cleanText(ctx.channel);
  const to = selectChatRecipient(channel, [ctx.from, ctx.to, ctx.senderId]);

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
