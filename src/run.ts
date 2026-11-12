import { isWithinActiveHours, loadConfig, type Config } from "./config.ts";
import { evaluate } from "./evaluate.ts";
import { CANDLE_MS, closedCandles, currentDayCandles, fetchCandles, isStale, type Candle } from "./fetch.ts";
import { consoleNotifier, formatAlert, telegramNotifier, type Notifier } from "./notify.ts";
import { calcRsi } from "./rsi.ts";
import { initialState, loadState, saveState, type State } from "./state.ts";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force"); // ignore the active-hours window (for testing)
const stateFile = process.env.STATE_FILE ?? "state/state.json";

function makeNotifier(): Notifier {
  if (dryRun) return consoleNotifier();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = [process.env.TELEGRAM_CHAT_ID, process.env.TELEGRAM_CHAT_ID_2].filter(
    (chatId): chatId is string => Boolean(chatId),
  );
  if (!token || !chatIds.length) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set (or use --dry-run)");
  }
  return telegramNotifier(token, chatIds);
}

/** Checks one instrument and updates `state` in place. */
async function checkInstrument(
  inst: Config["instruments"][number],
  config: Config,
  state: State,
  notifier: Notifier,
  now: number,
  fetcher: (symbol: string) => Promise<Candle[]> = fetchCandles,
): Promise<void> {
  const prev = state[inst.symbol] ?? initialState();

  let candles: Candle[];
  try {
    candles = await fetcher(inst.symbol);
  } catch (err) {
    const failures = prev.failures + 1;
    state[inst.symbol] = { ...prev, failures };
    console.warn(`${inst.name} (${inst.symbol}): ${err instanceof Error ? err.message : String(err)} (${failures} failures in a row)`);
    if (failures === config.failureAlertThreshold) {
      await notifier.send(`⚠️ ${inst.name} (${inst.symbol}): data fetch failed ${failures} runs in a row.`);
    }
    return;
  }

  const closed = closedCandles(candles, now);
  const lastClosed = closed.at(-1);
  console.log(
    `${inst.name} (${inst.symbol}): fetched ${candles.length} candles, ${closed.length} closed, ` +
    `latest close ${lastClosed ? new Date(lastClosed.time + CANDLE_MS).toISOString() : "none"}`,
  );
  if (isStale(closed, now, config.staleMinutes)) {
    state[inst.symbol] = { ...prev, failures: 0 };
    console.log(`${inst.name}: no fresh closed candle within ${config.staleMinutes} minutes, skipped`);
    return;
  }

  const rsiCandles = inst.rsiSessionTimezone
    ? currentDayCandles(closed, now, inst.rsiSessionTimezone)
    : closed;
  if (inst.rsiSessionTimezone) {
    console.log(`${inst.name}: ${rsiCandles.length} closed candles today (${inst.rsiSessionTimezone}); ${closed.length - rsiCandles.length} earlier candles excluded`);
  }
  const rsi = calcRsi(rsiCandles.map((c) => c.close), config.rsiPeriod);
  if (rsi === null) {
    console.log(`${inst.name}: not enough candles for RSI (${rsiCandles.length}/${config.rsiPeriod + 1}), skipped`);
    return;
  }

  const result = evaluate(prev, rsi, now, config);
  state[inst.symbol] = result.next;
  console.log(`${inst.name}: RSI ${rsi.toFixed(1)} -> ${result.zone}${result.action === "none" ? "" : ` (${result.action})`}`);

  if (result.action !== "none") {
    const last = rsiCandles[rsiCandles.length - 1];
    await notifier.send(
      formatAlert({
        name: inst.name,
        emoji: inst.emoji,
        zone: result.zone,
        rsi,
        period: config.rsiPeriod,
        time: last.time + CANDLE_MS,
        timezone: config.timezone,
      }),
    );
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (args.has("--test-telegram")) {
    await makeNotifier().send("👋 Occacio RSI bot: Telegram is set up correctly.");
    console.log("Test message sent.");
    return;
  }

  const now = Date.now();
  console.log(`Starting check at ${new Date(now).toISOString()}${dryRun ? " (dry run)" : ""}`);
  if (!force && !isWithinActiveHours(new Date(now), config)) {
    console.log("Outside active hours, exiting.");
    return;
  }

  const notifier = makeNotifier();
  const state = loadState(stateFile);
  await Promise.all(
    config.instruments.map((inst) =>
      checkInstrument(inst, config, state, notifier, now).catch((err) =>
        console.error(`${inst.name} (${inst.symbol}): unexpected error:`, err),
      ),
    ),
  );
  if (!dryRun) saveState(stateFile, state);
  console.log("Check finished.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
