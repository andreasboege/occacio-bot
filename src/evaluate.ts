import type { RsiZone, SymbolState } from "./state.ts";

export interface Thresholds {
  oversold: number;
  overbought: number;
  cooldownMinutes: number;
  notifyBackInside: boolean;
}

export type Action = "alert" | "back-inside" | "none";

export interface Evaluation {
  zone: RsiZone;
  action: Action;
  next: SymbolState;
}

export function zoneOf(rsi: number, t: Pick<Thresholds, "oversold" | "overbought">): RsiZone {
  if (rsi < t.oversold) return "oversold";
  if (rsi > t.overbought) return "overbought";
  return "inside";
}

/**
 * Decides what to do for one instrument. The stored zone always follows the real zone;
 * the cooldown only suppresses the alert message.
 */
export function evaluate(prev: SymbolState, rsi: number, now: number, t: Thresholds): Evaluation {
  const zone = zoneOf(rsi, t);
  const next: SymbolState = { ...prev, zone, failures: 0 };
  if (zone === prev.zone) return { zone, action: "none", next };

  if (zone === "inside") {
    return { zone, action: t.notifyBackInside ? "back-inside" : "none", next };
  }

  const cooledDown = prev.lastAlertAt === undefined || now - prev.lastAlertAt >= t.cooldownMinutes * 60_000;
  if (!cooledDown) return { zone, action: "none", next };
  next.lastAlertAt = now;
  return { zone, action: "alert", next };
}
