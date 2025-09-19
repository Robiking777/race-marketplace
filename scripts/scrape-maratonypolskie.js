import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import slugify from 'slugify';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE environment variables.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

const BASE_LIST_URL = 'https://www.maratonypolskie.pl/mp_index.php?action=1&dzial=3&grp=13&trgr=1&wielkosc=2&starty=';
const BASE_ORIGIN = 'https://www.maratonypolskie.pl/';
const HEADERS = {
  'User-Agent': 'RaceMarketplaceBot/1.0 (contact: admin@racemarketplace.pl)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pl,en;q=0.8',
};

const FROM = new Date('2025-10-01T00:00:00Z');
const TO = new Date('2026-12-31T23:59:59Z');
const PAGE_DELAY_MS = 800;
const DETAIL_DELAY_MS = 800;
const MAX_PAGES = 400;

const DATE_PATTERN = /(\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4})/;

const detailCache = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseDate(value) {
  if (!value) return null;
  const trimmed = value.trim();
  let match = trimmed.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (match) {
    const [, y, m, d] = match;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  match = trimmed.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }
  return null;
}

function textContent($element) {
  if (!$element || !$element.length) return '';
  return $element
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeCity(raw) {
  if (!raw) return null;
  let city = raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\(.*?\)/g, '')
    .replace(/woj\.[^,]+/gi, '')
    .replace(/pow\.[^,]+/gi, '')
    .replace(/gmina[^,]+/gi, '')
    .replace(/,?\s*Polska$/i, '')
    .trim();
  city = city.split(',')[0].trim();
  city = city.replace(/\s+-\s+/g, '-');
  if (!city || /\d/.test(city)) return null;
  return city;
}

function normalizeDistanceLabel(value) {
  if (!value) return [];
  const lower = value.toLowerCase();
  const results = new Set();

  if (lower.includes('ultra')) {
    results.add('Ultramaraton');
  }
  if (/p[oó]?[łl]\s*-?\s*maraton/.test(lower) || lower.includes('polmaraton')) {
    results.add('Półmaraton');
  }

  const kmRegex = /(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:km|kilometr(?:ów|y|ach)?)/gi;
  let match;
  while ((match = kmRegex.exec(lower))) {
    const rawNumber = match[1].replace(',', '.');
    const num = Number.parseFloat(rawNumber);
    if (!Number.isFinite(num)) continue;
    if (Math.abs(num - 42.195) < 0.001) {
      results.add('Maraton');
      continue;
    }
    if (Math.abs(num - 21.097) < 0.05 || Math.abs(num - 21.1) < 0.05) {
      results.add('Półmaraton');
      continue;
    }
    const formatted = Number.isInteger(num) ? String(num) : num.toString();
    results.add(`${formatted} km`);
  }

  if (!results.size && lower.includes('maraton') && !lower.includes('pół') && !lower.includes('pol')) {
    // Occasionally the text may only mention "maraton" without a numeric value.
    results.add('Maraton');
  }

  return Array.from(results);
}

function detectDistances(...sources) {
  const aggregated = new Set();
  for (const source of sources) {
    normalizeDistanceLabel(source).forEach((label) => {
      aggregated.add(label);
    });
  }
  return Array.from(aggregated);
}

function resolveUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, BASE_ORIGIN).href;
  } catch (error) {
    return null;
  }
}

function partsAfterDate(rowText, dateText) {
  if (!rowText || !dateText) return [];
  const startIndex = rowText.indexOf(dateText);
  if (startIndex === -1) return [];
  let tail = rowText.slice(startIndex + dateText.length);
  tail = tail.replace(/^\s*\([^)]*\)/, '');
  tail = tail.replace(/^[\s)\-.,;:]+/, '');
  const segments = tail
    .split(/(?:\s+[•·–-]\s+|\.\s+|;\s+)/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments;
}

