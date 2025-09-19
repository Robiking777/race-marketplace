import { runScraperChunk } from '../scripts/scrape-maratonypolskie.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

export default async function handler(req, res) {
  const { from = '2025-10-01', to = '2026-12-31', cursor, budgetMs, key } = req.query || {};

  if (process.env.SCRAPER_SECRET && key !== process.env.SCRAPER_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const timeBudgetMs = Math.min(Number(budgetMs) || 45000, 55000);
  const cur = Number.isFinite(Number(cursor)) ? Number(cursor) : 0;

  try {
    const out = await runScraperChunk({ from, to, cursor: cur, timeBudgetMs });
    return res.status(200).json({ ok: true, from, to, ...out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
