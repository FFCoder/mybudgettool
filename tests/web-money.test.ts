import { describe, expect, test } from "bun:test";
import { formatMoneyInput, formatUsdCents } from "../src/web/money-input";

describe("currency input display", () => {
  test("initial values show USD and exactly two decimal places", () => {
    expect(formatUsdCents(5000)).toBe("$50.00");
    expect(formatUsdCents(0)).toBe("$0.00");
    expect(formatUsdCents(123456)).toBe("$1,234.56");
  });

  test("blur formats only valid decimal or currency entries", () => {
    for (const value of ["50", "50.0", "50.00", "$50", "$50.00"]) {
      expect(formatMoneyInput(value)).toEqual({ value: "$50.00" });
    }
    expect(formatMoneyInput("1,234.56")).toEqual({ value: "$1,234.56" });
  });

  test("invalid precision is preserved and never silently rounded", () => {
    for (const value of ["50.001", "$50.001", "0.005", "999.999"]) {
      const result = formatMoneyInput(value);
      expect(result.value).toBe(value);
      expect(result.error).toBeTruthy();
    }
  });

  test("invalid drafts remain visible for correction", () => {
    for (const value of ["", "50usd", "$1,23.45", "-50", "1e3", "1.2.3"]) {
      const result = formatMoneyInput(value);
      expect(result.value).toBe(value);
      expect(result.error).toBeTruthy();
    }
  });
});
