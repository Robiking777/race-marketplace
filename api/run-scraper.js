export const config = { maxDuration: 60, runtime: 'nodejs18.x' };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.SCRAPER_SECRET;
  if (!secret) {
    console.error('[run-scraper] SCRAPER_SECRET environment variable is not set');
    return res.status(500).json({ ok: false, error: 'SCRAPER_SECRET is not configured' });
  }

  const keyParam = req.query?.key;
  const providedKey = Array.isArray(keyParam) ? keyParam[0] : keyParam;
  if (providedKey !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const rawFrom = req.query?.from;
  const rawTo = req.query?.to;
  const from = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom;
  const to = Array.isArray(rawTo) ? rawTo[0] : rawTo;

  if (!from || !to) {
    return res.status(400).json({ ok: false, error: 'Query parameters `from` and `to` are required' });
  }

  const rawCursor = req.query?.cursor;
  const cursorParam = Array.isArray(rawCursor) ? rawCursor[0] : rawCursor;
  const parsedCursor = cursorParam !== undefined ? Number.parseInt(cursorParam, 10) : undefined;
  const cursor = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;

  const rawBudget = req.query?.budgetMs;
  const budgetParam = Array.isArray(rawBudget) ? rawBudget[0] : rawBudget;
  const parsedBudget =
    budgetParam !== undefined ? Number.parseInt(budgetParam, 10) : undefined;
  const timeBudgetMs =
    parsedBudget && Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : undefined;

  try {
    const moduleUrl = new URL('../scripts/scrape-maratonypolskie.js', import.meta.url);
    const { runScraperChunk } = await import(moduleUrl.href);

    const options = { from, to, cursor };
    if (timeBudgetMs) {
      options.timeBudgetMs = timeBudgetMs;
    }

    const result = await runScraperChunk(options);

    return res.status(200).json({
      ok: true,
      from,
      to,
      seen: result.seen,
      inserted: result.inserted,
      cursor: result.cursor,
      done: result.done,
    });
  } catch (error) {
    console.error('[run-scraper] Failed to execute scraper', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
