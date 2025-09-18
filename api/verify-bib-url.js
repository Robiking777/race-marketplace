const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {}
  }
  const { url, bib } = body || {};
  if (!url || !bib) return res.status(400).json({ error: 'url_and_bib_required' });
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'RaceMarketplace/1.0' } });
    if (!r.ok) return res.status(200).json({ status: 'unknown', reason: 'fetch_failed', http: r.status });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('pdf') || ct.includes('zip')) return res.status(200).json({ status: 'unknown', reason: 'binary' });
    const text = await r.text();
    const needle = String(bib).trim();
    let found = false;
    if (ct.includes('json') || url.endsWith('.json')) {
      try {
        found = JSON.stringify(JSON.parse(text)).match(new RegExp(`(^|\\W)${esc(needle)}(\\W|$)`, 'i'));
      } catch {}
    } else if (ct.includes('csv') || url.endsWith('.csv') || /[,;\t]/.test(text.slice(0, 2000))) {
      const rx = new RegExp(`(^|[\\s,;\\t])${esc(needle)}([\\s,;\\t]|$)`, 'i');
      found = rx.test(text);
    } else {
      const rx = new RegExp(`(^|[^0-9A-Za-z])${esc(needle)}([^0-9A-Za-z]|$)`, 'i');
      found = rx.test(text);
    }
    return res.status(200).json({ status: found ? 'verified' : 'not_found', source: url });
  } catch (e) {
    return res.status(200).json({ status: 'unknown', reason: 'exception' });
  }
}
