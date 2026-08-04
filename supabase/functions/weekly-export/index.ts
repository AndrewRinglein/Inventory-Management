// Edge function: weekly-export
// Emails a CSV snapshot of inventory, open POs, and payments to the accounting address.
// Schedule it (Supabase Dashboard -> Edge Functions -> Cron, or SQL below) for Mondays 7am:
//   select cron.schedule('weekly-export', '0 15 * * 1',   -- 15:00 UTC = 7/8am Pacific
//     $$ select net.http_post(
//          url := '<PROJECT_URL>/functions/v1/weekly-export',
//          headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb ) $$);
// Secrets needed:  RESEND_API_KEY

import { createClient } from 'npm:@supabase/supabase-js@2';

const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: emailCfgRow } = await sb.from('settings').select('value').eq('key', 'email').single();
    const cfg = emailCfgRow?.value || {};
    const to = cfg.accountingAddress || cfg.testAddress;
    if (!to) return Response.json({ error: 'no accounting/test address configured' }, { status: 400, headers: CORS });

    const [boxes, pos, payments] = await Promise.all([
      sb.from('boxes').select('hall_id,product_id,serial,state,cost,received_at,opened_at,sold_out_at'),
      sb.from('purchase_orders').select('num,hall_id,vendor_id,status,subtotal,tax,total,sent_at'),
      sb.from('payments').select('hall_id,vendor_id,po_num,invoice_no,amount,status,created_at'),
    ]);

    const stamp = new Date().toISOString().slice(0, 10);
    const body = [
      `Weekly data export — ${stamp}`,
      ``, `=== BOXES (${boxes.data?.length || 0}) ===`, csv(boxes.data || []),
      ``, `=== PURCHASE ORDERS (${pos.data?.length || 0}) ===`, csv(pos.data || []),
      ``, `=== PAYMENTS (${payments.data?.length || 0}) ===`, csv(payments.data || []),
    ].join('\n');

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: cfg.fromAddress || 'onboarding@resend.dev',
        to: [to],
        subject: `Bingo inventory weekly export — ${stamp}`,
        text: body,
      }),
    });
    await sb.from('emails').insert({
      kind: 'export', to_addr: to, subject: `Weekly export ${stamp}`,
      body: `(${body.length} chars)`, test_mode: false, status: r.ok ? 'sent' : 'failed',
    });
    return Response.json({ ok: r.ok }, { headers: CORS });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: CORS });
  }
});
