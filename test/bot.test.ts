import assert from "node:assert/strict";
import { test } from "node:test";
import { isWithinActiveHours } from "../src/config.ts";
import { evaluate, type Thresholds } from "../src/evaluate.ts";
import { CANDLE_MS, closedCandles, isStale, parseYahooChart } from "../src/fetch.ts";
import { formatAlert, telegramNotifier } from "../src/notify.ts";
import { calcRsi } from "../src/rsi.ts";
import { initialState } from "../src/state.ts";

// Wilder's classic worked example (StockCharts "RSI" spreadsheet), period 14.
const closes = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0,
  46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66,
  43.13,
];
const expected = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3, 33.08, 37.77];

test("RSI matches the reference series", () => {
  expected.forEach((value, i) => {
    const rsi = calcRsi(closes.slice(0, 15 + i), 14)!;
    assert.ok(Math.abs(rsi - value) < 0.1, `index ${14 + i}: got ${rsi}, expected ${value}`);
  });
});

test("RSI needs more than `period` closes and handles flat/one-way series", () => {
  assert.equal(calcRsi(closes.slice(0, 14), 14), null);
  assert.equal(calcRsi(Array(20).fill(5), 14), 50);
  assert.equal(calcRsi(Array.from({ length: 20 }, (_, i) => i), 14), 100);
});

const now = Date.UTC(2026, 10, 3, 10, 7, 0); // 10:07 UTC
const candleAt = (min: number) => ({ time: Date.UTC(2026, 10, 3, 10, min), close: 1 });

test("closedCandles drops the candle that is still forming", () => {
  const candles = [candleAt(0), candleAt(5)]; // 10:05 candle closes 10:10 > now
  assert.deepEqual(closedCandles(candles, now), [candleAt(0)]);
  assert.equal(closedCandles(candles, Date.UTC(2026, 10, 3, 10, 10)).length, 2); // exactly closed counts
});

test("isStale flags old or missing data", () => {
  const closed = [candleAt(0)]; // closed 10:05, 2 min ago
  assert.equal(isStale(closed, now, 20), false);
  assert.equal(isStale(closed, now + 19 * 60_000, 20), true);
  assert.equal(isStale([], now, 20), true);
  assert.equal(CANDLE_MS, 300_000);
});

test("parseYahooChart skips null closes", () => {
  const json = { chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ close: [1, null, 3] }] } }] } };
  assert.deepEqual(parseYahooChart(json).map((c) => c.close), [1, 3]);
  assert.throws(() => parseYahooChart({ chart: { result: null, error: { description: "nope" } } }), /nope/);
});

const t: Thresholds = { oversold: 20, overbought: 80, cooldownMinutes: 30, notifyBackInside: false };
const min = 60_000;

test("alerts when crossing into a zone, not while staying in it", () => {
  const a = evaluate(initialState(), 17.8, 0, t);
  assert.equal(a.action, "alert");
  assert.equal(a.next.zone, "oversold");
  const b = evaluate(a.next, 15, 5 * min, t);
  assert.equal(b.action, "none");
  assert.equal(evaluate(initialState(), 85, 0, t).zone, "overbought");
  assert.equal(evaluate(initialState(), 50, 0, t).action, "none");
});

test("thresholds are exclusive", () => {
  assert.equal(evaluate(initialState(), 20, 0, t).action, "none");
  assert.equal(evaluate(initialState(), 80, 0, t).action, "none");
});

test("cooldown suppresses repeat alerts but state still follows RSI", () => {
  const first = evaluate(initialState(), 15, 0, t);
  const back = evaluate(first.next, 40, 5 * min, t);
  assert.equal(back.action, "none"); // back-inside off by default
  const again = evaluate(back.next, 15, 10 * min, t);
  assert.equal(again.action, "none");
  assert.equal(again.next.zone, "oversold");
  assert.equal(again.next.lastAlertAt, 0);
  const later = evaluate(evaluate(again.next, 40, 20 * min, t).next, 15, 31 * min, t);
  assert.equal(later.action, "alert");
});

test("optional back-inside message", () => {
  const first = evaluate(initialState(), 90, 0, t);
  const back = evaluate(first.next, 60, 5 * min, { ...t, notifyBackInside: true });
  assert.equal(back.action, "back-inside");
});

test("active hours follow Copenhagen time across DST", () => {
  const cfg = { timezone: "Europe/Copenhagen", activeHours: { start: "07:00", end: "17:00" } };
  // Summer (CEST = UTC+2): 05:00 UTC is 07:00 local.
  assert.equal(isWithinActiveHours(new Date("2026-07-15T05:00:00Z"), cfg), true);
  assert.equal(isWithinActiveHours(new Date("2026-07-15T04:55:00Z"), cfg), false);
  assert.equal(isWithinActiveHours(new Date("2026-07-15T14:55:00Z"), cfg), true);
  assert.equal(isWithinActiveHours(new Date("2026-07-15T15:00:00Z"), cfg), false);
  // Winter (CET = UTC+1): 06:00 UTC is 07:00 local.
  assert.equal(isWithinActiveHours(new Date("2026-01-14T05:55:00Z"), cfg), false);
  assert.equal(isWithinActiveHours(new Date("2026-01-14T06:00:00Z"), cfg), true);
  assert.equal(isWithinActiveHours(new Date("2026-01-14T16:00:00Z"), cfg), false);
  // Weekend.
  assert.equal(isWithinActiveHours(new Date("2026-07-18T10:00:00Z"), cfg), false);
});

test("alert message format", () => {
  const msg = formatAlert({
    name: "DAX", zone: "overbought", rsi: 76.9, period: 14,
    time: Date.UTC(2026, 0, 14, 9, 35), timezone: "Europe/Copenhagen",
  });
  assert.equal(msg, "🔺 DAX - RSI(14, 5m) = 76.9 at 10:35 CET");
});

test("Telegram notifier sends each message to every configured chat", async () => {
  const originalFetch = globalThis.fetch;
  const chatIds: string[] = [];
  globalThis.fetch = async (_input, init) => {
    chatIds.push(JSON.parse(String(init?.body)).chat_id);
    return new Response("{}", { status: 200 });
  };
  try {
    await telegramNotifier("token", ["first-chat", "second-chat"]).send("alert");
    assert.deepEqual(chatIds, ["first-chat", "second-chat"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