function parseRow($, row) {
  const $row = $(row);
  const rowText = textContent($row);
  if (!rowText) return null;
  const dateMatch = rowText.match(DATE_PATTERN);
  if (!dateMatch) return null;
  const date = parseDate(dateMatch[0]);
  if (!date) return null;

  const cells = $row
    .find('td')
    .toArray()
    .map((cell) => textContent($(cell)))
    .filter(Boolean);

  let city = null;
  const citySelectors = ['td.kal_miasto', 'td.miasto', 'td:nth-child(2)', 'td:nth-child(3)'];
  for (const selector of citySelectors) {
    const candidate = sanitizeCity(textContent($row.find(selector).first()));
    if (candidate) {
      city = candidate;
      break;
    }
  }
  if (!city) {
    for (let i = 0; i < cells.length; i += 1) {
      const candidate = sanitizeCity(cells[i]);
      if (candidate) {
        city = candidate;
        break;
      }
    }
  }
  if (!city) {
    const segments = partsAfterDate(rowText, dateMatch[0]);
    for (const segment of segments) {
      const candidate = sanitizeCity(segment);
      if (candidate) {
        city = candidate;
        break;
      }
    }
  }

  let name = null;
  let detailHref = null;
  const anchor = $row.find('a[href]').first();
  if (anchor && anchor.length) {
    name = textContent(anchor);
    detailHref = resolveUrl(anchor.attr('href'));
  }
  if (!name) {
    const nameSelectors = ['td.kal_nazwa', 'td.nazwa', 'td:nth-child(3)', 'td:nth-child(4)'];
    for (const selector of nameSelectors) {
      const candidate = textContent($row.find(selector).first());
      if (candidate && !candidate.match(DATE_PATTERN)) {
        name = candidate;
        break;
      }
    }
  }
  if (!name) {
    const segments = partsAfterDate(rowText, dateMatch[0]);
    if (segments.length) {
      // Skip the first segment if it looks like a city or distance.
      const remaining = segments.filter((segment, index) => {
        if (index === 0) return true;
        const distanceLabels = normalizeDistanceLabel(segment);
        if (distanceLabels.length) return false;
        return true;
      });
      name = remaining.length > 1 ? remaining.slice(1).join(' ') : remaining[0];
    }
  }

  const distanceSources = new Set();
  const distanceSelectors = ['td.kal_dyst', 'td.dystans', 'td:nth-child(4)', 'td:nth-child(5)'];
  for (const selector of distanceSelectors) {
    const value = textContent($row.find(selector).first());
    if (value) {
      distanceSources.add(value);
    }
  }
  distanceSources.add(rowText);
  if (anchor && anchor.length) {
    const title = anchor.attr('title');
    if (title) distanceSources.add(title);
  }

  const distances = detectDistances(...distanceSources);

  return {
    date,
    city,
    name,
    detailHref,
    distances,
  };
}

