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
- Commentary mode prefers the latest scraped Cricbuzz ball text when it is available. If a polling jump covers multiple balls, the plugin falls back to a generated summary for that range.
- If a polling gap covers multiple deliveries, the plugin sends a bundled update for that ball range.
- Numbered selections such as `1` depend on a recent `/ipl matches` or `/cricket matches` result. If that list is stale, run the match list command again or use the full matchId.
