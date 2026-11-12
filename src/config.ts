import { readFileSync } from "node:fs";

export interface Instrument {
  name: string;
  emoji?: string;
  symbol: string;
  rsiSessionTimezone?: string;
}

export interface Config {
  rsiPeriod: number;
  oversold: number;
  overbought: number;
  cooldownMinutes: number;
  notifyBackInside: boolean;
  staleMinutes: number;
  failureAlertThreshold: number;
  timezone: string;
  activeHours: { start: string; end: string };
  instruments: Instrument[];
}

export function loadConfig(path = new URL("../config.json", import.meta.url)): Config {
  const config = JSON.parse(readFileSync(path, "utf8")) as Config;
  if (!config.instruments?.length) throw new Error("config.json: no instruments");
  if (config.oversold >= config.overbought) throw new Error("config.json: oversold must be < overbought");
  return config;
}

/** Local wall-clock parts of `now` in the given timezone. */
function localParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { weekday: get("weekday"), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** True on Mon-Fri between start (inclusive) and end (exclusive) in the configured timezone. */
export function isWithinActiveHours(now: Date, config: Pick<Config, "timezone" | "activeHours">): boolean {
  const { weekday, minutes } = localParts(now, config.timezone);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return minutes >= toMinutes(config.activeHours.start) && minutes < toMinutes(config.activeHours.end);
}