function signatureForItem(item) {
  const datePart = item.date ? formatDate(item.date) : 'unknown';
  const namePart = item.name ? item.name.toLowerCase() : 'unknown';
  const cityPart = item.city ? item.city.toLowerCase() : 'unknown';
  return `${datePart}|${namePart}|${cityPart}`;
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText} ${body.slice(0, 120)}`);
  }
  return response.text();
}

async function parseDetailPage(url) {
  if (!url) return null;
  if (detailCache.has(url)) {
    return detailCache.get(url);
  }
  await sleep(DETAIL_DELAY_MS);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const nameCandidates = [
    textContent($('h1').first()),
    textContent($('h2').first()),
    textContent($('.tytul').first()),
    textContent($('.tytul1').first()),
    textContent($('title').first()),
  ].filter(Boolean);
  const detailText =
    textContent($('#tresc')) ||
    textContent($('.content')) ||
    textContent($('.opis')) ||
    textContent($('main')) ||
    textContent($('body'));
  const distances = detectDistances(detailText);
  const cityCandidates = [
    textContent($('[class*="miejsce"]').first()),
    textContent($('[class*="miasto"]').first()),
    textContent($('td:contains("Miejsce")').next()),
    textContent($('td:contains("Miasto")').next()),
    textContent($('p:contains("Miejsce")').first()),
    textContent($('p:contains("Miasto")').first()),
  ].filter(Boolean);
  let detailCity = null;
  for (const candidate of cityCandidates) {
    const sanitized = sanitizeCity(candidate.split(':').pop());
    if (sanitized) {
      detailCity = sanitized;
      break;
    }
  }
  if (!detailCity && detailText) {
    const cityMatch =
      detailText.match(/Miejsce\s*:?\s*([^\n]+)/i) || detailText.match(/Miasto\s*:?\s*([^\n]+)/i);
    if (cityMatch) {
      detailCity = sanitizeCity(cityMatch[1]);
    }
  }
  const detail = {
    name: nameCandidates.find((candidate) => candidate && candidate.length > 3) || null,
    distances,
    city: detailCity,
  };
  detailCache.set(url, detail);
  return detail;
}

async function collectItems(offset) {
  const url = `${BASE_LIST_URL}${offset}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $('table tr').each((_, row) => {
    const item = parseRow($, row);
    if (!item) return;
    const signature = signatureForItem(item);
    if (seen.has(signature)) return;
    seen.add(signature);
    results.push(item);
  });

  if (!results.length) {
    $('div, p, li').each((_, element) => {
      const $element = $(element);
      if ($element.closest('tr').length) return;
      const item = parseRow($, element);
      if (!item) return;
      const signature = signatureForItem(item);
      if (seen.has(signature)) return;
      seen.add(signature);
      results.push(item);
    });
  }

  return { url, items: results };
}

async function upsertEvent({ name, city }) {
  const { data: existing, error: selectError } = await supabase
    .from('events')
    .select('id')
    .eq('name', name)
    .eq('city', city)
    .limit(1)
    .maybeSingle();

  if (selectError && selectError.code !== 'PGRST116') {
    throw selectError;
  }

  if (existing && existing.id) {
    return { id: existing.id, created: false };
  }

  const slug = slugify(name, { lower: true, strict: true });
  const { data, error } = await supabase
    .from('events')
    .insert({
      name,
      city,
      slug,
      country_code: 'PL',
      sport_type: 'running',
    })
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  return { id: data.id, created: true };
}

async function upsertEdition(eventId, date, distances) {
  const year = date.getUTCFullYear();
  const startDate = formatDate(date);
  const { data: existing, error: selectError } = await supabase
    .from('event_editions')
    .select('id, start_date, distances')
    .eq('event_id', eventId)
    .eq('year', year)
    .limit(1)
    .maybeSingle();

  if (selectError && selectError.code !== 'PGRST116') {
    throw selectError;
  }

  const normalizedDistances = Array.isArray(distances) && distances.length ? Array.from(new Set(distances)) : [];

  if (existing && existing.id) {
    const updates = {};
    if ((!existing.start_date || existing.start_date === null) && startDate) {
      updates.start_date = startDate;
    }
    const currentDistances = Array.isArray(existing.distances) ? existing.distances : [];
    const mergedDistances = Array.from(new Set([...currentDistances, ...normalizedDistances])).filter(Boolean);
    if (mergedDistances.length !== currentDistances.length) {
      updates.distances = mergedDistances.length ? mergedDistances : null;
    }
    if (Object.keys(updates).length) {
      const { error: updateError } = await supabase
        .from('event_editions')
        .update(updates)
        .eq('id', existing.id);
      if (updateError) {
        throw updateError;
      }
      return { id: existing.id, action: 'updated' };
    }
    return { id: existing.id, action: 'skipped' };
  }

  const { data, error } = await supabase
    .from('event_editions')
    .insert({
      event_id: eventId,
      year,
      start_date: startDate,
      end_date: startDate,
      distances: normalizedDistances.length ? normalizedDistances : null,
    })
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  return { id: data.id, action: 'inserted' };
}

