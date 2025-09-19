export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const moduleUrl = new URL('../scripts/scrape-maratonypolskie.js', import.meta.url);
    const { run } = await import(moduleUrl.href);
    const result = await run();
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    console.error('[run-scraper] Failed to execute scraper', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
