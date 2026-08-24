'use strict';

const { Cite, plugins } = require('@citation-js/core');
require('@citation-js/plugin-csl');

const { normalizePersistedCrossrefRecord } = require('./crossref-bib');
const { registerCslLocales } = require('./csl-locales');

const MAX_CSL_STYLE_BYTES = 1024 * 1024;
const BUILTIN_CSL_STYLES = Object.freeze([
  { id: 'apa', label: 'APA 7th edition', source: 'bundled', builtin: true },
  { id: 'vancouver', label: 'Vancouver', source: 'bundled', builtin: true },
  { id: 'harvard1', label: 'Harvard', source: 'bundled', builtin: true }
]);

const cslConfig = () => plugins.config.get('@csl');
registerCslLocales(cslConfig().locales);

const styleFingerprint = value => {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const styleIdFromUrl = value => String(value || '')
  .replace(/[?#].*$/, '')
  .replace(/\/+$/, '')
  .split('/')
  .pop()
  ?.replace(/\.csl$/i, '') || '';

const metadataWithDomParser = xml => {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The downloaded CSL file is not valid XML.');
  const style = document.documentElement;
  if (style?.localName !== 'style') throw new Error('The downloaded file is not a CSL style.');
  const info = Array.from(style.children).find(child => child.localName === 'info');
  const text = name => Array.from(info?.children || []).find(child => child.localName === name)?.textContent?.trim() || '';
  const parentLink = Array.from(info?.children || []).find(child => child.localName === 'link' && child.getAttribute('rel') === 'independent-parent');
  return {
    id: styleIdFromUrl(text('id')),
    label: text('title'),
    parentUrl: parentLink?.getAttribute('href') || '',
    hasBibliography: Array.from(style.children).some(child => child.localName === 'bibliography')
  };
};

const metadataWithoutDomParser = xml => {
  if (!/<style\b/i.test(xml)) throw new Error('The downloaded file is not a CSL style.');
  const info = xml.match(/<info\b[^>]*>([\s\S]*?)<\/info>/i)?.[1] || '';
  const text = name => info.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';
  const parentTag = info.match(/<link\b(?=[^>]*\brel=["']independent-parent["'])[^>]*>/i)?.[0] || '';
  return {
    id: styleIdFromUrl(text('id')),
    label: text('title'),
    parentUrl: parentTag.match(/\bhref=["']([^"']+)["']/i)?.[1] || '',
    hasBibliography: /<bibliography[\s>]/i.test(xml)
  };
};

const parseCslStyleMetadata = value => {
  const xml = String(value || '').trim();
  if (!xml) throw new Error('The CSL style is empty.');
  if (new TextEncoder().encode(xml).length > MAX_CSL_STYLE_BYTES) throw new Error('The CSL style exceeds the 1 MB limit.');
  const metadata = metadataWithDomParser(xml) || metadataWithoutDomParser(xml);
  if (!metadata.hasBibliography && !metadata.parentUrl) throw new Error('The CSL style has no bibliography rules or independent parent.');
  return { ...metadata, xml };
};

const registerStyle = style => {
  const id = String(style?.id || '').trim();
  if (!id) throw new Error('A CSL style id is required.');
  const xml = String(style?.renderXml || style?.xml || '').trim();
  if (!xml) return id;
  const templates = cslConfig().templates;
  const registryId = `wos-aide-${id}-${styleFingerprint(xml)}`;
  if (!templates.has(registryId)) templates.add(registryId, xml);
  return registryId;
};

const cslItemsForRecords = records => (Array.isArray(records) ? records : [])
  .map(normalizePersistedCrossrefRecord)
  .filter(Boolean)
  .map(record => ({
    ...record.cslJson,
    id: record.id,
    DOI: record.doi || record.cslJson?.DOI,
    URL: record.url || record.cslJson?.URL
  }));

const sanitizeCslHtmlWithDom = html => {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  const root = document.body.firstElementChild;
  const allowedTags = new Set(['DIV', 'SPAN', 'I', 'B', 'EM', 'STRONG', 'A', 'SUP', 'SUB', 'BR']);
  const clean = node => {
    for (const child of Array.from(node.children)) {
      if (!allowedTags.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent || ''));
        continue;
      }
      for (const attribute of Array.from(child.attributes)) {
        const allowed = attribute.name === 'class'
          || attribute.name === 'data-csl-entry-id'
          || (child.tagName === 'A' && attribute.name === 'href');
        if (!allowed) child.removeAttribute(attribute.name);
      }
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') || '';
        if (!/^https?:\/\//i.test(href)) child.removeAttribute('href');
      }
      clean(child);
    }
  };
  clean(root);
  return root.innerHTML;
};

const sanitizeCslHtml = value => {
  const html = String(value || '');
  const domResult = sanitizeCslHtmlWithDom(html);
  if (domResult != null) return domResult;
  return html
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '')
    .replace(/\sstyle\s*=\s*(["']).*?\1/gi, '');
};

const renderCslBibliography = (records, style = BUILTIN_CSL_STYLES[0], locale = 'en-US') => {
  const items = cslItemsForRecords(records);
  if (!items.length) return { html: '', text: '', entryCount: 0, styleId: style.id, locale };
  const template = registerStyle(style);
  const cite = new Cite(items);
  const options = { template, lang: locale || 'en-US' };
  const html = sanitizeCslHtml(cite.format('bibliography', { ...options, format: 'html' }));
  const text = String(cite.format('bibliography', { ...options, format: 'text' }) || '').trim();
  return { html, text, entryCount: items.length, styleId: style.id, locale };
};

const wordClipboardFragment = html => {
  const styled = sanitizeCslHtml(html)
    .replace(/class="csl-bib-body"/g, 'class="csl-bib-body" style="font-family: Times New Roman, serif; font-size: 12pt; line-height: 1.35;"')
    .replace(/class="csl-entry"/g, 'class="csl-entry" style="margin: 0 0 6pt 0;"')
    .replace(/class="csl-left-margin"/g, 'class="csl-left-margin" style="display: inline-block; min-width: 28pt; vertical-align: top;"')
    .replace(/class="csl-right-inline"/g, 'class="csl-right-inline" style="display: inline;"');
  return styled;
};

const wordClipboardHtml = html => `<!doctype html><html><head><meta charset="utf-8"></head><body><!--StartFragment-->${wordClipboardFragment(html)}<!--EndFragment--></body></html>`;

module.exports = {
  BUILTIN_CSL_STYLES,
  MAX_CSL_STYLE_BYTES,
  cslItemsForRecords,
  parseCslStyleMetadata,
  renderCslBibliography,
  sanitizeCslHtml,
  styleIdFromUrl,
  wordClipboardFragment,
  wordClipboardHtml
};