export async function run({ from = FROM, to = TO, maxPages = MAX_PAGES } = {}) {
  const stats = {
    pagesFetched: 0,
    itemsFound: 0,
    itemsInRange: 0,
    eventsCreated: 0,
    eventsMatched: 0,
    editionsInserted: 0,
    editionsUpdated: 0,
    editionsSkipped: 0,
    skippedMissingName: 0,
    skippedMissingCity: 0,
    pagesWithoutResults: 0,
  };

  const fromDate = new Date(from);
  const toDate = new Date(to);
  let offset = 0;
  let sawInRange = false;

  while (offset < maxPages) {
    let pageItems;
    try {
      pageItems = await collectItems(offset);
    } catch (error) {
      console.error(`[scraper] Failed to fetch page ${offset}:`, error.message);
      throw error;
    }

    stats.pagesFetched += 1;

    if (!pageItems.items.length) {
      stats.pagesWithoutResults += 1;
      console.log(`[scraper] Page ${offset} returned no events. Stopping.`);
      break;
    }

    const sorted = [...pageItems.items].sort((a, b) => a.date - b.date);
    stats.itemsFound += sorted.length;

    const inRange = sorted.filter((item) => item.date >= fromDate && item.date <= toDate);
    console.log(
      `[scraper] Page ${offset}: ${sorted.length} total, ${inRange.length} within ${formatDate(fromDate)} - ${formatDate(toDate)}`,
    );

    if (!inRange.length) {
      const allBeforeRange = sorted.every((item) => item.date < fromDate);
      if (allBeforeRange && sawInRange) {
        console.log('[scraper] Remaining events are before the target range. Stopping.');
        break;
      }
      offset += 1;
      await sleep(PAGE_DELAY_MS);
      continue;
    }

    sawInRange = true;
    stats.itemsInRange += inRange.length;

    for (const item of inRange) {
      let detail = null;
      if (item.detailHref && (!item.name || !item.city || !(item.distances && item.distances.length))) {
        try {
          detail = await parseDetailPage(item.detailHref);
        } catch (error) {
          console.warn(`[scraper] Failed to read detail page for ${item.detailHref}: ${error.message}`);
        }
      }

      if (!item.name && detail?.name) {
        item.name = detail.name;
      }
      if ((!item.distances || !item.distances.length) && detail?.distances?.length) {
        item.distances = Array.from(new Set(detail.distances));
      }
      if (!item.city && detail?.city) {
        item.city = detail.city;
      }
      if (!item.city && detail?.name) {
        const inferredCity = sanitizeCity(detail.name.split('-')[0]);
        if (inferredCity) {
          item.city = inferredCity;
        }
      }

      if (!item.name) {
        stats.skippedMissingName += 1;
        console.warn('[scraper] Skipping entry without name', {
          date: formatDate(item.date),
          city: item.city,
          detailHref: item.detailHref,
        });
        continue;
      }

      if (!item.city) {
        stats.skippedMissingCity += 1;
        console.warn('[scraper] Skipping entry without city', {
          date: formatDate(item.date),
          name: item.name,
          detailHref: item.detailHref,
        });
        continue;
      }

      try {
        const eventResult = await upsertEvent({ name: item.name, city: item.city });
        if (eventResult.created) {
          stats.eventsCreated += 1;
        } else {
          stats.eventsMatched += 1;
        }
        const editionResult = await upsertEdition(eventResult.id, item.date, item.distances);
        if (editionResult.action === 'inserted') {
          stats.editionsInserted += 1;
        } else if (editionResult.action === 'updated') {
          stats.editionsUpdated += 1;
        } else {
          stats.editionsSkipped += 1;
        }
      } catch (error) {
        console.error('[scraper] Failed to upsert entry', {
          name: item.name,
          city: item.city,
          date: formatDate(item.date),
          error: error.message,
        });
        throw error;
      }
    }

    offset += 1;
    await sleep(PAGE_DELAY_MS);
  }

  console.log('[scraper] Summary:', JSON.stringify(stats, null, 2));
  return stats;
}

const isDirectRun = fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  run()
    .then((stats) => {
      console.log('[scraper] Completed successfully.');
      return stats;
    })
    .catch((error) => {
      console.error('[scraper] Execution failed:', error);
      process.exit(1);
    });
}
