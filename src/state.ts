import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type RsiZone = "inside" | "oversold" | "overbought";

export interface SymbolState {
  zone: RsiZone;
  /** Epoch ms of the last zone alert sent. */
  lastAlertAt?: number;
  failures: number;
}

export type State = Record<string, SymbolState>;

export const initialState = (): SymbolState => ({ zone: "inside", failures: 0 });

export function loadState(path: string): State {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as State;
  } catch {
    return {};
  }
}

export function saveState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}
