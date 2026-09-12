// Turning the FEBRA product exports into seed entities (content-kit/seed-20-worksheet.md).
//
// The export is a bot-flow artefact, not a product API: the English rows carry the facts,
// and the per-language prompt files carry the Arabic/Sorani names and bullet text keyed by
// `BundleID`. Neither is clean. This module reads both and refuses anything it cannot read
// honestly — the worksheet's rule is "every number must be real or left blank, never
// estimated", and a required field that would have to be estimated means the row does not
// import at all.
//
// The pure logic lives here rather than in scripts/ so it can be unit-tested: a script that
// runs a CLI at import time cannot be imported by a test. scripts/febra-to-seed.mjs is a
// thin CLI over these functions.

// ── scalar parsing ───────────────────────────────────────────────────────────
// Every parser returns null rather than a guess. Callers decide whether null is fatal.

/** "1,250 IQD" · "Price:12,000 IQD" → 1250 · 12000 */
export function parsePriceIqd(text) {
  if (!text) return null;
  const s = String(text);
  const m = s.match(/([\d,]+(?:\.\d+)?)\s*(?:IQD|دينار|دینار)/i) ?? s.match(/^\s*([\d,]+)\s*$/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * "Valid For 24h" · "7 days" · "4 Weeks" · "الصلاحية: 7 أيام" → 1 · 7 · 28 · 7
 * Hours resolve only at a whole number of days: "36h" is neither 1 day nor 2, so it is null.
 */
export function parseValidityDays(text) {
  if (!text) return null;
  const s = String(text);
  const weeks = s.match(/(\d+)\s*(?:weeks?|أسابيع|اسابيع|أسبوع|اسبوع|هەفتە)/i);
  if (weeks) return Number(weeks[1]) * 7;
  const days = s.match(/(\d+)\s*(?:days?|أيام|ايام|يوم|ڕۆژ|رۆژ)/i);
  if (days) return Number(days[1]);
  const hours = s.match(/(\d+)\s*(?:h\b|hours?|ساعة|ساعات)/i);
  if (hours && Number(hours[1]) % 24 === 0) return Number(hours[1]) / 24;
  return null;
}

/**
 * "300 MB" · "2.5 GB" · "GB 2.5" → 300 · 2560 · 2560 (1 GB = 1024 MB, D18).
 * Null when the text names more than one distinct size: picking one of them would be a
 * guess, and "Every 4 weeks: 5 GB … total 15 GB" is a real row shape in this export.
 *
 * Null too when the bundle is UNLIMITED. Those rows still carry a GB figure, but it is the
 * fair-use threshold — "Unlimited Internet for 24 hours … FUP applied after using (3GB)".
 * Storing 3 GB as the allowance would make the index answer "how much data do I get?" with
 * a cap the customer does not have; the wording survives in the description either way.
 */
export function parseDataMb(text) {
  if (!text) return null;
  if (/\bunlimited\b|غير محدود|بێ سنوور/i.test(String(text))) return null;
  const sizes = new Set();
  const re = /(?:(\d+(?:\.\d+)?)\s*(GB|MB|جيجابايت|ميجابايت|مێگابایت|گێگابایت)|(GB|MB)\s*(\d+(?:\.\d+)?))/gi;
  for (const m of String(text).matchAll(re)) {
    const value = Number(m[1] ?? m[4]);
    const unit = (m[2] ?? m[3] ?? '').toLowerCase();
    if (!Number.isFinite(value)) continue;
    const isGb = unit.startsWith('g') || unit === 'جيجابايت' || unit === 'گێگابایت';
    sizes.add(Math.round(isGb ? value * 1024 : value));
  }
  return sizes.size === 1 ? [...sizes][0] : null;
}

// ── the per-language prompt files ────────────────────────────────────────────
// Each bundle is a block: a name line, some bullet lines, then a BundleID line. The
// separator around the id varies by file ("-BundleID: 1025" in ATL, "- BundleID : 2628"
// in Yooz), and the RTL files put the list marker after the name rather than before it.

const ID_LINE = /^[\s\-*•]*BundleID\s*[:：]\s*(\d+)\s*$/i;
const BULLET = /^[\s\-*•]+/;

/**
 * @param {string} text contents of a FEBRA prompt file
 * @returns {Map<number, {name: string, bullets: string[]}>}
 */
export function parsePromptBlocks(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = new Map();

  for (const [i, line] of lines.entries()) {
    const idMatch = line.match(ID_LINE);
    if (!idMatch) continue;
    const bundleId = Number(idMatch[1]);

    // Walk back over the bullet lines; the first non-bullet, non-empty line is the name.
    const bullets = [];
    let name = '';
    for (let j = i - 1; j >= 0; j--) {
      const raw = lines[j].trim();
      // Blank lines are layout, not structure: the Yooz file separates the name from its
      // bullets with one, and stopping there cost every Yooz bundle its Arabic name. The
      // previous block's id line is the real boundary.
      if (!raw) continue;
      if (ID_LINE.test(raw)) break; // ran into the previous block — this one has no name
      if (BULLET.test(raw)) {
        bullets.unshift(raw.replace(BULLET, '').trim());
        continue;
      }
      name = raw;
      break;
    }
    // List markers appear on either side: "1. باقة" in the LTR files, "باقة .1" in the RTL
    // ones. Strip whichever is there; keep the name.
    name = name.replace(/^\d+[.)]\s*/, '').replace(/\s*[.)]\s*\d+$/, '').trim();
    if (name || bullets.length) blocks.set(bundleId, { name, bullets: bullets.filter(Boolean) });
  }
  return blocks;
}

