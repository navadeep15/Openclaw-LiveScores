import type { CommandPreset, CricketSubscription, MatchStatus, NormalizedMatch, SubscriptionMode } from "./models.js";
import type { CommandContextLike, CommandResponseLike, PluginApiLike } from "./openclaw.js";
import type { CricbuzzProvider } from "./cricbuzz-provider.js";
import type { CricketStateStore } from "./state.js";
import { resolvePluginConfig } from "./config.js";
import { formatHelp, formatMatches, formatModeUpdated, formatScoreSnapshot, formatSubscribeAck, formatSubscriptionList, formatUnsubscribeResult } from "./formatting.js";
import { toCompactLiveSnapshot } from "./live-state.js";
import { cleanText, normalizeSelectionToken, parseCommandTokens, resolveChatTarget } from "./utils.js";

function resolveMode(input: string | undefined): SubscriptionMode | null {
  const value = cleanText(input).toLowerCase();

  if (!value) {
    return "balls";
  }

  if (["balls", "ball", "score", "live"].includes(value)) {
    return "balls";
  }

  if (["commentary", "comment", "comm"].includes(value)) {
    return "commentary";
  }

  return null;
}

function resolveSearchQuery(tokens: string[], preset: CommandPreset, api: PluginApiLike): string {
  const explicit = cleanText(tokens.join(" "));
  if (explicit) {
    return explicit;
  }

  return preset === "ipl" ? "ipl" : resolvePluginConfig(api.pluginConfig).defaultQuery;
}

function isSupportedStatus(status: MatchStatus): boolean {
  return status === "live" || status === "upcoming" || status === "unknown";
}

async function ensureSendTextAvailable(api: PluginApiLike, channel: string): Promise<boolean> {
  const adapter = await api.runtime.channel?.outbound?.loadAdapter(channel);
  return typeof adapter?.sendText === "function";
}

function matchLabelForSelection(match: NormalizedMatch): string {
  return cleanText(match.title) || match.id;
}

function resolveLookupSelection(selection: string, matches: NormalizedMatch[]): NormalizedMatch | null {
  const numeric = Number.parseInt(selection, 10);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= matches.length) {
    return matches[numeric - 1] ?? null;
  }

  return matches.find((item) => item.id === selection) ?? null;
}

function findTargetSubscriptions(subscriptions: CricketSubscription[], targetKey: string): CricketSubscription[] {
  return subscriptions.filter((item) => item.target.key === targetKey);
}

function isAmbiguousListSelection(selection: string, api: PluginApiLike): boolean {
  const numeric = Number.parseInt(selection, 10);
  if (!Number.isFinite(numeric)) {
    return false;
  }

  return numeric >= 1 && numeric <= resolvePluginConfig(api.pluginConfig).listLimit;
}

function formatMissingLookupSelection(commandRoot: CommandPreset, selection: string, action: "score" | "subscribe"): string {
  return [
    `Selection "${selection}" refers to the numbered results from /${commandRoot} matches.`,
    `Run /${commandRoot} matches again, then /${commandRoot} ${action} ${selection}${action === "subscribe" ? " balls" : ""}.`,
    "You can also use the full matchId directly."
  ].join("\n");
}

