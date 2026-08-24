'use strict';

// Browser-compatible equivalent of WOS Aide's wos-cli TXT normalizer.
const TAG_KEYS = {
  PT:'publication_type', AU:'authors', AF:'author_full_names', TI:'title', SO:'source_title', LA:'language', DT:'document_type',
  DE:'author_keywords', ID:'keywords_plus', AB:'abstract', C1:'author_addresses', C3:'organizations', RP:'corresponding_address',
  EM:'emails', RI:'researcher_id', OI:'orcid', FU:'funding_agency_grant', FX:'funding_text', NR:'cited_reference_count',
  TC:'times_cited_wos', Z9:'times_cited_all_databases', U1:'usage_count_180_days', U2:'usage_count_since_2013', PU:'publisher',
  PI:'publisher_city', PA:'publisher_address', SN:'issn', EI:'eissn', J9:'source_abbrev_29', JI:'source_abbrev_iso',
  PD:'publication_month_or_season', PY:'publication_year', VL:'volume', IS:'issue', SI:'special_issue', BP:'begin_page', EP:'end_page',
  PG:'page_count', DI:'doi', EA:'early_access_date', WC:'wos_categories', WE:'wos_indexes', SC:'research_areas', GA:'document_delivery_number',
  UT:'wos_id', OA:'open_access', DA:'export_date', BA:'book_authors', BF:'book_author_full_names', CA:'group_authors', GP:'book_group_authors',
  BE:'editors', SE:'book_series', CT:'conference_title', CY:'conference_date', CL:'conference_location', CR:'cited_references'
};

const decodeEntities = value => String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (m, entity) => {
  const e = entity.toLowerCase();
  if (e === 'amp') return '&'; if (e === 'apos') return "'"; if (e === 'gt') return '>'; if (e === 'lt') return '<'; if (e === 'nbsp') return ' '; if (e === 'quot') return '"';
  const n = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
});
const normalizeText = value => decodeEntities(value).replace(/<\/?(?:b|i|u|ovl|sup|sub|scp|tt)(?:\s[^<>]*?)?>/gi, '').replace(/\s+/g, ' ').trim();
const listTags = new Set(['AU','AF','EM','RI','OI','DE','ID','SC','WC','WE','CR']);
const normalizeDoi = value => String(value || '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();

function parseWosTxt(text = '') {
  const records = []; let current = null; let tag = null;
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (/^EF\b/.test(raw)) break;
    if (/^ER\b/.test(raw)) { if (current) records.push(current); current = null; tag = null; continue; }
    const match = raw.match(/^([A-Z0-9]{2})\s+(.*)$/);
    if (match) { tag = match[1]; if (tag === 'FN' || tag === 'VR') { tag = null; continue; } current ||= {}; current[tag] ||= []; current[tag].push(decodeEntities(match[2].trim())); continue; }
    if (current && tag && /^\s+/.test(raw)) current[tag].push(decodeEntities(raw.trim()));
  }
  if (current) records.push(current);
  return records;
}

function normalizeRecord(record = {}) {
  const out = {};
  Object.entries(record).forEach(([tag, values]) => {
    const valuesList = (Array.isArray(values) ? values : [values]).filter(Boolean);
    if (!valuesList.length) return;
    const merged = normalizeText(valuesList.join(' '));
    if (tag === 'C1') {
      const addresses = []; const re = /\[([^\]]+)\]\s*([^[]+)/g; let match;
      while ((match = re.exec(merged)) !== null) addresses.push({ author: match[1].trim(), address: match[2].trim() });
      out[TAG_KEYS[tag] || tag] = addresses.length ? addresses : merged;
    } else if (listTags.has(tag)) out[TAG_KEYS[tag] || tag] = merged.split(/\s*;\s*/).filter(Boolean);
    else out[TAG_KEYS[tag] || tag] = merged;
  });
  return out;
}

function toStandardJson(text = '') {
  return parseWosTxt(text).map(record => {
    const ut = Array.isArray(record.UT) ? record.UT[0] : record.UT;
    const rawDoi = Array.isArray(record.DI) ? record.DI[0] : record.DI;
    const all = Object.values(record).flat().join(' ');
    const doi = normalizeDoi(rawDoi) || (all.match(/\b10\.\d{4,9}\/[^\s"'<>]+/i)?.[0] || '');
    const wosId = String(ut || '').replace(/^WOS:/i, '').trim();
    return { meta_info: { doi, No: null }, wos_id: wosId, wos_data: normalizeRecord(record) };
  });
}

if (typeof module !== 'undefined') module.exports = { parseWosTxt, toStandardJson };
