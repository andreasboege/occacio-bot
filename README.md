# Occacio RSI bot

Checks a list of instruments every 5 minutes (Mon–Fri, 07:00–17:00 Europe/Copenhagen by default) and sends a Telegram alert when the **RSI(14) on 5-minute candles** crosses into **< 20 (oversold)** or **> 80 (overbought)**.

**Language: TypeScript (Node 22+).** Native `fetch` handles Yahoo and Telegram, so there are no runtime dependencies (dev: `tsx`, `typescript`).

## How it works

| File | Role |
|---|---|
| `src/fetch.ts` | `fetchCandles(symbol)` – the only data-source function (Yahoo chart endpoint, browser User-Agent, 3 attempts with backoff); closed-candle filter; stale check |
| `src/rsi.ts` | Wilder RSI |
| `src/evaluate.ts` | Zone transitions + cooldown |
| `src/notify.ts` | Telegram / console notifier, message format |
| `src/state.ts` | JSON state (zone, last alert time, failure count per symbol) |
| `src/config.ts` | Config loading, active-hours check in Copenhagen time (DST-safe) |
| `src/run.ts` | One single check (entry point) |
| `config.json` | Instruments, RSI period, thresholds, cooldown, hours |

Rules: only closed candles are used; if the newest closed candle closed more than `staleMinutes` (20) ago the instrument is skipped; an alert fires only when the zone changes into oversold/overbought, and no more often than `cooldownMinutes` per instrument (state still follows the real zone during cooldown). After 3 consecutive failed runs for a symbol you get one "data fetch failed" message.

## Config (`config.json`)

`rsiPeriod`, `oversold`, `overbought`, `cooldownMinutes`, `notifyBackInside` (off by default), `staleMinutes`, `failureAlertThreshold`, `timezone`, `activeHours.start/end`, and `instruments` (`name` → Yahoo `symbol`).

## Telegram setup

1. In Telegram, open **@BotFather**, send `/newbot`, follow the prompts and copy the **token**.
2. Open your new bot and send it any message (e.g. `hi`).
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `message.chat.id` – that is your **chat ID**.
4. Copy `.env.example` to `.env` and fill in `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (never commit `.env`).

## Local run

```
npm install
npm test
npm run dry-run -- --force      # prints alerts instead of sending; --force ignores active hours
npm run test-telegram           # sends a hello message (reads .env)
npm run check                   # real run (reads .env; honours active hours)
```

State is stored in `state/state.json` (override with `STATE_FILE`); dry runs never write it.
Use the npm scripts rather than `npx tsx` if your folder path contains `&` (it breaks the `tsx` shim on Windows).

## Deployment: GitHub Actions

`.github/workflows/rsi-check.yml` runs `*/5 5-16 * * 1-5` (UTC, covers CET and CEST); the script exits early outside the Copenhagen window.

**State storage: a dedicated `state` branch** (one `state.json`, committed only when it changes). Chosen over `actions/cache` because caches are immutable per key, get evicted after 7 days without access, and a race or eviction silently loses the state (causing repeat alerts). A branch is durable and inspectable. A `concurrency` group prevents overlapping runs.

Manual steps:
1. Push this folder as its own GitHub repository (public repos get free Actions minutes).
2. **Settings → Secrets and variables → Actions**: add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
3. **Actions** tab: enable workflows, then run "RSI check" once via *Run workflow*. The `state` branch is created on the first run.
4. Optional: run `--test-telegram` locally first to verify the token/chat ID.

## Fallback: VPS / Raspberry Pi

The logic is host-independent: `npx tsx src/run.ts` performs a single check. Example cron (the script enforces hours/weekdays itself; delay a few seconds so the candle is available):

```
*/5 * * * * sleep 15; cd /opt/occacio-bot && node --env-file=.env node_modules/tsx/dist/cli.mjs src/run.ts >> bot.log 2>&1
```

or a systemd timer with `OnCalendar=*:0/5:15`.

## Limitations

- Yahoo's chart endpoint is **unofficial**; it can rate-limit, change format or block cloud IPs (GitHub runners included).
- Data may be delayed; cash indices lag ~15 min, so alerts are late by that much. If indices are skipped as stale too often, raise `staleMinutes`.
- GitHub scheduled workflows can be **delayed by several minutes** (or occasionally skipped) under load. A late run is harmless: it uses the newest closed candle, but a brief RSI excursion between runs can be missed.
- FX/futures have weekend gaps and daily breaks; stale data is skipped, and the first candles after a gap can produce odd RSI values.
- The first run treats unknown state as "inside", so an instrument already outside the band alerts once.
- Not financial advice.
