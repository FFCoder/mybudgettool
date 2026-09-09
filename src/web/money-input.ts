import { money as parseMoney } from "../shared/domain";

/** Display integer cents without changing the stored precision. */
export function formatUsdCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Invalid drafts stay exactly as typed; only validated amounts are formatted. */
export function formatMoneyInput(value: string): {
  value: string;
  error?: string;
} {
  try {
    return { value: formatUsdCents(parseMoney(value)) };
  } catch (error) {
    return { value, error: (error as Error).message };
  }
}