/**
 * A RED plan heading reduced to what identifies it, so the same plan can be found in a file
 * that writes its name in another language: "RED Family 50" and "RED العائلي 50" are one
 * plan, and "RED 15 — 12 Weeks" and "RED 15 لمدة 12 أسبوعاً" are another.
 *
 * The tier is the number attached to RED itself, NOT the first number in the line — taking
 * the first would read "RED 15 — 12 Weeks" as the 12 tier.
 *
 * @returns {string|null} null when the heading is not a plan ("باقات RED العائلية" is a
 *   section title: it names no tier)
 */
export function redSignature(heading) {
  const s = String(heading);
  if (!/\bRED\b/i.test(s)) return null;
  const tier = s.match(/\bRED\b[^\d]{0,20}(\d+)/i);
  if (!tier) return null;
  const family = /family|العائلي|عائلي|خێزان/i.test(s);
  const twelveWeeks = /12\s*(weeks?|أسبوع|اسبوع|هەفتە)|لمدة\s*12/i.test(s);
  return `red|${tier[1]}|${family ? 'family' : ''}|${twelveWeeks ? '12w' : ''}`;
}

/**
 * The RED plans are keyed by their name rather than a BundleID — the Line files list them
 * as "1. RED 5" with the bullets under it. Only blocks whose title is a plan we are looking
 * for count, because these files carry other numbered lists ("1. Asiacell App, 2. Dialing
 * *230#") that are not products.
 *
 * @param {string} text contents of a Line FEBRA file
 * @param {Iterable<string>} wantedNames the English names to match
 * @returns {Map<string, {name: string, bullets: string[]}>} keyed by lowercased English name
 */
export function parseNamedBlocks(text, wantedNames) {
  const byName = new Map();
  const bySignature = new Map();
  for (const name of wantedNames) {
    const key = name.trim().toLowerCase();
    byName.set(key, key);
    const sig = redSignature(name);
    if (sig) bySignature.set(sig, key);
  }

  const lines = String(text).split(/\r?\n/);
  const blocks = new Map();
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^\s*\d+[.)]\s*(.+?)\s*$/);
    if (heading) {
      const title = heading[1].trim();
      const key = byName.get(title.toLowerCase()) ?? bySignature.get(redSignature(title));
      current = key ? { name: title, bullets: [] } : null;
      if (current) blocks.set(key, current);
      continue;
    }
    if (!current) continue;
    const raw = line.trim();
    if (!raw) continue;
    if (BULLET.test(raw)) current.bullets.push(raw.replace(BULLET, '').trim());
    else current = null; // prose after the bullets ends the block
  }
  return blocks;
}

