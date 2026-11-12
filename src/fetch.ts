export interface Candle {
  /** Candle start, epoch ms. */
  time: number;
  close: number;
}

export const CANDLE_MS = 5 * 60_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The single data-source function: swap this to change provider.
 * Returns 5-minute candles (oldest first), possibly including the still-forming one.
 */
export async function fetchCandles(symbol: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=5d`;
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseYahooChart(await res.json());
    } catch (err) {
      lastError = err;
      console.warn(`${symbol}: fetch attempt ${attempt + 1}/${RETRIES} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`fetch ${symbol} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function parseYahooChart(json: any): Candle[] {
  const result = json?.chart?.result?.[0];
  const times: number[] | undefined = result?.timestamp;
  const closes: (number | null)[] | undefined = result?.indicators?.quote?.[0]?.close;
  if (!times || !closes) throw new Error(json?.chart?.error?.description ?? "no data in response");
  const candles: Candle[] = [];
  times.forEach((t, i) => {
    const close = closes[i];
    if (close != null) candles.push({ time: t * 1000, close });
  });
  return candles;
}

/** Drops the candle that is still forming (start + 5 min > now). */
export function closedCandles(candles: Candle[], now: number): Candle[] {
  return candles.filter((c) => c.time + CANDLE_MS <= now);
}

/** Keeps candles whose start falls on today's date in the instrument's local timezone. */
export function currentDayCandles(candles: Candle[], now: number, timezone: string): Candle[] {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const today = date.format(now);
  return candles.filter((c) => date.format(c.time) === today);
}

/** True if the newest closed candle closed more than `staleMinutes` ago (or there is none). */
export function isStale(closed: Candle[], now: number, staleMinutes: number): boolean {
  if (closed.length === 0) return true;
  const last = closed[closed.length - 1];
  return now - (last.time + CANDLE_MS) > staleMinutes * 60_000;
}
