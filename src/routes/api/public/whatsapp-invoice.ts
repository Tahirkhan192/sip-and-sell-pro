import { createFileRoute } from "@tanstack/react-router";

// Silent WhatsApp Cloud API sender. If WHATSAPP_TOKEN / WHATSAPP_PHONE_ID
// secrets are not set, responds with { ok: false, reason: "not-configured" }
// so the POS flow can show a non-blocking toast.
export const Route = createFileRoute("/api/public/whatsapp-invoice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.WHATSAPP_TOKEN;
        const phoneId = process.env.WHATSAPP_PHONE_ID;
        const body = await request.json().catch(() => null) as any;
        if (!body?.customer_phone) {
          return new Response(JSON.stringify({ ok: false, reason: "no-phone" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (!token || !phoneId) {
          return new Response(JSON.stringify({ ok: false, reason: "not-configured" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        try {
          const items = (body.items ?? []) as any[];
          const lines: string[] = [];
          lines.push(`*Khyber Delicious Food — ${body.invoice_no}*`);
          if (body.customer_name) lines.push(`Customer: ${body.customer_name}`);
          lines.push("");
          for (const it of items) {
            lines.push(`• ${it.name} ${it.quantity} — ${it.total}`);
          }
          lines.push("");
          lines.push(`*Total:* ${body.grand_total}`);
          const text = lines.join("\n");

          const phone = String(body.customer_phone).replace(/[^0-9]/g, "");
          const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } }),
          });
          if (!res.ok) {
            const err = await res.text();
            return new Response(JSON.stringify({ ok: false, reason: `whatsapp-${res.status}`, detail: err.slice(0, 200) }), { status: 200, headers: { "content-type": "application/json" } });
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
        } catch (e: any) {
          return new Response(JSON.stringify({ ok: false, reason: e?.message ?? "error" }), { status: 200, headers: { "content-type": "application/json" } });
        }
      },
    },
  },
});