/**
 * The Arabic Line file renders `*230#` as `#230` — ten times, while the Kurdish file and
 * the Arabic file's own other codes ("*133#", "*244#") are intact. It is the RTL mangling
 * the source itself warns about ("always display USSD codes in their original LTR format …
 * The code should not be reversed or altered"), and shipping it would teach the index a
 * shortcode that does not dial.
 *
 * The repair is grounded, not guessed: `#NNN` is rewritten only when `*NNN#` appears in the
 * reference text for the same plan. A `#NNN` that is already part of a longer code
 * (`*#313#` is a real form) is left alone.
 *
 * @returns {{text: string, repaired: string[]}}
 */
export function repairUssd(text, reference) {
  const canonical = new Set([...String(reference).matchAll(/\*(\d{3,5})#/g)].map((m) => m[1]));
  const repaired = [];
  const fixed = String(text).replace(/(^|[^*\d])#(\d{3,5})(?!#)/g, (whole, before, digits) => {
    if (!canonical.has(digits)) return whole;
    repaired.push(`#${digits} → *${digits}#`);
    return `${before}*${digits}#`;
  });
  return { text: fixed, repaired };
}

// ── row → entity ─────────────────────────────────────────────────────────────

const CLEAN = (s) => String(s ?? '').replace(/\s*\|\s*/g, ' · ').replace(/\s+/g, ' ').trim();

/** Product names in this export carry the prompt file's markdown: "…2 GB**:" → "…2 GB". */
const cleanName = (s) => CLEAN(s).replace(/\*+/g, '').replace(/[:：]\s*$/, '').trim();

// Some rows are not products at all — they are instructions to the bot that list several
// products underneath ("If a user asks about these countries, provide specific packages as
// outlined: … Maldives 30GB Package … Price: 70,000 IQD"). Importing one as a single entity
// would attach one product's price to a heading covering six countries.
const BOT_DIRECTIVE = /\bif\s+(?:an?\s+|the\s+)?user\s+asks\b|\bprovide\s+(?:specific\s+)?packages\b|\bas\s+outlined\b/i;

// "**Operators**: [Operator(s) based on selected country]" — an unfilled template slot. It
// is the export's own text, but a customer must never be shown a placeholder, so the
// segment carrying it is dropped and the row is flagged.
const PLACEHOLDER = /\[[^\]]*\]/;

/**
 * The English `validity` column is the first place to look, but it is corrupt on one row
 * and empty on four more, where the duration is stated in the description instead
 * ("Unlimited Internet for 7 days"). Reading it from the description is reading the data;
 * reading it from the bundle NAME ("Daily …") would be inferring, so we do not.
 */
function resolveValidity(row, translations) {
  const fromField = parseValidityDays(row.validity);
  if (fromField) return { days: fromField, from: 'validity' };
  const fromDesc = parseValidityDays(row.description);
  if (fromDesc) return { days: fromDesc, from: 'description' };
  for (const [lang, block] of Object.entries(translations)) {
    const fromBullets = parseValidityDays(block.bullets.join(' '));
    if (fromBullets) return { days: fromBullets, from: `${lang} prompt block` };
  }
  return { days: null, from: null };
}

function describe(row, days) {
  const body = CLEAN(row.description)
    .split(' · ')
    .filter((seg) => !PLACEHOLDER.test(seg))
    .join(' · ');
  const parts = [body];
  // Most rows state price and validity inside the description already; appending them
  // unconditionally produced "… Validity: 4 Weeks. Price: 40,000 IQD. Validity: 4 Weeks."
  // in the embedded chunk. Add each only when the description does not already carry it.
  const price = CLEAN(row.price);
  if (price && !/price/i.test(body)) parts.push(`Price: ${price}`);
  const validity = CLEAN(row.validity);
  if (/\bvalid(?:ity|\s+for)\b|\bauto-?renew/i.test(body)) return `${parts.filter(Boolean).join('. ')}.`;
  if (validity && parseValidityDays(validity)) parts.push(`Validity: ${validity}`);
  else if (days) parts.push(`Validity: ${days} days`);
  return `${parts.filter(Boolean).join('. ')}.`;
}

/**
 * @param {object} row a row of bundles_*_FEBRA_En.json
 * @param {object} opts
 * @param {Record<string,{name:string,bullets:string[]}>} opts.translations keyed by language
 * @param {string} opts.family ATL | Yooz | Line — which export the row came from
 * @param {string[]} opts.serviceClasses eligible_service_classes for that family
 * @param {string} opts.now ISO timestamp for updated_at
 * @returns {{entity: object|null, skip: string|null, notes: string[]}}
 */
export function rowToEntity(row, { translations = {}, family = '', serviceClasses = [], now }) {
  const notes = [];
  const rawId = String(row.bundleId ?? '').trim();
  const bundleId = Number(rawId);
  if (!rawId || !Number.isInteger(bundleId) || bundleId <= 0) {
    return { entity: null, skip: 'no bundleId — identity is the numeric id, never the display name (docs/27 §4)', notes };
  }
  const nameEn = cleanName(row.name);
  if (!nameEn) return { entity: null, skip: 'no English name in the export row', notes };
  if (BOT_DIRECTIVE.test(row.name) || BOT_DIRECTIVE.test(row.description ?? '')) {
    return { entity: null, skip: 'not a product row — bot-flow instruction text listing several packages under one id', notes };
  }

  const price = parsePriceIqd(row.price);
  if (!price) return { entity: null, skip: `price unreadable from "${CLEAN(row.price)}"`, notes };

  const { days, from } = resolveValidity(row, translations);
  if (!days) {
    return { entity: null, skip: 'validity unreadable from the row, its description or any translation — needs a BSS lookup', notes };
  }
  if (from !== 'validity') notes.push(`validity_days read from the ${from}, not the validity column`);

  const sourceText = `${row.name} ${row.description}`;
  const dataMb = parseDataMb(sourceText);
  if (dataMb == null && /\d+\s*(GB|MB)/i.test(sourceText)) {
    notes.push(/\bunlimited\b/i.test(sourceText)
      ? 'data_mb left blank — the bundle is unlimited and its GB figure is the fair-use threshold, not an allowance'
      : 'data_mb left blank — the row names more than one size, so picking one would be a guess');
  }
  if (PLACEHOLDER.test(row.description ?? '')) {
    notes.push('an unfilled template slot ("[Operator(s) based on selected country]") was dropped from the description');
  }

  const names = { en: nameEn };
  const description = { en: describe(row, days) };
  for (const [lang, block] of Object.entries(translations)) {
    const translated = cleanName(block.name);
    if (translated) names[lang] = translated;
    const body = block.bullets.join(' · ');
    if (body) description[lang] = body;
  }
  const missing = ['ar', 'ckb', 'kmr'].filter((l) => !names[l]);
  if (missing.length) {
    notes.push(`no ${missing.join('/')} name in the export — machine translation deliberately NOT substituted (docs/21)`);
  }

  const displayValidity = CLEAN(row.validity);

  return {
    entity: {
      entity_id: `bundle_${bundleId}`,
      type: 'bundle',
      subtype: 'atl',
      bundleId,
      offerId: null,
      names,
      aliases: [],
      description,
      price_iqd: price,
      validity_days: days,
      ...(dataMb != null ? { data_mb: dataMb } : {}),
      display: {
        price: { en: CLEAN(row.price) },
        ...(displayValidity && parseValidityDays(displayValidity)
          ? { validity: { en: displayValidity } }
          : {}),
      },
      eligible_service_classes: serviceClasses,
      eligible_locations: [],
      valid_from: null,
      valid_to: null,
      belongs_to_service: null,
      conflicts_with: [],
      offers: [],
      status: 'draft',
      source: 'mixed',
      version: 1,
      updated_at: now,
      languages_present: Object.keys(names),
      attributes: {
        febra_family: family,
        review_note: [
          `Imported from the FEBRA ${family} export by scripts/febra-to-seed.mjs.`,
          'Facts (id, price, validity, data) are the export’s; ar/ckb text is the export’s own',
          'prompt copy, not a translation. NO subscribe/unsubscribe steps were written — the',
          'export carries none, and inventing a shortcode is exactly how the placeholder seed',
          'went wrong. Still needed before status:verified: how_to, aliases from real logs, the',
          'minutes/SMS split (on-net vs all-networks is ambiguous in the source), kmr text, and',
          'a docs/21 native review.',
          ...notes.map((n) => `⚠ ${n}`),
        ].join(' '),
      },
    },
    skip: null,
    notes,
  };
}

// ── the RED line plans ───────────────────────────────────────────────────────
// These failed the bundle import for a good reason: `bundle` requires an integer bundleId
// and the Line rows have none. But a RED plan is a tariff on a line, not a bundle bought
// against one, and `service` carries no id requirement — so they model correctly as
// services. They are also the only rows in the whole export with REAL subscription steps.

const SUBSCRIBE_BULLET = /subscription method|طريقة الاشتراك|شێوازی بەشداریکردن/i;

const slug = (name) => String(name).toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * @param {object} row a row of bundles_Line_FEBRA_En.json
 * @param {object} opts
 * @param {Record<string,{name:string,bullets:string[]}>} opts.translations keyed by language
 * @param {string} opts.now ISO timestamp
 * @returns {{entity: object|null, skip: string|null, notes: string[]}}
 */
export function lineRowToService(row, { translations = {}, now }) {
  const notes = [];
  const name = cleanName(row.name);
  if (!name) return { entity: null, skip: 'no name in the export row', notes };

  const price = parsePriceIqd(row.price);
  const days = parseValidityDays(row.validity) ?? parseValidityDays(row.description);
  if (!price) return { entity: null, skip: `price unreadable from "${CLEAN(row.price)}"`, notes };
  if (!days) return { entity: null, skip: 'validity unreadable', notes };

  // English comes from the JSON row, other languages from their prompt block. Either way
  // the subscription line is lifted OUT of the description so the chunker emits it as its
  // own `subscribe` section (docs/03) rather than burying it in the overview.
  const split = (parts) => {
    const body = parts.filter((p) => p && !SUBSCRIBE_BULLET.test(p));
    const subscribe = parts.find((p) => SUBSCRIBE_BULLET.test(p)) ?? null;
    return { body: body.join(' · '), subscribe };
  };

  const en = split(CLEAN(row.description).split(' · '));
  const names = { en: name };
  const description = { en: en.body };
  const subscribe = {};
  if (en.subscribe) subscribe.en = en.subscribe;

  for (const [lang, block] of Object.entries(translations)) {
    const { body, subscribe: sub } = split(block.bullets);
    // The plan name is a brand ("RED 5") and the translated files use it verbatim, so this
    // is what the entity is actually called in that language — not a translation of ours.
    if (body) { names[lang] = name; description[lang] = body; }
    if (!sub) continue;
    const { text, repaired } = repairUssd(sub, en.subscribe ?? '');
    subscribe[lang] = text;
    for (const r of repaired) notes.push(`${lang}: repaired a mangled USSD code in the subscribe step (${r})`);
  }

  if (!Object.keys(subscribe).length) {
    notes.push('no subscription method in the source — this plan gets no subscribe chunk');
  }
  const missing = ['ar', 'ckb', 'kmr'].filter((l) => !names[l]);
  if (missing.length) notes.push(`no ${missing.join('/')} copy in the export — machine translation deliberately NOT substituted (docs/21)`);

  return {
    entity: {
      entity_id: `service_${slug(name)}`,
      type: 'service',
      names,
      aliases: [],
      description,
      ...(Object.keys(subscribe).length ? { how_to: { subscribe } } : {}),
      price_iqd: price,
      validity_days: days,
      display: { price: { en: CLEAN(row.price) }, validity: { en: CLEAN(row.validity) } },
      eligible_service_classes: ['red'],
      eligible_locations: [],
      valid_from: null,
      valid_to: null,
      belongs_to_service: null,
      conflicts_with: [],
      status: 'draft',
      source: 'mixed',
      version: 1,
      updated_at: now,
      languages_present: Object.keys(names),
      attributes: {
        febra_family: 'Line',
        review_note: [
          'Imported from the FEBRA Line export by scripts/febra-to-seed.mjs. Modelled as a',
          'service, not a bundle: these rows carry NO bundleId, and a RED plan is a tariff on',
          'a line rather than a bundle bought against one. The subscription steps are the',
          'export’s own and are the only real ones in it. Still needed before status:verified:',
          'confirmation that these are the live prices, aliases from real logs, kmr copy, and a',
          'docs/21 native review.',
          ...notes.map((n) => `⚠ ${n}`),
        ].join(' '),
      },
    },
    skip: null,
    notes,
  };
}

/**
 * @param {object[]} rows bundles_Line_FEBRA_En.json
 * @param {{translations?:Record<string,Map<string,object>>, now?:string}} [opts]
 */
export function linesToServices(rows, { translations = {}, now = new Date().toISOString() } = {}) {
  const entities = [];
  const skipped = [];
  const notes = [];
  for (const row of rows) {
    const perLang = {};
    for (const [lang, blocks] of Object.entries(translations)) {
      const block = blocks.get(cleanName(row.name).toLowerCase());
      if (block) perLang[lang] = block;
    }
    const { entity, skip, notes: n } = lineRowToService(row, { translations: perLang, now });
    if (skip) { skipped.push({ family: 'Line', bundleId: '—', name: CLEAN(row.name), reason: skip }); continue; }
    entities.push(entity);
    if (n.length) notes.push({ entity_id: entity.entity_id, notes: n });
  }
  return { entities, skipped, notes };
}

/**
 * @param {{family:string, rows:object[], serviceClasses?:string[],
 *          translations?:Record<string,Map<number,object>>}[]} families
 * @param {{now?:string}} [opts]
 * @returns {{entities:object[], skipped:{family:string,bundleId:string,name:string,reason:string}[],
 *            notes:{entity_id:string,notes:string[]}[]}}
 */
export function febraToEntities(families, { now = new Date().toISOString() } = {}) {
  const entities = [];
  const skipped = [];
  const notes = [];

  // An id that appears twice is two different products wearing one identity — the Iran and
  // UAE roaming rows both claim 1013. Importing either would answer one question with the
  // other's facts, so both go to the report instead of the index.
  const idCounts = new Map();
  for (const { rows } of families) {
    for (const row of rows) {
      const id = String(row.bundleId ?? '').trim();
      if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }
  }

  for (const { family, rows, serviceClasses = [], translations = {} } of families) {
    for (const row of rows) {
      const id = String(row.bundleId ?? '').trim();
      if (id && idCounts.get(id) > 1) {
        skipped.push({
          family,
          bundleId: id,
          name: CLEAN(row.name),
          reason: `bundleId ${id} is claimed by ${idCounts.get(id)} different rows — identity collision`,
        });
        continue;
      }
      const perLang = {};
      for (const [lang, blocks] of Object.entries(translations)) {
        const block = blocks.get(Number(id));
        if (block) perLang[lang] = block;
      }
      const { entity, skip, notes: n } = rowToEntity(row, { translations: perLang, family, serviceClasses, now });
      if (skip) {
        skipped.push({ family, bundleId: id, name: CLEAN(row.name), reason: skip });
        continue;
      }
      entities.push(entity);
      if (n.length) notes.push({ entity_id: entity.entity_id, notes: n });
    }
  }

  // Two ids, one name, identical facts (1712 and 2180 are both "MAX Card 25 for 4 Weeks",
  // 25,000 IQD, 28 days). Unlike an id collision this is importable — they may be a live
  // and a retired SKU — but retrieval will surface both for one question, so say so.
  const byFacts = new Map();
  for (const e of entities) {
    const key = `${e.names.en.toLowerCase()}|${e.price_iqd}|${e.validity_days}`;
    byFacts.set(key, [...(byFacts.get(key) ?? []), e]);
  }
  for (const group of byFacts.values()) {
    if (group.length < 2) continue;
    for (const e of group) {
      const others = group.filter((g) => g !== e).map((g) => g.bundleId).join(', ');
      const note = `same name and facts as bundleId ${others} — confirm which id is live, or retrieval answers one question with two identical cards`;
      e.attributes.review_note += ` ⚠ ${note}`;
      const existingNotes = notes.find((x) => x.entity_id === e.entity_id);
      if (existingNotes) existingNotes.notes.push(note);
      else notes.push({ entity_id: e.entity_id, notes: [note] });
    }
  }
  return { entities, skipped, notes };
}
