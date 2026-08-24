'use strict';

const CROSSREF_CSL_CONVERTER_VERSION = 'crossref-to-csl-v1';

const firstText = value => Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();

const plainText = value => String(value || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim();

const normalizeDoi = value => String(value || '')
  .trim()
  .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
  .replace(/^doi:\s*/i, '')
  .replace(/[.,;]+$/g, '')
  .toLowerCase();

const crossrefYear = item => {
  const candidates = [item?.issued, item?.published, item?.['published-print'], item?.['published-online'], item?.created];
  for (const candidate of candidates) {
    const year = Number(candidate?.['date-parts']?.[0]?.[0] || 0);
    if (year) return year;
  }
  return 0;
};

const normalizeAuthors = authors => (Array.isArray(authors) ? authors : []).map(author => ({
  given: plainText(author?.given),
  family: plainText(author?.family),
  literal: plainText(author?.name || author?.literal),
  suffix: plainText(author?.suffix)
})).filter(author => author.family || author.given || author.literal);

const compactObject = value => Object.fromEntries(Object.entries(value).filter(([, item]) => {
  if (Array.isArray(item)) return item.length > 0;
  if (item && typeof item === 'object') return Object.keys(item).length > 0;
  return item !== '' && item != null;
}));

const stringList = value => (Array.isArray(value) ? value : value ? [value] : [])
  .map(plainText)
  .filter(Boolean);

const crossrefTypeToCsl = type => ({
  'journal-article': 'article-journal',
  'book-chapter': 'chapter',
  'proceedings-article': 'paper-conference',
  'posted-content': 'article',
  'reference-entry': 'entry-encyclopedia',
  dissertation: 'thesis',
  report: 'report'
}[String(type || '').trim().toLowerCase()] || String(type || '').trim() || 'article-journal');

const crossrefDate = (item, fields) => {
  for (const field of fields) {
    const parts = item?.[field]?.['date-parts'];
    if (Array.isArray(parts) && Array.isArray(parts[0]) && parts[0].length) return { 'date-parts': parts };
  }
  return undefined;
};

const crossrefTitle = item => {
  const title = plainText(firstText(item?.title));
  const subtitle = plainText(firstText(item?.subtitle));
  if (!title) return subtitle;
  if (!subtitle || title.toLowerCase().includes(subtitle.toLowerCase())) return title;
  return `${title}: ${subtitle}`;
};

const firstPage = page => plainText(page).match(/\b([A-Za-z]?\d+[A-Za-z]?)\b/)?.[1] || '';

const crossrefItemToCsl = item => {
  const doi = normalizeDoi(item?.DOI);
  const page = plainText(item?.page);
  const csl = {
    id: doi ? `doi:${doi}` : String(item?.URL || crossrefTitle(item) || 'crossref-record'),
    type: crossrefTypeToCsl(item?.type),
    title: crossrefTitle(item),
    'title-short': plainText(firstText(item?.['short-title'])),
    author: normalizeAuthors(item?.author),
    editor: normalizeAuthors(item?.editor),
    translator: normalizeAuthors(item?.translator),
    issued: crossrefDate(item, ['issued', 'published', 'published-print', 'published-online', 'created']),
    submitted: crossrefDate(item, ['submitted']),
    'container-title': plainText(firstText(item?.['container-title'])),
    'container-title-short': plainText(firstText(item?.['short-container-title'])),
    'collection-title': plainText(firstText(item?.['group-title'])),
    volume: plainText(item?.volume),
    issue: plainText(item?.issue),
    page,
    'page-first': firstPage(page),
    number: plainText(item?.['article-number']),
    publisher: plainText(item?.publisher),
    'publisher-place': plainText(item?.['publisher-location']),
    edition: plainText(item?.edition),
    DOI: doi,
    URL: String(item?.URL || (doi ? `https://doi.org/${doi}` : '')).trim(),
    ISSN: stringList(item?.ISSN),
    ISBN: stringList(item?.ISBN),
    abstract: plainText(item?.abstract),
    language: plainText(item?.language),
    keyword: stringList(item?.subject).join(', ')
  };
  return compactObject(csl);
};

const yearFromCsl = csl => Number(csl?.issued?.['date-parts']?.[0]?.[0] || 0);

const recordFromCsl = (cslJson, extras = {}) => {
  const csl = compactObject({ ...(cslJson || {}) });
  const doi = normalizeDoi(csl.DOI || extras.doi);
  const title = plainText(csl.title || extras.title);
  const url = String(csl.URL || extras.url || (doi ? `https://doi.org/${doi}` : '')).trim();
  const id = doi || extras.id || url || `${title.toLowerCase()}-${yearFromCsl(csl)}`;
  return {
    ...extras,
    schemaVersion: 2,
    converterVersion: CROSSREF_CSL_CONVERTER_VERSION,
    id,
    doi,
    title,
    authors: normalizeAuthors(csl.author || extras.authors),
    year: yearFromCsl(csl) || Number(extras.year || 0),
    journal: plainText(csl['container-title'] || extras.journal),
    publisher: plainText(csl.publisher || extras.publisher),
    type: String(extras.type || csl.type || '').trim(),
    volume: plainText(csl.volume || extras.volume),
    issue: plainText(csl.issue || extras.issue),
    pages: plainText(csl.page || csl.number || extras.pages),
    url,
    issn: stringList(csl.ISSN || extras.issn),
    isbn: stringList(csl.ISBN || extras.isbn),
    cslJson: compactObject({
      ...csl,
      id: csl.id || (doi ? `doi:${doi}` : id),
      DOI: doi || csl.DOI,
      URL: url || csl.URL
    })
  };
};

const normalizeCrossrefItem = item => {
  return recordFromCsl(crossrefItemToCsl(item), { type: String(item?.type || '').trim() });
};

const normalizePersistedCrossrefRecord = record => {
  if (!record || typeof record !== 'object') return null;
  if (record.cslJson && typeof record.cslJson === 'object') return recordFromCsl(record.cslJson, record);
  const issued = Number(record.year || 0) ? { 'date-parts': [[Number(record.year)]] } : undefined;
  return recordFromCsl({
    id: record.id,
    type: crossrefTypeToCsl(record.type),
    title: record.title,
    author: normalizeAuthors(record.authors),
    issued,
    'container-title': record.journal,
    publisher: record.publisher,
    volume: record.volume,
    issue: record.issue,
    page: record.pages,
    DOI: record.doi,
    URL: record.url,
    ISSN: stringList(record.issn),
    ISBN: stringList(record.isbn)
  }, record);
};

const bibtexEscape = value => {
  const replacements = {
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    '#': '\\#',
    '$': '\\$',
    '%': '\\%',
    '&': '\\&',
    '_': '\\_',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}'
  };
  return Array.from(plainText(value)).map(character => replacements[character] || character).join('');
};

