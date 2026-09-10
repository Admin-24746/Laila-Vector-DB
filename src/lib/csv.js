// Minimal RFC 4180 CSV reader/writer.
//
// Lives here rather than inside one of the scripts because both stages of the content
// pipeline need it (scripts/logs-to-utterances.mjs writes, scripts/utterances-to-seed.mjs
// reads) and a script that runs a CLI on import cannot safely be imported by another.
//
// No dependency: the content kit's format is plain UTF-8 CSV (content-kit/README.md), and
// pulling in a parser for ~40 lines would be the larger cost.

/**
 * Parse CSV text into rows of raw string cells. Handles quoted fields, embedded commas and
 * newlines, and "" escapes. Strips a UTF-8 BOM — Excel writes one, and it would otherwise
 * become part of the first header name.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // Drop blank trailing lines, but keep genuinely empty cells inside a row.
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
}

/** Parse into objects keyed by the header row. */
export function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { header: [], records: [] };
  const header = rows[0].map((h) => h.trim());
  return {
    header,
    records: rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))),
  };
}

/** Quote a cell only when it needs it, doubling any embedded quote. */
export const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const csvRow = (cells) => cells.map(csvCell).join(',');

/** Serialize objects to CSV text using `header` for both column order and lookup. */
export function toCsv(header, records) {
  return [csvRow(header), ...records.map((r) => csvRow(header.map((h) => r[h])))].join('\n') + '\n';
}
