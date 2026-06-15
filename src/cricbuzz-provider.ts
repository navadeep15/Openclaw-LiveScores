import { load } from "cheerio";

import type { CommandPreset, MatchStatus, NormalizedMatch } from "./models.js";
import type { PluginApiLike } from "./openclaw.js";
import type { RawLiveScoreSnapshot } from "./live-state.js";
import { resolvePluginConfig } from "./config.js";
import { cleanText, normalizeText, uniqBy } from "./utils.js";

type MatchEndpoint = "live" | "upcoming";

interface ScrapedMatchEntry {
  id: string;
  title: string;
  teams: { team: string; run?: string }[];
  series?: string;
  origin?: string;
  detail?: string;
  overview: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const COMPLETE_SUMMARY_PATTERN = /\b(complete|won|beat|abandon(?:ed)?|no result|match drawn|drawn|tied)\b/i;
const LIVE_SUMMARY_PATTERN = /\b(stumps|lunch|tea|innings break|rain|day \d|trail|lead|need|requires|live)\b/i;
const IPL_PATTERN = /\b(ipl|indian premier league)\b/i;

function buildQueryTokens(query: string): string[] {
  return normalizeText(query)
    .split(/[^a-z0-9]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTeamsFromTitle(title: string): { team: string; run?: string }[] {
  const titleHead = cleanText(title).split(",")[0] ?? "";
  const parts = titleHead
    .split(/\s+vs\s+/i)
    .map((item) => cleanText(item))
    .filter(Boolean);

  return parts.slice(0, 2).map((team) => ({ team }));
}

function inferMatchStatus(summary: string): MatchStatus {
  const value = cleanText(summary);
  if (!value) {
    return "unknown";
  }

  if (/\b(preview|upcoming match|match starts)\b/i.test(value)) {
    return "upcoming";
  }

  if (COMPLETE_SUMMARY_PATTERN.test(value)) {
    return "completed";
  }

  if (LIVE_SUMMARY_PATTERN.test(value)) {
    return "live";
  }

  return "unknown";
}

function matchMatchesQuery(match: ScrapedMatchEntry, query: string): boolean {
  if (!query || normalizeText(query) === "all") {
    return true;
  }

  const haystack = normalizeText(
    [
      match.title,
      match.series,
      match.origin,
      match.detail,
      match.overview,
      ...match.teams.map((item) => item.team)
    ]
      .filter(Boolean)
      .join(" ")
  );

  const tokens = buildQueryTokens(query);
  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => haystack.includes(token));
}

function parseMatchCard(titleAttribute: string | undefined, primaryText: string, secondaryText: string): { title: string; overview: string } {
  const titleText = cleanText(titleAttribute);
  const splitIndex = titleText.lastIndexOf(" - ");
  const leading = splitIndex >= 0 ? cleanText(titleText.slice(0, splitIndex)) : titleText;
  const trailing = splitIndex >= 0 ? cleanText(titleText.slice(splitIndex + 3)) : "";
  const fallbackTitle = [cleanText(primaryText), cleanText(secondaryText)].filter(Boolean).join(", ");

  return {
    title: leading || fallbackTitle,
    overview: trailing || cleanText(secondaryText)
  };
}

function normalizeScoreChunk(scoreChunk: string): string {
  return cleanText(scoreChunk).replace(/(\d+[\/-]\d+)\(/, "$1 (").replace(/(\d)\(/, "$1 (");
}

function firstDefinedText(values: Array<string | undefined>): string {
  for (const value of values) {
    const next = cleanText(value);
    if (next) {
      return next;
    }
  }

  return "";
}

export class CricbuzzProvider {
  constructor(private readonly api: PluginApiLike) {}

  private async fetchHtml(pathname: string): Promise<string> {
    const config = resolvePluginConfig(this.api.pluginConfig);
    const url = `${config.cricbuzzBaseUrl.replace(/\/$/, "")}${pathname}`;
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT
      },
      signal: AbortSignal.timeout(config.requestTimeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Cricbuzz returned ${response.status} for ${pathname}`);
    }

    return await response.text();
  }

  async listMatches(preset: CommandPreset, query: string): Promise<NormalizedMatch[]> {
    const effectiveQuery = cleanText(query) || (preset === "ipl" ? "ipl" : resolvePluginConfig(this.api.pluginConfig).defaultQuery);
    const results = await Promise.all((["live", "upcoming"] as MatchEndpoint[]).map(async (endpoint) => await this.fetchMatches(endpoint)));
    const flattened = uniqBy(results.flat(), (item) => item.id);

    return flattened
      .filter((item) => preset !== "ipl" || IPL_PATTERN.test([item.series, item.title].filter(Boolean).join(" ")))
      .filter((item) => matchMatchesQuery(item, effectiveQuery))
      .map((item) => this.normalizeMatch(item))
      .sort((left, right) => this.compareMatches(left, right))
      .slice(0, resolvePluginConfig(this.api.pluginConfig).listLimit);
  }

  async fetchScore(matchId: string): Promise<RawLiveScoreSnapshot> {
    if (!/^\d+$/.test(matchId)) {
      throw new Error(`Invalid matchId: "${matchId}". Must be numeric.`);
    }

    const html = await this.fetchHtml(`/live-cricket-scores/${matchId}`);
    const $ = load(html);
    const main = $("main").first();
    const miniScore = $("#miniscore-branding-container");
    const title = cleanText($("h1").first().text()).replace(/\s*-\s*Commentary$/i, "");
    const startsAtLabel = this.extractHeaderField($, "Date & Time");
    const update =
      firstDefinedText([
        miniScore.find(".text-cbTxtLive").first().text(),
        miniScore.find(".my-2.text-cbLive").first().text(),
        miniScore.find(".text-cbPreview").first().text()
      ]) || (startsAtLabel ? `Match starts at ${startsAtLabel}` : "Match update unavailable");

    const scoreHeader = miniScore.find(".flex.flex-row.font-bold.text-xl").first();
    const scoreParts = scoreHeader
      .children("div")
      .toArray()
      .map((element) => cleanText($(element).text()))
      .filter(Boolean);

    let liveScore = "";
    let runRate = "";

    if (scoreParts.length >= 2) {
      liveScore = `${scoreParts[0]} ${normalizeScoreChunk(scoreParts[1] ?? "")}`.trim();
      runRate = cleanText((scoreParts.find((part) => /rr:/i.test(part)) ?? "").replace(/^[A-Z\s]*RR:\s*/i, ""));
    }

    if (liveScore && !/[\/-]\d+\s*\(/.test(liveScore)) {
      const allOutMatch = cleanText(main.text()).match(/(\d+)[\/-](\d+)\s+in\s+(\d+(?:\.\d+)?)\s+ov\./i);
      const liveScoreMatch = liveScore.match(/^(.*?)(\d+)\s*\((\d+(?:\.\d+)?)\)$/);

      if (allOutMatch && liveScoreMatch && allOutMatch[1] === liveScoreMatch[2] && allOutMatch[3] === liveScoreMatch[3]) {
        liveScore = `${cleanText(liveScoreMatch[1])} ${allOutMatch[1]}/${allOutMatch[2]} (${allOutMatch[3]})`.trim();
      }
    }

    const batterRows = this.extractStatRows($, miniScore, "Batter");
    const bowlerRows = this.extractStatRows($, miniScore, "Bowler");

    return {
      title,
      update,
      liveScore,
      runRate: runRate || undefined,
      latestCommentary: this.extractLatestCommentary($),
      batsmanOne: batterRows[0]?.[0],
      batsmanOneRun: batterRows[0]?.[1],
      batsmanOneBall: batterRows[0]?.[2],
      batsmanTwo: batterRows[1]?.[0],
      batsmanTwoRun: batterRows[1]?.[1],
      batsmanTwoBall: batterRows[1]?.[2],
      bowlerOne: bowlerRows[0]?.[0],
      bowlerOneOver: bowlerRows[0]?.[1],
      bowlerOneRun: bowlerRows[0]?.[3],
      bowlerOneWickets: bowlerRows[0]?.[4],
      bowlerTwo: bowlerRows[1]?.[0],
      bowlerTwoOver: bowlerRows[1]?.[1],
      bowlerTwoRun: bowlerRows[1]?.[3],
      bowlerTwoWicket: bowlerRows[1]?.[4]
    };
  }

  private async fetchMatches(endpoint: MatchEndpoint): Promise<ScrapedMatchEntry[]> {
    const html = await this.fetchHtml(endpoint === "live" ? "/cricket-match/live-scores" : "/cricket-match/live-scores/upcoming-matches");
    const $ = load(html);
    const matches: ScrapedMatchEntry[] = [];

    $("ul.pb-10.pt-4.px-5.columns-3 > div.mb-3").each((_, sectionElement) => {
      const section = $(sectionElement);
      const origin = cleanText(section.children("div").first().text());
      const seriesBlocks = section.children("div.col-span-3").children("div.mb-3");

      seriesBlocks.each((__, seriesElement) => {
        const block = $(seriesElement);
        const series = cleanText(block.children('a[href^="/cricket-series/"]').first().text());

        block.find('a[href^="/live-cricket-scores/"]').each((___, anchorElement) => {
          const anchor = $(anchorElement);
          const href = cleanText(anchor.attr("href"));
          const matchId = href.match(/\/live-cricket-scores\/(\d+)/)?.[1] ?? "";
          const primaryText = cleanText(anchor.find("div.text-white").first().text());
          const secondaryText = cleanText(anchor.find("div.text-xs").first().text());
          const parsed = parseMatchCard(anchor.attr("title"), primaryText, secondaryText);

          if (!matchId || !parsed.title) {
            return;
          }

          matches.push({
            id: matchId,
            title: parsed.title,
            teams: parseTeamsFromTitle(parsed.title),
            series: series || undefined,
            origin: origin || undefined,
            detail: secondaryText || undefined,
            overview: [series, secondaryText, parsed.overview].filter(Boolean).join(" | ")
          });
        });
      });
    });

    if (matches.length > 0) {
      return uniqBy(matches, (item) => item.id);
    }

    $('a[href^="/live-cricket-scores/"]').each((_, anchorElement) => {
      const anchor = $(anchorElement);
      const href = cleanText(anchor.attr("href"));
      const matchId = href.match(/\/live-cricket-scores\/(\d+)/)?.[1] ?? "";
      const primaryText = cleanText(anchor.text());
      const parsed = parseMatchCard(anchor.attr("title"), primaryText, "");

      if (!matchId || !parsed.title) {
        return;
      }

      matches.push({
        id: matchId,
        title: parsed.title,
        teams: parseTeamsFromTitle(parsed.title),
        overview: parsed.overview
      });
    });

    return uniqBy(matches, (item) => item.id);
  }

  private normalizeMatch(match: ScrapedMatchEntry): NormalizedMatch {
    const status = inferMatchStatus(match.overview);
    const scoreLineParts = match.teams
      .map((item) => {
        const team = cleanText(item.team);
        const run = cleanText(item.run);
        return run ? `${team} ${run}` : "";
      })
      .filter(Boolean);

    return {
      id: match.id,
      title: cleanText(match.title),
      teams: match.teams.map((item) => ({
        team: cleanText(item.team),
        run: cleanText(item.run) || undefined
      })),
      overview: cleanText(match.overview),
      scoreLine: scoreLineParts.length > 0 ? scoreLineParts.join(" | ") : undefined,
      status,
      queryText: normalizeText([match.title, match.series, match.origin, match.detail, match.overview, ...match.teams.map((item) => item.team)].join(" "))
    };
  }

  private compareMatches(left: NormalizedMatch, right: NormalizedMatch): number {
    const order = new Map<MatchStatus, number>([
      ["live", 0],
      ["upcoming", 1],
      ["unknown", 2],
      ["completed", 3]
    ]);

    const leftOrder = order.get(left.status) ?? 99;
    const rightOrder = order.get(right.status) ?? 99;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.title.localeCompare(right.title);
  }

  private extractHeaderField($: ReturnType<typeof load>, label: string): string {
    const groups = $("h1")
      .first()
      .parent()
      .parent()
      .siblings("div")
      .first()
      .children("div")
      .toArray();

    for (const group of groups) {
      const text = cleanText($(group).text());
      const prefix = `${label}:`;
      if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
        return cleanText(text.slice(prefix.length));
      }
    }

    return "";
  }

  private extractStatRows($: ReturnType<typeof load>, root: ReturnType<ReturnType<typeof load>>, headerLabel: "Batter" | "Bowler"): string[][] {
    const rows: string[][] = [];
    let capture = false;

    root.find("div.grid").each((_, gridElement) => {
      if (rows.length >= 2) {
        return;
      }

      const grid = $(gridElement);
      const cells = grid
        .children()
        .toArray()
        .map((element) => cleanText($(element).text()))
        .filter(Boolean);

      if (cells.length === 0) {
        return;
      }

      const firstCell = cells[0] ?? "";

      if (firstCell === headerLabel) {
        capture = true;
        return;
      }

      if (!capture) {
        return;
      }

      if (firstCell === "Batter" || firstCell === "Bowler" || firstCell === "Key Stats") {
        if (firstCell !== headerLabel) {
          capture = false;
        }
        return;
      }

      if (grid.find('a[href^="/profiles/"]').length === 0) {
        return;
      }

      rows.push(cells);
    });

    return uniqBy(rows, (row) => normalizeText(row[0] ?? ""));
  }

  private extractLatestCommentary($: ReturnType<typeof load>): string | undefined {
    for (const row of $("main div.flex").toArray()) {
      const ballLabel = cleanText($(row).find("div.font-bold").first().text());
      if (!/^\d+\.\d+$/.test(ballLabel)) {
        continue;
      }

      const children = $(row).children().toArray();
      if (children.length < 2) {
        continue;
      }

      const commentary = cleanText($(children[1] ?? children[0]).text());
      if (!commentary || /^Over\s+\d+/i.test(commentary)) {
        continue;
      }

      return commentary;
    }

    return undefined;
  }
}

export function matchesQueryFilter(match: NormalizedMatch, query: string): boolean {
  const tokens = buildQueryTokens(query);
  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => match.queryText.includes(token));
}
