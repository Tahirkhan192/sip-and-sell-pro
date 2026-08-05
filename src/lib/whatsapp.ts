// Client-side helper that attempts to send a WhatsApp invoice via the Cloud API.
// Silent — never blocks the sale. Requires WHATSAPP_TOKEN + WHATSAPP_PHONE_ID
// secrets configured server-side; until then this is a no-op stub so the
// invoice flow keeps working unchanged.
import { money, num } from "@/lib/format";

export type WhatsAppPayload = {
  invoice_no: string;
  customer_phone: string;
  customer_name?: string;
  grand_total: number;
  cash_paid: number;
  online_paid: number;
  items: { name: string; quantity: number; total: number; unit?: string }[];
};

export function buildInvoiceMessage(p: WhatsAppPayload): string {
  const lines: string[] = [];
  lines.push(`*Khyber Delicious Food — ${p.invoice_no}*`);
  if (p.customer_name) lines.push(`Customer: ${p.customer_name}`);
  lines.push("");
  for (const it of p.items) {
    lines.push(`• ${it.name}  ${num(it.quantity)}${it.unit && it.unit !== "pcs" ? ` ${it.unit}` : ""}  —  ${money(it.total)}`);
  }
  lines.push("");
  lines.push(`*Total:* ${money(p.grand_total)}`);
  if (num(p.cash_paid) > 0) lines.push(`Cash: ${money(p.cash_paid)}`);
  if (num(p.online_paid) > 0) lines.push(`Online: ${money(p.online_paid)}`);
  const remaining = Math.max(0, num(p.grand_total) - num(p.cash_paid) - num(p.online_paid));
  if (remaining > 0) lines.push(`Remaining: ${money(remaining)}`);
  lines.push("");
  lines.push("Thank you!");
  return lines.join("\n");
}

export async function sendWhatsappInvoice(payload: WhatsAppPayload): Promise<{ ok: boolean; reason?: string }> {
  if (!payload.customer_phone || payload.customer_phone.length < 5) {
    return { ok: false, reason: "no-phone" };
  }
  try {
    const res = await fetch("/api/public/whatsapp-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const data = (await res.json().catch(() => ({}))) as any;
    return { ok: !!data?.ok, reason: data?.reason };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "network" };
  }
}
