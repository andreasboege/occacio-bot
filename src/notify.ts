import type { RsiZone } from "./state.ts";

export interface Notifier {
  send(text: string): Promise<void>;
}

export function consoleNotifier(): Notifier {
  return { send: async (text) => console.log(`[dry-run] ${text}`) };
}

export function telegramNotifier(token: string, chatId: string): Notifier {
  return {
    async send(text) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
    },
  };
}

/** e.g. "10:35 CET" in the given timezone. */
export function formatTime(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
}

export interface AlertInfo {
  name: string;
  zone: RsiZone;
  rsi: number;
  period: number;
  oversold: number;
  overbought: number;
  close: number;
  time: number;
  timezone: string;
}

export function formatAlert(a: AlertInfo): string {
  const price = a.close.toLocaleString("en-US", { maximumFractionDigits: 5 });
  const when = formatTime(a.time, a.timezone);
  const head = `RSI(${a.period}, 5m) = ${a.rsi.toFixed(1)}`;
  if (a.zone === "oversold") return `🔻 ${a.name} ${head} (< ${a.oversold}) at ${when}, last close ${price}`;
  if (a.zone === "overbought") return `🔺 ${a.name} ${head} (> ${a.overbought}) at ${when}, last close ${price}`;
  return `↩️ ${a.name} ${head} back inside ${a.oversold}-${a.overbought} at ${when}, last close ${price}`;
}
