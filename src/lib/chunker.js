// Section-aware entity chunking (docs/03):
//   one chunk per answerable section, per language (D1), prefixed with a contextual
//   header (§4.2), deterministic chunk key {entity_id}::{section}::{language} (§6).
// Structured facts are NOT embedded — they ride as filterable payload (§4.5).

export const LANGS = ['en', 'ar', 'ckb', 'kmr'];

const SUBTYPE_LABELS = {
  atl: 'ATL bundle',
  btl: 'BTL bundle',
  corporate: 'Corporate bundle',
};

const TYPE_LABELS = {
  bundle: 'bundle',
  service: 'service',
  terminology: 'terminology',
  roaming: 'roaming',
  error: 'error explanation',
};

// Per-language templates for prose rendered from structured conditions (docs/03 §4.1
// eligibility / fees_edgecases / conflicts). Machine-drafted ar/ckb/kmr — flagged for
// native review in docs/21 workflow.
const T = {
  eligibility: {
    en: (p) => `Eligibility: ${p.classes ? `available to service classes: ${p.classes}.` : 'available to all service classes.'} ${p.locations ? `Available in: ${p.locations}.` : 'Available everywhere in Iraq.'}${p.window ? ` Valid ${p.window}.` : ''}`,
    ar: (p) => `الأهلية: ${p.classes ? `متاح لفئات الخدمة: ${p.classes}.` : 'متاح لجميع فئات الخدمة.'} ${p.locations ? `متوفر في: ${p.locations}.` : 'متوفر في جميع أنحاء العراق.'}${p.window ? ` صالح ${p.window}.` : ''}`,
    ckb: (p) => `مەرجەکان: ${p.classes ? `بەردەستە بۆ پۆلەکانی خزمەتگوزاری: ${p.classes}.` : 'بەردەستە بۆ هەموو پۆلەکانی خزمەتگوزاری.'} ${p.locations ? `بەردەستە لە: ${p.locations}.` : 'لە هەموو عێراق بەردەستە.'}${p.window ? ` کارایە ${p.window}.` : ''}`,
    kmr: (p) => `Mercên beşdariyê: ${p.classes ? `ji bo çînên xizmetê berdest e: ${p.classes}.` : 'ji bo hemû çînên xizmetê berdest e.'} ${p.locations ? `Li van deveran berdest e: ${p.locations}.` : 'Li seranserê Iraqê berdest e.'}${p.window ? ` Derbasdar e ${p.window}.` : ''}`,
  },
  window: {
    en: (from, to) => `from ${from ?? 'now'} to ${to ?? 'further notice'}`,
    ar: (from, to) => `من ${from ?? 'الآن'} إلى ${to ?? 'إشعار آخر'}`,
    ckb: (from, to) => `لە ${from ?? 'ئێستا'} تا ${to ?? 'ئاگادارییەکی تر'}`,
    kmr: (from, to) => `ji ${from ?? 'niha'} heta ${to ?? 'agahdariyeke din'}`,
  },
  fees: {
    en: (n, fee) => `Extra fee: from the ${ordinalEn(n)} subscription in the same month, an extra fee of ${fee} IQD applies.`,
    ar: (n, fee) => `رسوم إضافية: اعتباراً من الاشتراك رقم ${n} خلال نفس الشهر، تُضاف رسوم إضافية قدرها ${fee} دينار عراقي.`,
    ckb: (n, fee) => `تێچووی زیادە: لە بەشداری ژمارە ${n} لە هەمان مانگدا، تێچوویەکی زیادەی ${fee} دیناری عێراقی وەردەگیرێت.`,
    kmr: (n, fee) => `Xerca zêde: ji abonetiya ${n}emîn di heman mehê de, xerceke zêde ya ${fee} dînarê Iraqî tê standin.`,
  },
  conflicts: {
    en: (names) => `Conflicts: cannot be combined with ${names}.`,
    ar: (names) => `التعارض: لا يمكن الجمع بينه وبين ${names}.`,
    ckb: (names) => `ناکۆکی: ناتوانرێت لەگەڵ ${names} کۆبکرێتەوە.`,
    kmr: (names) => `Nakokî: bi ${names} re nayê berhevkirin.`,
  },
};

