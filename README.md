# OpenClaw Cricket Live Scores

An OpenClaw plugin that lets a user pick an IPL or cricket match and subscribe to live score pushes in the same WhatsApp or Telegram chat. The plugin sends a message for each detected new ball state and can add the latest available ball commentary on top of the live score update.

This plugin works without an external cricket API key. It scrapes public Cricbuzz match pages for live score snapshots and infers ball-by-ball updates by diffing consecutive score states.

## What it does

- `/ipl matches` lists live and upcoming IPL matches.
- `/ipl score <number|matchId>` returns the current score once.
- `/cricket matches [query]` lists broader cricket matches and supports search by team or tournament.
- `/cricket score <number|matchId>` returns the current score once.
- `/ipl subscribe <number|matchId> balls`
- `/ipl subscribe <number|matchId> commentary`
- `/cricket subscriptions`
- `/cricket unsubscribe <number|matchId|all>`
- `/cricket mode <number|matchId> balls|commentary`

The subscription is bound to the current OpenClaw chat target, so updates go back into the same WhatsApp or Telegram conversation.

Mode behavior:

- `balls` sends only the score update lines for the latest detected ball.
- `commentary` sends the same score update plus the latest scraped ball commentary text when Cricbuzz exposes it.
- If polling misses intermediate balls, the plugin reports the latest known ball cleanly instead of sending a range-based snapshot summary.

## Install

1. Build the plugin:

```bash
npm install
npm run build
```

2. Link it into OpenClaw:

```bash
openclaw plugins install -l .
openclaw plugins enable cricket-live-scores
```

3. Make sure your channel is already logged in:

```bash
openclaw channels login --channel telegram
openclaw channels login --channel whatsapp
```

The plugin uses OpenClaw's outbound text adapter, so it is channel-agnostic. If Telegram works and WhatsApp is linked correctly in OpenClaw, the same `/ipl ...` and `/cricket ...` commands work in WhatsApp too.

## Optional config

Add this under `plugins.entries.cricket-live-scores.config` in your OpenClaw config if you want to tune the polling behavior:

```json5
{
  "plugins": {
    "entries": {
      "cricket-live-scores": {
        "enabled": true,
        "config": {
          "pollIntervalMs": 10000,
          "preMatchPollIntervalMs": 45000,
          "requestTimeoutMs": 12000,
          "defaultQuery": "ipl"
        }
      }
    }
  }
}
```

## Commands

```text
/ipl
/ipl matches
/ipl score 1
/ipl subscribe 1 balls
/ipl subscribe 1 commentary
/ipl subscriptions
/ipl unsubscribe 1

/cricket matches india
/cricket score 2
/cricket subscribe 2 commentary
/cricket mode 2 balls
/cricket subscriptions
/cricket unsubscribe all
```

## Notes

- Delivery is near-live, not a licensed official ball feed. Ball events are inferred from changes in the public live score snapshot.
- `/... score` is the one-shot command. `/... subscribe` is the continuous auto-push command.
- `balls` mode does not append commentary text.
- Commentary mode prefers the latest scraped Cricbuzz ball text when it is available. If Cricbuzz does not expose commentary for the latest poll, the plugin falls back to a short generated line.
- Numbered selections such as `1` depend on a recent `/ipl matches` or `/cricket matches` result. If that list is stale, run the match list command again or use the full matchId.
- These slash commands are custom plugin commands, so they bypass the LLM. Gemini or Groq quota matters for general assistant chat, but not for the core `/ipl` or `/cricket` command handling in this plugin.
- Always-on Telegram or WhatsApp delivery needs a continuously running OpenClaw gateway. That is a deployment concern outside the plugin code itself.
