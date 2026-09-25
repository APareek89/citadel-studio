import type { Provider } from "../shared/types.js";

// Standard text inference rates, verified 2026-09-25:
// https://ai.google.dev/gemini-api/docs/pricing
// Unknown models intentionally remain unpriced. These are estimates, not invoices.
export function estimate(
  provider: Provider,
  model: string,
  inputTokens: number,
  outputTokens: number,
  at: Date = new Date(),
): number | undefined {
  const rates: Record<string, [number, number]> = {
    "gemini-3.5-flash-lite": [0.3, 2.5],
    "gemini-3.5-flash": [1.5, 9],
    "gemini-3.8-flash":
      at < new Date("2027-01-01T00:00:00Z") ? [0.75, 3.75] : [1.5, 7.5],
    "gemini-2.5-flash-lite": [0.1, 0.4],
    "gemini-2.5-flash": [0.3, 2.5],
    "gemini-2.5-pro": inputTokens > 200000 ? [2.5, 15] : [1.25, 10],
  };
  const rate = provider === "gemini" ? rates[model] : undefined;
  return rate
    ? (inputTokens * rate[0] + outputTokens * rate[1]) / 1e6
    : undefined;
}
