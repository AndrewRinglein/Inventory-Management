// Edge function: send-email
// Sends the app's emails via Resend and logs every attempt to the emails table.
// Secrets needed (supabase secrets set):  RESEND_API_KEY
// Deploy:  supabase functions deploy send-email

import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const { emails, hall_id, settings } = await req.json();
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const testMode = settings?.testMode !== false;
    const testAddr = settings?.testAddress || '';
    const from = settings?.fromAddress || 'onboarding@resend.dev';

    const logs = [];
    for (const e of emails) {
      const to = testMode ? testAddr : e.to;
      let status = 'failed';
      let providerId: string | null = null;
      let errNote = '';

      if (!to || to.startsWith('(')) {
        errNote = 'no recipient address configured';
      } else if (!resendKey) {
        errNote = 'RESEND_API_KEY not set';
      } else {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from,
            to: [to],
            subject: (testMode ? '[TEST] ' : '') + e.subject,
            text: e.body + (testMode ? `\n\n--- TEST MODE: would have gone to ${e.to} ---` : ''),
          }),
        });
        if (r.ok) { const d = await r.json(); providerId = d.id; status = 'sent'; }
        else errNote = `resend ${r.status}: ${await r.text()}`;
      }

      const { data } = await sb.from('emails').insert({
        hall_id, po_num: e.po_num || null, kind: e.kind || 'other',
        to_addr: to || e.to, subject: e.subject, body: e.body,
        test_mode: testMode, provider_id: providerId, status,
      }).select().single();
      logs.push({ ...data, error: errNote || undefined });
    }
    return Response.json({ logs });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
