const HALF_MARATHON_KM = 21.0975;
const MARATHON_KM = 42.195;
const MARATHON_TOLERANCE = 0.3;
const HALF_TOLERANCE = 0.2;
const DISTANCE_REGEX = /(\d{1,3}(?:[.,]\d+)?)\s*km/gi;

function roundKilometers(value) {
  const rounded = Math.round(value * 1000) / 1000;
  let text = Number.isInteger(rounded) ? String(rounded) : rounded.toString();
  if (text.includes(".")) {
    text = text.replace(/0+$/, "").replace(/\.$/, "");
  }
  return text;
}

/**
 * @param {number} km
 * @returns {string | null}
 */
export function normalizeDistanceLabel(km) {
  if (!Number.isFinite(km) || km <= 0) {
    return null;
  }

  if (Math.abs(km - HALF_MARATHON_KM) <= HALF_TOLERANCE) {
    return "Półmaraton";
  }
  if (Math.abs(km - MARATHON_KM) <= MARATHON_TOLERANCE) {
    return "Maraton";
  }
  if (km > MARATHON_KM + 0.005) {
    return "Ultramaraton";
  }

  return `${roundKilometers(km)} km`;
}

function addUnique(target, value) {
  if (!value) return;
  if (target.set.has(value)) return;
  target.set.add(value);
  target.list.push(value);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function parseDistances(text) {
  if (!text) return [];

  const normalized = String(text)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const result = { list: /** @type {string[]} */ ([]), set: new Set() };

  if (/(ultra[\s-]*maraton|ultramaraton|ultra\s*marathon)/i.test(normalized)) {
    addUnique(result, "Ultramaraton");
  }
  if (/(p[oó]łmaraton|polmaraton|half\s*marathon)/i.test(normalized)) {
    addUnique(result, "Półmaraton");
  }

  const marathonMatches = normalized.match(/(?<![a-ząćęłńóśźż])(maraton|marathon)\b/gi);
  if (marathonMatches) {
    addUnique(result, "Maraton");
  }

  let match;
  while ((match = DISTANCE_REGEX.exec(normalized)) !== null) {
    const value = parseFloat(match[1].replace(/,/g, "."));
    if (!Number.isFinite(value) || value <= 0) continue;
    const label = normalizeDistanceLabel(value);
    addUnique(result, label);
  }

  return result.list;
}

export default {
  parseDistances,
  normalizeDistanceLabel,
};
