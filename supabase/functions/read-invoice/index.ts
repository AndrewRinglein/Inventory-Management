// Edge function: read-invoice
// Downloads an invoice photo from Storage, asks Claude to extract line items,
// returns { lines: [{name, qty, serials[], amount}] , invoice_no? }.
// Secrets needed:  ANTHROPIC_API_KEY
// Deploy:  supabase functions deploy read-invoice

import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'claude-sonnet-4-5';

Deno.serve(async (req) => {
  try {
    const { path } = await req.json();
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return Response.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });

    const { data: blob, error } = await sb.storage.from('invoices').download(path);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let b64 = '';
    for (let i = 0; i < bytes.length; i += 32768) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + 32768));
    }
    b64 = btoa(b64);
    const mediaType = blob.type || 'image/jpeg';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text:
`This is a delivery invoice from a bingo supplies vendor (pull-tab/flash games).
Extract every line item. Respond with ONLY a JSON object, no other text:
{"invoice_no": "...", "lines": [{"name": "game name as printed", "qty": <number of boxes/units>, "serials": ["serial numbers if printed per box"], "amount": <line dollar amount or null>}]}
If a field is unreadable, use null. Do not invent serials.` },
          ],
        }],
      }),
    });
    if (!resp.ok) return Response.json({ error: `anthropic ${resp.status}: ${await resp.text()}` }, { status: 502 });
    const out = await resp.json();
    const text = out.content?.[0]?.text || '{}';
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { lines: [] };
    return Response.json(parsed);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