export function createCommandHandler(api: PluginApiLike, store: CricketStateStore, provider: CricbuzzProvider) {
  return async (ctx: CommandContextLike, preset: CommandPreset): Promise<CommandResponseLike> => {
    const tokens = parseCommandTokens(ctx.args);
    const action = (tokens[0] ?? "matches").toLowerCase();
    const chatTarget = resolveChatTarget(ctx);

    if (!chatTarget) {
      return { text: "Could not resolve the current chat target for this command." };
    }

    if (action === "help") {
      return { text: formatHelp(preset) };
    }

    if (action === "matches" || action === "list") {
      const query = resolveSearchQuery(tokens.slice(1), preset, api);
      const matches = await provider.listMatches(preset, query);

      if (matches.length === 0) {
        return {
          text: `No matches found for "${query}".\n\nTry /${preset} matches all or search by a team name.`
        };
      }

      await store.mutate((state) => {
        state.lookups[chatTarget.key] = {
          storedAtMs: Date.now(),
          preset,
          query,
          matches
        };
      });

      return {
        text: formatMatches(matches, preset, query)
      };
    }

    if (action === "subscriptions" || action === "subs" || action === "status") {
      const state = await store.read();
      return {
        text: formatSubscriptionList(findTargetSubscriptions(state.subscriptions, chatTarget.key), preset)
      };
    }

    if (action === "score" || action === "current" || action === "live" || action === "snapshot") {
      const selection = normalizeSelectionToken(tokens[1]);

      if (!selection) {
        return {
          text: `Usage:\n/${preset} score <number|matchId>`
        };
      }

      const state = await store.read();
      const lookup = state.lookups[chatTarget.key];
      const selected = lookup ? resolveLookupSelection(selection, lookup.matches) : null;

      if (!selected && !lookup && isAmbiguousListSelection(selection, api)) {
        return {
          text: formatMissingLookupSelection(preset, selection, "score")
        };
      }

      const score = await provider.fetchScore(selected?.id ?? selection);
      const snapshot = toCompactLiveSnapshot(score);

      return {
        text: formatScoreSnapshot(selected?.title || snapshot.title || `Match ${selection}`, snapshot, preset)
      };
    }

    if (action === "subscribe" || action === "sub") {
      const selection = normalizeSelectionToken(tokens[1]);
      const mode = resolveMode(tokens[2]);

      if (!selection || mode === null) {
        return {
          text: `Usage:\n/${preset} subscribe <number|matchId> balls\n/${preset} subscribe <number|matchId> commentary`
        };
      }

      if (!(await ensureSendTextAvailable(api, chatTarget.channel))) {
        return {
          text: `OpenClaw cannot send messages back on "${chatTarget.channel}" right now. Try again after the channel is connected.`
        };
      }

      const state = await store.read();
      const lookup = state.lookups[chatTarget.key];
      const selected = lookup ? resolveLookupSelection(selection, lookup.matches) : null;
      let match: NormalizedMatch | null = selected;

      if (!match && !lookup && isAmbiguousListSelection(selection, api)) {
        return {
          text: formatMissingLookupSelection(preset, selection, "subscribe")
        };
      }

      if (!match) {
        const score = await provider.fetchScore(selection);
        const snapshot = toCompactLiveSnapshot(score);
        match = {
          id: selection,
          title: snapshot.title || `Match ${selection}`,
          teams: [],
          overview: snapshot.update,
          scoreLine: snapshot.liveScore || undefined,
          status: snapshot.status,
          queryText: cleanText(`${snapshot.title} ${snapshot.update} ${snapshot.liveScore}`).toLowerCase()
        };
      }

      if (!isSupportedStatus(match.status)) {
        return { text: `Cannot subscribe to ${match.title} because it already appears to be complete.` };
      }

      const currentSubscriptions = findTargetSubscriptions(state.subscriptions, chatTarget.key);
      const existing = currentSubscriptions.find((item) => item.matchId === match.id);

      if (!existing && currentSubscriptions.length >= resolvePluginConfig(api.pluginConfig).maxSubscriptionsPerChat) {
        return {
          text: `This chat already has ${currentSubscriptions.length} subscriptions. Unsubscribe from one first or raise maxSubscriptionsPerChat in plugin config.`
        };
      }

      const latestScore = await provider.fetchScore(match.id);
      const baseline = toCompactLiveSnapshot(latestScore);
      const nextSubscription: CricketSubscription = {
        id: `${chatTarget.key}|${match.id}`,
        matchId: match.id,
        matchLabel: matchLabelForSelection(match),
        mode,
        createdAtMs: existing?.createdAtMs ?? Date.now(),
        updatedAtMs: Date.now(),
        lastPolledAtMs: undefined,
        status: baseline.status,
        target: chatTarget,
        lastSnapshot: baseline.status === "live" ? baseline : undefined
      };

      await store.mutate((draft) => {
        const index = draft.subscriptions.findIndex((item) => item.id === nextSubscription.id);
        if (index === -1) {
          draft.subscriptions.push(nextSubscription);
        } else {
          draft.subscriptions[index] = nextSubscription;
        }
      });

      return {
        text: formatSubscribeAck(nextSubscription, baseline, preset)
      };
    }

    if (action === "unsubscribe" || action === "unsub" || action === "remove") {
      const selection = cleanText(tokens[1]);

      if (!selection) {
        return {
          text: `Usage: /${preset} unsubscribe <number|matchId|all>`
        };
      }

      const state = await store.read();
      const scoped = findTargetSubscriptions(state.subscriptions, chatTarget.key);

      let removed = 0;

      await store.mutate((draft) => {
        if (selection.toLowerCase() === "all") {
          removed = draft.subscriptions.filter((item) => item.target.key === chatTarget.key).length;
          draft.subscriptions = draft.subscriptions.filter((item) => item.target.key !== chatTarget.key);
          return;
        }

        const numeric = Number.parseInt(selection, 10);
        const scopedSelection = Number.isFinite(numeric) && numeric >= 1 && numeric <= scoped.length ? scoped[numeric - 1] : null;
        const removedIds = new Set<string>();

        if (scopedSelection) {
          removedIds.add(scopedSelection.id);
        } else {
          scoped
            .filter((item) => item.matchId === selection)
            .forEach((item) => {
              removedIds.add(item.id);
            });
        }

        removed = removedIds.size;
        draft.subscriptions = draft.subscriptions.filter((item) => !removedIds.has(item.id));
      });

      return { text: formatUnsubscribeResult(removed) };
    }

    if (action === "mode") {
      const selection = cleanText(tokens[1]);
      const mode = resolveMode(tokens[2]);

      if (!selection || mode === null) {
        return {
          text: `Usage: /${preset} mode <number|matchId> balls|commentary`
        };
      }

      const state = await store.read();
      const scoped = findTargetSubscriptions(state.subscriptions, chatTarget.key);
      const numeric = Number.parseInt(selection, 10);
      const scopedSelection = Number.isFinite(numeric) && numeric >= 1 && numeric <= scoped.length ? scoped[numeric - 1] : null;
      const existing = scopedSelection ?? scoped.find((item) => item.matchId === selection);

      if (!existing) {
        return { text: "No matching subscription found in this chat." };
      }

      await store.mutate((draft) => {
        const target = draft.subscriptions.find((item) => item.id === existing.id);
        if (target) {
          target.mode = mode;
          target.updatedAtMs = Date.now();
        }
      });

      return {
        text: formatModeUpdated(existing.matchLabel, mode)
      };
    }

    return { text: formatHelp(preset) };
  };
}
