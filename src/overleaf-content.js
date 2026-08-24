'use strict';

const isOverleafProject = () => /(^|\.)overleaf\.com$/i.test(location.hostname)
  && /\/project\/[^/]+/i.test(location.pathname);

const projectBaseUrl = () => {
  const match = location.pathname.match(/^(.*\/project\/[^/?#]+)/i);
  return match ? `${location.origin}${match[1]}` : location.origin;
};

const fileIdFromItem = item => {
  const toggle = item.querySelector('.entity-menu-toggle, [id*="entity-menu"], [data-file-id]');
  const candidates = [
    item.getAttribute('data-file-id'),
    item.getAttribute('data-id'),
    toggle?.getAttribute('data-file-id'),
    toggle?.getAttribute('data-id'),
    toggle?.id
  ].filter(Boolean);
  for (const candidate of candidates) {
    const match = String(candidate).match(/(?:entity-menu-toggle-|file-|menu-)?([a-f0-9]{8,}|[0-9]{3,})$/i);
    if (match) return match[1];
  }
  return '';
};

const listBibFiles = () => {
  const selectors = [
    '.file-tree-list li[aria-label]',
    '[role="tree"] [role="treeitem"][aria-label]',
    '.file-tree-list [data-path]'
  ];
  const items = selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)));
  const seen = new Set();
  return items.map(item => {
    const name = item.getAttribute('aria-label') || item.getAttribute('data-path') || '';
    const cleanName = name.split('/').pop().trim();
    if (!/\.bib$/i.test(cleanName) || seen.has(cleanName)) return null;
    seen.add(cleanName);
    return { name: cleanName, id: fileIdFromItem(item) };
  }).filter(file => file && file.id);
};

const fetchBibFile = async fileId => {
  if (!fileId) throw new Error('The selected BibTeX file has no Overleaf file id.');
  const response = await fetch(`${projectBaseUrl()}/doc/${encodeURIComponent(fileId)}/download`, {
    credentials: 'include',
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Overleaf returned HTTP ${response.status}.`);
  return response.text();
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !String(message.type || '').startsWith('OVERLEAF_')) return undefined;
  if (!isOverleafProject()) {
    sendResponse({ success: false, error: 'The active tab is not an Overleaf project.' });
    return false;
  }

  if (message.type === 'OVERLEAF_CONTEXT') {
    sendResponse({ success: true, project: true, url: location.href, files: listBibFiles() });
    return false;
  }
  if (message.type === 'OVERLEAF_LIST_BIB_FILES') {
    sendResponse({ success: true, files: listBibFiles() });
    return false;
  }
  if (message.type === 'OVERLEAF_FETCH_BIB') {
    fetchBibFile(message.fileId)
      .then(text => sendResponse({ success: true, text }))
      .catch(error => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  }
  sendResponse({ success: false, error: `Unsupported Overleaf message: ${message.type}` });
  return false;
});
