Do this in order:

1. Stop any old gateway process:
```powershell
openclaw gateway stop
```

2. Start one clean instance:
```powershell
openclaw gateway run
```

3. Wait for startup to finish.
You want to see lines like:
```text
[gateway] ready
[gateway] starting channels and sidecars...
[gateway/channels/telegram] [default] starting provider
```
On your machine this can take 30-60 seconds.

4. In Telegram, send:
```text
/ipl matches
```

5. If you only want the current score, use:
```text
/ipl score 1
```

6. If that works, subscribe with:
```text
/ipl subscribe 1 balls
```
or
```text
/ipl subscribe 1 commentary
```

`/ipl score` is one-shot.
`/ipl subscribe` keeps sending updates automatically as the score changes.
`balls` sends only score lines.
`commentary` adds the latest ball commentary when available.

If you want WhatsApp too, link that channel first:

```powershell
openclaw channels login --channel whatsapp
```

Then send the same commands in the WhatsApp chat where OpenClaw is connected:

```text
/ipl matches
/ipl score 1
/ipl subscribe 1 balls
```

Important:
- Run only one gateway at a time.
- Keep the terminal with `openclaw gateway run` open while testing.
- If `/ipl matches` still does nothing, check whether the log shows Telegram started or whether Gemini hit rate limits again.
- The cricket commands themselves bypass the LLM, so running out of Gemini free tokens should not stop `/ipl` and `/cricket` commands from working.