const slug = value => plainText(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '')
  .toLowerCase();

const shortHash = value => {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 4).padStart(4, '0');
};

const citationKey = record => {
  const firstAuthor = record?.authors?.[0];
  const author = slug(firstAuthor?.family || firstAuthor?.literal || 'anon').slice(0, 18) || 'anon';
  const titleWord = plainText(record?.title).split(/\s+/).map(slug).find(word => word.length > 2) || 'work';
  return `${author}${record?.year || 'nd'}${titleWord.slice(0, 18)}${shortHash(record?.doi || record?.id || record?.title)}`;
};

const bibtexType = type => ({
  'journal-article': 'article',
  'book-chapter': 'incollection',
  'proceedings-article': 'inproceedings',
  book: 'book',
  dissertation: 'phdthesis',
  report: 'techreport'
}[String(type || '').toLowerCase()] || 'misc');

const authorText = authors => (Array.isArray(authors) ? authors : []).map(author => {
  if (author.literal) return bibtexEscape(author.literal);
  const family = bibtexEscape(author.family);
  const given = bibtexEscape(author.given);
  return family && given ? `${family}, ${given}` : family || given;
}).filter(Boolean).join(' and ');

const crossrefRecordToBibtex = record => {
  record = normalizePersistedCrossrefRecord(record) || {};
  const type = bibtexType(record?.type);
  const containerField = type === 'article' ? 'journal' : ['incollection', 'inproceedings'].includes(type) ? 'booktitle' : '';
  const fields = [
    ['title', record?.title],
    ['author', authorText(record?.authors)],
    [containerField, record?.journal],
    ['year', record?.year],
    ['volume', record?.volume],
    ['number', record?.issue],
    ['pages', record?.pages],
    ['publisher', record?.publisher],
    ['doi', record?.doi],
    ['url', record?.url],
    ['issn', record?.issn?.join(', ')],
    ['isbn', record?.isbn?.join(', ')]
  ].filter(([key, value]) => key && String(value || '').trim());
  const lines = fields.map(([key, value]) => `  ${key} = {${key === 'author' ? value : bibtexEscape(value)}}`);
  return `@${type}{${citationKey(record)},\n${lines.join(',\n')}\n}`;
};

const buildBibtex = records => (Array.isArray(records) ? records : [])
  .filter(record => record?.id)
  .map(crossrefRecordToBibtex)
  .join('\n\n');

module.exports = {
  CROSSREF_CSL_CONVERTER_VERSION,
  normalizeDoi,
  crossrefYear,
  crossrefTypeToCsl,
  crossrefItemToCsl,
  recordFromCsl,
  normalizePersistedCrossrefRecord,
  normalizeCrossrefItem,
  bibtexEscape,
  citationKey,
  crossrefRecordToBibtex,
  buildBibtex
};