function ordinalEn(n) {
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function headerFor(entity, lang) {
  const name = entity.names?.[lang] ?? entity.names?.en ?? entity.entity_id;
  const label = SUBTYPE_LABELS[entity.subtype] ?? TYPE_LABELS[entity.type] ?? entity.type;
  const aliases = entity.aliases?.length ? ` · aliases: ${entity.aliases.join(', ')}` : '';
  return `[${name} · ${label}${aliases}]`;
}

function labelList(codes, vocabGroup, lang) {
  if (!codes?.length) return null;
  return codes.map((c) => vocabGroup?.[c]?.labels?.[lang] ?? vocabGroup?.[c]?.labels?.en ?? c).join(', ');
}

// Filterable/groundable payload shared by every chunk of the entity (docs/05 §4)
function basePayload(entity) {
  const p = {
    entity_id: entity.entity_id,
    type: entity.type,
    subtype: entity.subtype ?? null,
    status: entity.status,
    version: entity.version,
    updated_at: entity.updated_at,
  };
  const passthrough = [
    'bundleId', 'offerId', 'price_iqd', 'validity_days', 'data_mb',
    'minutes_onnet', 'minutes_offnet', 'sms_onnet', 'sms_offnet',
    'repeat_purchase_fee_iqd', 'repeat_purchase_threshold',
    'eligible_locations', 'eligible_service_classes',
    'belongs_to_service', 'conflicts_with', 'offers', 'target_flow',
  ];
  for (const k of passthrough) if (entity[k] != null) p[k] = entity[k];
  if (entity.valid_from) p.valid_from = `${entity.valid_from}T00:00:00Z`;
  if (entity.valid_to) p.valid_to = `${entity.valid_to}T23:59:59Z`;
  return p;
}

/**
 * @param {object} entity canonical entity (docs/25 field set)
 * @param {object} opts { vocab, nameOf } — nameOf(entityId, lang) resolves related-entity names
 * @returns {{chunkKey:string, section:string, language:string, text:string, payload:object}[]}
 */
export function entityToChunks(entity, { vocab = {}, nameOf = (id) => id } = {}) {
  const chunks = [];
  const base = basePayload(entity);
  const langs = LANGS.filter(
    (l) => entity.names?.[l] || entity.description?.[l] || entity.examples?.[l],
  );

  const push = (section, language, body) => {
    if (!body) return;
    const text = entity.type === 'intent' ? body : `${headerFor(entity, language)} ${body}`;
    chunks.push({
      chunkKey: `${entity.entity_id}::${section}::${language}`,
      section,
      language,
      text,
      payload: { ...base, section, language, text, chunk_id: `${entity.entity_id}::${section}::${language}` },
    });
  };

  if (entity.type === 'intent') {
    // Routing examples embed as raw utterances — no contextual header, so stored
    // examples live in the same vector space as incoming customer messages.
    for (const lang of langs) {
      const examples = [].concat(entity.examples?.[lang] ?? []);
      examples.forEach((utterance, i) => push(`example_${i + 1}`, lang, utterance));
    }
    return chunks;
  }

  const hasEligibility =
    entity.eligible_locations?.length || entity.eligible_service_classes?.length ||
    entity.valid_from || entity.valid_to;
  const hasFees = entity.repeat_purchase_fee_iqd != null && entity.repeat_purchase_threshold != null;

  for (const lang of langs) {
    const sectionName = entity.type === 'terminology' ? 'definition' : 'overview';
    push(sectionName, lang, entity.description?.[lang]);
    push('subscribe', lang, entity.how_to?.subscribe?.[lang]);
    push('unsubscribe', lang, entity.how_to?.unsubscribe?.[lang]);

    if (hasEligibility) {
      push('eligibility', lang, T.eligibility[lang]({
        classes: labelList(entity.eligible_service_classes, vocab.service_classes, lang),
        locations: labelList(entity.eligible_locations, vocab.locations, lang),
        window: entity.valid_from || entity.valid_to
          ? T.window[lang](entity.valid_from, entity.valid_to)
          : null,
      }));
    }
    if (hasFees) {
      push('fees_edgecases', lang, T.fees[lang](
        entity.repeat_purchase_threshold,
        entity.repeat_purchase_fee_iqd.toLocaleString('en-US'),
      ));
    }
    if (entity.conflicts_with?.length) {
      push('conflicts', lang, T.conflicts[lang](
        entity.conflicts_with.map((id) => nameOf(id, lang)).join(', '),
      ));
    }
  }
  return chunks;
}
