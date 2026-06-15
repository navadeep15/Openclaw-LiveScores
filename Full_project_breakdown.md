## Openclaw-LiveScores — Full Project Breakdown

---

### What it is

A **plugin for OpenClaw** (a self-hosted chat gateway) that sends live cricket/IPL ball-by-ball score updates directly into your WhatsApp or Telegram chat. No official API key needed — it scrapes Cricbuzz public pages.

---

### How OpenClaw works (context)

```
Your Phone (Telegram/WhatsApp)
        ↕
OpenClaw Gateway  ← runs on your laptop
        ↕
This Plugin (cricket-live-scores)
        ↕
Cricbuzz.com (scraped)
```

OpenClaw is a self-hosted bot gateway. It connects to messaging channels (Telegram, WhatsApp), parses incoming messages, routes `/ipl` and `/cricket` commands to this plugin, and lets the plugin push messages back out.

---

### File-by-file breakdown

#### index.ts — Entry point
Registers the plugin with OpenClaw. Wires everything together:
- Creates the **state store**, **cricbuzz provider**, **command handler**
- Registers `/ipl` and `/cricket` commands
- Registers the background **notifier service**

---

#### models.ts — Data types
All TypeScript interfaces. Key ones:

| Type | Purpose |
|------|---------|
| `CricketSubscription` | A user's subscription: which match, which chat, which mode (balls/commentary), last known score |
| `CompactLiveSnapshot` | Parsed state of a live match: score line, batsmen, bowlers, run rate, commentary |
| `DeliveryUpdate` | A computed ball event: runs delta, wicket delta, milestones, over-end flag |
| `ChatTarget` | Identifies a chat: channel (telegram/whatsapp) + recipient + thread |
| `PersistedState` | Everything saved to disk: subscriptions + lookup cache + per-chat quiet hour configs |
| `TargetConfig` | Per-chat settings: quiet hours start/end |

---

#### cricbuzz-provider.ts — Data fetching
Scrapes Cricbuzz with `cheerio` (an HTML parser). Two operations:

**`listMatches(preset, query)`**
- Fetches `/cricket-match/live-scores` and `/cricket-match/live-scores/upcoming-matches`
- Parses match cards from the HTML
- Filters by query (e.g. "ipl"), deduplicates, sorts live→upcoming→unknown
- Returns a numbered list

**`fetchScore(matchId)`**
- Fetches `/live-cricket-scores/{matchId}`
- Extracts: match title, score line, run rate, batsmen stats, bowler stats, latest commentary
- Returns a `RawLiveScoreSnapshot` (raw strings, not yet parsed into numbers)
- Validates `matchId` is numeric (SSRF protection)

---

#### live-state.ts — Snapshot parsing
Takes the raw scraped strings from the provider and turns them into structured `CompactLiveSnapshot`:

- Parses `"PBKS 214/4 (20.0)"` → `{ teamLabel: "PBKS", totalRuns: 214, wickets: 4, balls: 120 }`
- When wickets are omitted (all-out) → defaults to 10
- Infers match status (`"live"` / `"upcoming"` / `"completed"`) from score line and update text patterns

---

#### ball-delta.ts — Ball event detection
The core engine. Takes two consecutive snapshots and computes what happened:

```
previous: PBKS 18/0 (1.0)
current:  PBKS 22/0 (1.1)
→ DeliveryUpdate { ballLabel: "1.1", shortResult: "FOUR", runsDelta: 4, ... }
```

Key logic:
- If nothing changed → returns `null` (no message sent)
- If innings changed (`currentBalls < previousBalls`) → returns `null` (innings change handled separately in service)
- Detects **milestones**: batter crosses 50/100, bowler reaches 5 wickets by comparing previous vs current stats
- Sets `isOverEnd = true` when `balls % 6 === 0` for over summary
- Generates `commentary`: prefers real Cricbuzz text, falls back to generated descriptions

---

#### service.ts — Background polling loop
The heartbeat of the plugin. Runs on a timer:

```
Every 10s (live) / 45s (upcoming):
  For each due subscription:
    1. Fetch fresh score from Cricbuzz
    2. Check stale? → remove + notify
    3. Match just went live? → send "Match started!" alert
    4. Match completed? → send final score + remove subscription
    5. Innings changed? → send innings summary
    6. In quiet hours? → update state silently, skip sending
    7. New ball detected? → send delivery message (+ milestones + over summary if applicable)
```

Race condition protection: before every `sendText`, re-reads state to confirm the subscription still exists (in case user unsubscribed mid-tick).

State changes are batched and written atomically at the end of each tick.

---

#### state.ts — Persistence
Reads/writes state to a JSON file in OpenClaw's state directory.

- **In-memory cache** avoids redundant disk reads
- **Write queue** (`writeQueue` promise chain) prevents concurrent writes
- **Atomic writes**: writes to `.tmp` file first, then renames — a crash mid-write doesn't corrupt the state
- Validates all deserialized data shape (subscriptions, snapshots, lookup entries) — corrupt entries are dropped, not crashed on

---

#### commands.ts — Command handler
Handles all user-typed commands. Full command surface:

