'use strict';

const {
  Document,
  ExternalHyperlink,
  Packer,
  Paragraph,
  TextRun
} = require('docx');

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DEFAULT_TEXT_STYLE = Object.freeze({ font: 'Times New Roman', size: 24 });

const normalizedText = value => String(value || '')
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/ {2,}/g, ' ');

const textRun = (text, style = {}) => new TextRun({
  ...DEFAULT_TEXT_STYLE,
  text,
  bold: Boolean(style.bold),
  italics: Boolean(style.italics),
  superScript: Boolean(style.superScript),
  subScript: Boolean(style.subScript)
});

const childrenForNode = (node, inheritedStyle = {}) => {
  if (node.nodeType === 3) {
    const text = normalizedText(node.nodeValue);
    return text ? [textRun(text, inheritedStyle)] : [];
  }
  if (node.nodeType !== 1) return [];

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return [new TextRun({ ...DEFAULT_TEXT_STYLE, break: 1 })];
  const style = {
    ...inheritedStyle,
    bold: inheritedStyle.bold || tag === 'b' || tag === 'strong',
    italics: inheritedStyle.italics || tag === 'i' || tag === 'em',
    superScript: inheritedStyle.superScript || tag === 'sup',
    subScript: inheritedStyle.subScript || tag === 'sub'
  };
  const children = Array.from(node.childNodes).flatMap(child => childrenForNode(child, style));
  const href = tag === 'a' ? String(node.getAttribute('href') || '') : '';
  if (href && /^https?:\/\//i.test(href) && children.length) {
    return [new ExternalHyperlink({ children, link: href })];
  }
  return children;
};

const referenceHtmlToDocxDocument = html => {
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser is required to export DOCX.');
  const parsed = new DOMParser().parseFromString(`<main>${String(html || '')}</main>`, 'text/html');
  const root = parsed.body.firstElementChild;
  const entries = Array.from(root?.querySelectorAll('.csl-entry') || []);
  if (!entries.length) throw new Error('The reference list is empty.');

  const paragraphs = entries.map(entry => new Paragraph({
    children: childrenForNode(entry),
    spacing: { after: 120, line: 324 }
  }));
  return new Document({
    creator: 'WOS Aide',
    title: 'References',
    sections: [{ children: paragraphs }]
  });
};

const referenceHtmlToDocxBlob = async html => {
  const blob = await Packer.toBlob(referenceHtmlToDocxDocument(html));
  return blob.type === DOCX_MIME_TYPE ? blob : new Blob([blob], { type: DOCX_MIME_TYPE });
};

module.exports = {
  DOCX_MIME_TYPE,
  referenceHtmlToDocxBlob,
  referenceHtmlToDocxDocument
};
