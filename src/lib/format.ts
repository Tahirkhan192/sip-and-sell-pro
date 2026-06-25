export const fmt = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
export const num = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
};
export const money = (n: number | string | null | undefined) => fmt.format(num(n));
export const today = () => new Date().toISOString().slice(0, 10);
export const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
export const monthDays = (year: number, month0: number) => {
  return new Date(year, month0 + 1, 0).getDate();
};