| Command | What it does |
|---------|-------------|
| `/ipl matches [query]` | Lists live/upcoming matches |
| `/ipl score 1` | One-shot current score |
| `/ipl subscribe 1 balls` | Subscribe to ball-by-ball updates |
| `/ipl subscribe 1 commentary` | Subscribe with Cricbuzz commentary text |
| `/ipl subscriptions` | List active subscriptions |
| `/ipl unsubscribe 1` / `all` | Remove subscriptions |
| `/ipl mode 1 balls\|commentary` | Switch mode on existing subscription |
| `/ipl summary 1` | Rich scorecard: batting, bowling, run rate, latest commentary |
| `/ipl quiet 23:00-07:00` | Suppress notifications during time window |
| `/ipl quiet off` | Disable quiet hours |
| `/ipl help` | Full command reference |

Numbered selections (`1`, `2`) resolve against the most recent `/ipl matches` list cached for that specific chat.

---

#### formatting.ts — Message templates
Pure functions that take data and return formatted text strings. Entirely separated from logic. All messages the user sees originate here:

- `formatDeliveryMessage` — ball update with optional commentary, milestones, over summary
- `formatInningsChange` — "Innings complete: MI 180/10 → CSK batting now"
- `formatMatchStarted` — "Match is now LIVE!"
- `formatStaleRemoval` — "Match hasn't started in 48h, removing subscription"
- `formatMatchSummary` — full scorecard on demand
- `formatQuietHoursSet/Off` — quiet hours confirmation

---

#### config.ts — Plugin configuration
All tuneable settings with defaults and validation:

| Setting | Default | Purpose |
|---------|---------|---------|
| `pollIntervalMs` | 10s | How often to check live match scores |
| `preMatchPollIntervalMs` | 45s | How often to check upcoming matches |
| `requestTimeoutMs` | 12s | Cricbuzz fetch timeout |
| `maxSubscriptionsPerChat` | 5 | Cap per chat |
| `staleSubscriptionMs` | 48h | Auto-remove upcoming matches after this |
| `listLimit` | 8 | Max matches shown in `/ipl matches` |

Configured under `plugins.entries.cricket-live-scores.config` in the OpenClaw config file.

---

### Data flow end-to-end

```
User: /ipl subscribe 1 balls
         ↓
commands.ts: resolves match from lookup cache
         ↓
cricbuzz-provider: fetchScore() → baseline snapshot
         ↓
state.ts: saves CricketSubscription to disk
         ↓
[10 seconds later]
         ↓
service.ts tick(): loads subscriptions
         ↓
cricbuzz-provider: fetchScore() → new snapshot
         ↓
ball-delta.ts: inferDeliveryUpdate(prev, current)
         ↓
formatting.ts: formatDeliveryMessage()
         ↓
openclaw adapter: sendText() back to Telegram/WhatsApp
```

---

### What it doesn't do
- No official cricket API (pure scraping — can break if Cricbuzz changes their HTML)
- No historical stats
- No multi-match commentary comparison
- No hosting (must run on your laptop with OpenClaw running)




This plugin uses **zero AI tokens**. It scrapes Cricbuzz directly with `cheerio` — no LLM calls anywhere in the code.

The only token usage comes from the **OpenClaw gateway** itself, which parses incoming chat messages to route them to commands. For structured commands like `/ipl subscribe 1 balls`, that's extremely lightweight — a few hundred tokens per command at most.

During live score delivery (the polling loop in service.ts), there are **no AI calls at all**. It's just:
1. HTTP GET to Cricbuzz → HTML
2. Parse with cheerio → snapshot
3. Diff snapshots → delivery message
4. Send text via channel adapter

So your Gemini free tier should last a very long time. The Groq switch would still be a good idea for reliability, but token cost isn't a concern here.




### Publishing

The plugin is structured correctly for publishing — it has a proper openclaw.plugin.json manifest with id, name, description, configSchema, and the package.json has the right `openclaw` field. To publish it so others can install it with `openclaw plugins install <name>`:

1. **Push to a public GitHub repo** (if not already)
2. **Publish to npm**: `npm publish` — the package name `openclaw-cricket-live-scores` in package.json is already set
3. Others could then install it with:
   ```
   openclaw plugins install openclaw-cricket-live-scores
   ```

However — **one important caveat before publishing**: the scraping approach is fragile. If Cricbuzz changes their HTML structure, everyone's installs break simultaneously. You'd need to maintain it and push updates. Worth noting in the README.

Also worth doing before publishing:
- Add a license (MIT is fine) to package.json
- The README.md is already solid documentation

---

### IPL vs All Cricket

Both are supported right now. From cricbuzz-provider.ts:

```typescript
.filter((item) => preset !== "ipl" || IPL_PATTERN.test(...))
```

- **`/ipl matches`** — filters to IPL only using `IPL_PATTERN = /\b(ipl|indian premier league)\b/i`
- **`/cricket matches`** — no filter, shows everything Cricbuzz lists (all international, domestic, all tournaments)
- **`/cricket matches india`** — further filters by search query

So `/cricket matches` would show England vs Australia, PSL, WPL, etc. — anything currently live or upcoming on Cricbuzz. You were right that there were probably just no other matches at that time.