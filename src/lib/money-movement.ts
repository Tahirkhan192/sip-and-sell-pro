export const KATHA_CATEGORIES = ["transaction", "katha", "loan_paid"] as const;
export type KathaCategory = (typeof KATHA_CATEGORIES)[number];
export type Dir = "" | "in" | "out";

export function kathaLabel(c: KathaCategory): string {
  return c === "transaction" ? "Transaction" : c === "katha" ? "Katha" : "Loan Paid";
}

export type MovementRow = {
  payment_source: "cash" | "online";
  type: "cash_in" | "cash_out";
  amount: number;
};

/**
 * Shared validation + row building for Money Movement (page and POS use the same rules).
 * - Cash and Online are treated independently.
 * - Loan Paid only allows OUT (paying back a previous loan).
 * - Katha OUT = Loan Given (increases Loan To Get), Katha IN = Loan Taken (increases Loan To Give).
 */
export function validateMovement(input: {
  cashDir: Dir;
  cashAmt: number;
  onlineDir: Dir;
  onlineAmt: number;
  category: KathaCategory;
}): MovementRow[] {
  const rows: MovementRow[] = [];
  const { cashDir, cashAmt, onlineDir, onlineAmt, category } = input;

  if (cashAmt > 0 && !cashDir) throw new Error("Select Cash direction (In or Out)");
  if (onlineAmt > 0 && !onlineDir) throw new Error("Select Online direction (In or Out)");
  if (cashDir && !(cashAmt > 0)) throw new Error("Enter a Cash amount");
  if (onlineDir && !(onlineAmt > 0)) throw new Error("Enter an Online amount");

  if (category === "loan_paid") {
    if (cashDir === "in" || onlineDir === "in") throw new Error("Loan Paid allows Out only");
  }

  if (cashDir && cashAmt > 0) rows.push({ payment_source: "cash", type: cashDir === "in" ? "cash_in" : "cash_out", amount: cashAmt });
  if (onlineDir && onlineAmt > 0) rows.push({ payment_source: "online", type: onlineDir === "in" ? "cash_in" : "cash_out", amount: onlineAmt });

  if (rows.length === 0) throw new Error("Enter a Money Movement amount and direction");
  return rows;
}
