import type { CompactLiveSnapshot, CricketSubscription, DeliveryUpdate, MatchStatus, NormalizedMatch, SubscriptionMode } from "./models.js";

function modeLabel(mode: SubscriptionMode): string {
  return mode === "commentary" ? "with commentary" : "balls only";
}

function statusBadge(status: MatchStatus): string {
  switch (status) {
    case "live":
      return "LIVE";
    case "upcoming":
      return "UPCOMING";
    case "completed":
      return "DONE";
    default:
      return "UNKNOWN";
  }
}

export function formatHelp(commandRoot: "cricket" | "ipl"): string {
  const prefix = `/${commandRoot}`;
  return [
    "Cricket live score commands:",
    "",
    `${prefix} matches [query]`,
    `${prefix} score <number|matchId>`,
    `${prefix} subscribe <number|matchId> balls`,
    `${prefix} subscribe <number|matchId> commentary`,
    `${prefix} subscriptions`,
    `${prefix} unsubscribe <number|matchId|all>`,
    `${prefix} mode <number|matchId> balls|commentary`,
    `${prefix} help`
  ].join("\n");
}

export function formatMatches(matches: NormalizedMatch[], commandRoot: "cricket" | "ipl", query: string): string {
  const lines = [`Matches for "${query}":`, ""];

  matches.forEach((match, index) => {
    lines.push(`${index + 1}. [${statusBadge(match.status)}] ${match.title}`);
    lines.push(`   id: ${match.id}`);

    if (match.scoreLine) {
      lines.push(`   score: ${match.scoreLine}`);
    }

    if (match.overview) {
      lines.push(`   note: ${match.overview}`);
    }

    if (match.startsAtLabel || match.venue) {
      lines.push(`   when: ${[match.startsAtLabel, match.venue].filter(Boolean).join(" | ")}`);
    }
  });

  lines.push("");
  lines.push(`Current score: /${commandRoot} score <number|matchId>`);
  lines.push(`Subscribe: /${commandRoot} subscribe <number|matchId> balls`);
  lines.push(`Commentary: /${commandRoot} subscribe <number|matchId> commentary`);
  return lines.join("\n");
}

export function formatSubscriptionList(subscriptions: CricketSubscription[], commandRoot: "cricket" | "ipl"): string {
  if (subscriptions.length === 0) {
    return `No active subscriptions in this chat.\n\nUse /${commandRoot} matches to list matches first.`;
  }

  const lines = ["Active subscriptions:", ""];

  subscriptions.forEach((subscription, index) => {
    lines.push(`${index + 1}. ${subscription.matchLabel}`);
    lines.push(`   match: ${subscription.matchId}`);
    lines.push(`   mode: ${modeLabel(subscription.mode)}`);
    lines.push(`   status: ${statusBadge(subscription.status)}`);
  });

  lines.push("");
  lines.push(`Change mode: /${commandRoot} mode <number|matchId> balls|commentary`);
  lines.push(`Unsubscribe: /${commandRoot} unsubscribe <number|matchId|all>`);
  return lines.join("\n");
}

export function formatSubscribeAck(subscription: CricketSubscription, baseline: CompactLiveSnapshot | undefined, commandRoot: "cricket" | "ipl"): string {
  const lines = [`Subscribed to ${subscription.matchLabel}.`, `Mode: ${modeLabel(subscription.mode)}.`];

  if (baseline?.liveScore) {
    lines.push(`Current score: ${baseline.liveScore}`);
  }

  if (baseline?.update) {
    lines.push(`Status: ${baseline.update}`);
  }

  lines.push("");
  lines.push("Automatic delivery is enabled. New messages will be pushed as the score changes.");
  lines.push(`Current score only: /${commandRoot} score <number|matchId>`);
  lines.push(`Manage subscriptions: /${commandRoot} subscriptions`);
  return lines.join("\n");
}

export function formatScoreSnapshot(matchLabel: string, snapshot: CompactLiveSnapshot, commandRoot: "cricket" | "ipl"): string {
  const lines = [matchLabel];

  if (snapshot.liveScore) {
    lines.push(snapshot.liveScore);
  }

  if (snapshot.update) {
    lines.push(snapshot.update);
  }

  lines.push("");
  lines.push(`Subscribe for automatic updates: /${commandRoot} subscribe <number|matchId> balls`);
  lines.push(`With commentary: /${commandRoot} subscribe <number|matchId> commentary`);
  return lines.join("\n");
}

export function formatModeUpdated(matchLabel: string, mode: SubscriptionMode): string {
  return `Updated ${matchLabel} to ${modeLabel(mode)}.`;
}

export function formatUnsubscribeResult(count: number): string {
  if (count <= 0) {
    return "No matching subscriptions found in this chat.";
  }

  return count === 1 ? "Unsubscribed from 1 match." : `Unsubscribed from ${count} matches.`;
}

export function formatDeliveryMessage(subscription: CricketSubscription, update: DeliveryUpdate): string {
  const lines = [subscription.matchLabel, `${update.ballLabel} | ${update.shortResult}`];

  if (update.current.liveScore) {
    lines.push(update.current.liveScore);
  }

  if (update.current.update) {
    lines.push(update.current.update);
  }

  if (subscription.mode === "commentary" && update.commentary) {
    lines.push("");
    lines.push(update.commentary);
  }

  return lines.join("\n");
}

export function formatCompletionMessage(subscription: CricketSubscription, snapshot: CompactLiveSnapshot): string {
  return [
    `${subscription.matchLabel} finished.`,
    snapshot.liveScore || "Final score unavailable",
    snapshot.update || "Match complete",
    "",
    "This subscription has been stopped automatically."
  ].join("\n");
}
