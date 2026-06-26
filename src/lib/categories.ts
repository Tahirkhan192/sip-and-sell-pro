export const CATEGORIES = ["Karahi", "Fast Food", "Snacks", "Juices", "Cold Drinks"] as const;
export type Category = (typeof CATEGORIES)[number];

export const EXPENSE_CATEGORIES = [
  "Salary",
  "Electricity",
  "Gas",
  "Maintenance",
  "Internet",
  "Cleaning",
  "Miscellaneous",
] as const;
