'use strict';

const { read_bib } = require('./tex-bib-engine');

const TIKZ_STORAGE_KEY = 'overleafTexAideTikzData';

const byId = id => document.getElementById(id);
const setStatus = (id, text, variant = 'muted') => {
  const element = byId(id);
  if (!element) return;
  element.textContent = text || '';
  element.className = `helper status--${variant}`;
};

const copyText = async (value, statusId, message = '已复制到剪贴板。') => {
  const text = String(value || '');
  if (!text) {
    setStatus(statusId, '没有可复制的内容。', 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus(statusId, message, 'success');
  } catch (error) {
    setStatus(statusId, `复制失败：${error?.message || error}`, 'error');
  }
};

const activeTab = () => new Promise(resolve => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs?.[0] || null));
});

const sendOverleafMessage = async message => {
  const tab = await activeTab();
  if (!tab?.id) throw new Error('没有找到当前浏览器标签页。');
  const send = () => new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response || {});
    });
  });
  try {
    return await send();
  } catch (error) {
    if (!/Receiving end does not exist/i.test(error.message || '')) throw error;
    await new Promise((resolve, reject) => {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['overleaf-content.js'] }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
    return send();
  }
};

const convertToTraditional = text => typeof globalThis.cn2hk === 'function' ? globalThis.cn2hk(text) : text;
const convertToSimplified = text => typeof globalThis.hk2cn === 'function' ? globalThis.hk2cn(text) : text;

const colorSortKey = value => {
  const match = String(value || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const channels = [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const max = Math.max(...channels); const min = Math.min(...channels); const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === channels[0]) hue = ((channels[1] - channels[2]) / delta) % 6;
    else if (max === channels[1]) hue = (channels[2] - channels[0]) / delta + 2;
    else hue = (channels[0] - channels[1]) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return [hue, lightness, saturation];
};

const initializeS2t = () => {
  const simplified = byId('texSimplifiedInput');
  const traditional = byId('texTraditionalOutput');
  if (!simplified || !traditional) return;
  const syncFromSimplified = () => { traditional.value = convertToTraditional(simplified.value); };
  const syncFromTraditional = () => { simplified.value = convertToSimplified(traditional.value); };
  simplified.addEventListener('input', syncFromSimplified);
  traditional.addEventListener('input', syncFromTraditional);
  byId('texClipboardCnToTw')?.addEventListener('click', () => {
    syncFromSimplified();
    setStatus('texS2tStatus', '已将上方简体转换为下方繁体。', 'success');
  });
  byId('texClipboardTwToCn')?.addEventListener('click', () => {
    syncFromTraditional();
    setStatus('texS2tStatus', '已将下方繁体转换为上方简体。', 'success');
  });
  byId('texCopySimplified')?.addEventListener('click', () => copyText(simplified.value, 'texS2tStatus', '简体内容已复制。'));
  byId('texCopyTraditional')?.addEventListener('click', () => copyText(traditional.value, 'texS2tStatus', '繁体内容已复制。'));
  byId('texClearS2t')?.addEventListener('click', () => { simplified.value = ''; traditional.value = ''; setStatus('texS2tStatus', '已清空。'); });
};

const initializeBib = () => {
  const input = byId('texBibInput');
  const output = byId('texBblOutput');
  const citekeys = byId('texCitekeys');
  const select = byId('texBibFileSelect');
  if (!input || !output || !citekeys) return;

  let lastReader = null;
  const process = (rename = false) => {
    const text = input.value.trim();
    if (!text) { output.value = ''; citekeys.value = ''; setStatus('texBibStatus', '请输入 BibTeX 内容。'); return; }
    if (!/@[A-Za-z]+\s*\{/m.test(text)) { setStatus('texBibStatus', 'BibTeX 内容格式不完整。', 'error'); return; }
    try {
      const bib = new read_bib(text);
      bib.recitekey = rename ? 1 : 0;
      input.value = bib.to_bib;
      output.value = bib.to_bbl;
      citekeys.value = bib.citekeys;
      setStatus('texBibStatus', `已处理 ${bib.citekey_list.length} 条文献。`, 'success');
    } catch (error) {
      setStatus('texBibStatus', `BibTeX 处理失败：${error?.message || error}`, 'error');
    }
  };
  const renderFiles = files => {
    select.replaceChildren(new Option('选择当前项目的 Bib 文件', ''));
    (files || []).forEach(file => select.appendChild(new Option(file.name, file.id)));
    setStatus('texBibStatus', files?.length ? `发现 ${files.length} 个 Bib 文件。` : '当前页面没有发现 Bib 文件。', files?.length ? 'success' : 'info');
  };
  const refreshFiles = async () => {
    try {
      const response = await sendOverleafMessage({ type: 'OVERLEAF_LIST_BIB_FILES' });
      if (!response.success) throw new Error(response.error || 'Overleaf bridge unavailable.');
      renderFiles(response.files);
      setStatus('texContextStatus', '已连接当前 Overleaf 项目。', 'success');
    } catch (error) {
      renderFiles([]);
      setStatus('texContextStatus', error?.message || String(error), 'error');
      setStatus('texBibStatus', '请打开 Overleaf 项目后重试。', 'info');
    }
  };
  const loadFile = async () => {
    if (!select.value) return;
    try {
      const response = await sendOverleafMessage({ type: 'OVERLEAF_FETCH_BIB', fileId: select.value });
      if (!response.success) throw new Error(response.error || 'Bib 文件读取失败。');
      input.value = response.text || '';
      process();
    } catch (error) { setStatus('texBibStatus', error?.message || String(error), 'error'); }
  };
  input.addEventListener('input', () => process());
  byId('texRenameCitekeys')?.addEventListener('click', () => process(true));
  byId('texRefreshBibFiles')?.addEventListener('click', refreshFiles);
  byId('texLoadBibFile')?.addEventListener('click', loadFile);
  byId('texCopyBib')?.addEventListener('click', () => copyText(input.value, 'texBibStatus', 'BibTeX 已复制。'));
  byId('texCopyBbl')?.addEventListener('click', () => copyText(output.value, 'texBibStatus', 'BBL 已复制。'));
  byId('texCopyCitekeys')?.addEventListener('click', () => copyText(citekeys.value, 'texBibStatus', 'citekeys 已复制。'));
  byId('texClearBib')?.addEventListener('click', () => { input.value = ''; output.value = ''; citekeys.value = ''; setStatus('texBibStatus', '已清空。'); });
  lastReader = refreshFiles;
  window.addEventListener('wos-aide:tex-tab-activated', () => { void lastReader(); });
};

const normalizeTikzItems = value => (Array.isArray(value) ? value : []).map((item, index) => ({
  id: Number.isFinite(Number(item?.id)) ? Number(item.id) : index,
  themes: item?.themes || '',
  categorys: item?.categorys || '',
  tag: item?.tag || `snippet-${index + 1}`,
  example: item?.example || '',
  macro: item?.macro || ''
}));

const initializeTikz = () => {
  const tags = byId('texTikzTags');
  if (!tags) return;
  let items = normalizeTikzItems(globalThis.tikzPGFjson);
  let selected = -1;
  const fields = {
    tag: byId('texTikzTag'), theme: byId('texTikzTheme'), category: byId('texTikzCategory'),
    example: byId('texTikzExample'), macro: byId('texTikzMacro')
  };
  const storageGet = keys => new Promise(resolve => chrome.storage.local.get(keys, result => resolve(result || {})));
  const storageSet = values => new Promise(resolve => chrome.storage.local.set(values, resolve));
  const values = value => Array.isArray(value) ? value : [value];
  const textFor = item => [item.tag, item.themes, item.categorys, item.example, item.macro].flatMap(values).join(' ');
  const splitValues = value => Array.isArray(value) ? value : String(value || '').split('|').map(part => part.trim()).filter(Boolean);
  const renderFilters = () => {
    const themeSelect = byId('texTikzThemeFilter');
    const categorySelect = byId('texTikzCategoryFilter');
    const currentTheme = themeSelect.value;
    const currentCategory = categorySelect.value;
    const themes = [...new Set(items.flatMap(item => splitValues(item.themes)))].sort();
    const categories = [...new Set(items.flatMap(item => splitValues(item.categorys)))].sort();
    themeSelect.replaceChildren(new Option('全部主题', ''));
    categorySelect.replaceChildren(new Option('全部分类', ''));
    themes.forEach(value => themeSelect.appendChild(new Option(value, value)));
    categories.forEach(value => categorySelect.appendChild(new Option(value, value)));
    themeSelect.value = themes.includes(currentTheme) ? currentTheme : '';
    categorySelect.value = categories.includes(currentCategory) ? currentCategory : '';
  };
  const fillEditor = item => {
    selected = items.indexOf(item);
    fields.tag.value = item.tag; fields.theme.value = splitValues(item.themes).join(' | '); fields.category.value = splitValues(item.categorys).join(' | '); fields.example.value = item.example; fields.macro.value = item.macro;
  };
  const render = () => {
    renderFilters();
    const query = byId('texTikzSearch').value.trim().toLowerCase();
    const theme = byId('texTikzThemeFilter').value;
    const category = byId('texTikzCategoryFilter').value;
    tags.replaceChildren();
    items.filter(item => (!query || textFor(item).toLowerCase().includes(query)) && (!theme || splitValues(item.themes).includes(theme)) && (!category || splitValues(item.categorys).includes(category))).forEach(item => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'tex-tikz-tag'; button.textContent = item.tag; button.title = item.macro;
      button.classList.toggle('is-active', items.indexOf(item) === selected);
      button.addEventListener('click', () => { fillEditor(item); render(); });
      tags.appendChild(button);
    });
    if (!tags.childElementCount) tags.textContent = '没有匹配的宏命令。';
  };
  const save = async () => {
    const value = { tag: fields.tag.value.trim(), themes: fields.theme.value.split('|').map(v => v.trim()).filter(Boolean), categorys: fields.category.value.split('|').map(v => v.trim()).filter(Boolean), example: fields.example.value, macro: fields.macro.value };
    if (!value.tag || !value.macro) { setStatus('texTikzStatus', '标签和宏命令不能为空。', 'error'); return; }
    if (selected < 0) { value.id = items.length ? Math.max(...items.map(item => item.id)) + 1 : 0; items.push(value); selected = items.length - 1; }
    else items[selected] = { ...items[selected], ...value };
    await storageSet({ [TIKZ_STORAGE_KEY]: items });
    render(); setStatus('texTikzStatus', '宏命令已保存。', 'success');
  };
  storageGet([TIKZ_STORAGE_KEY]).then(result => { if (Array.isArray(result[TIKZ_STORAGE_KEY])) items = normalizeTikzItems(result[TIKZ_STORAGE_KEY]); render(); });
  byId('texTikzSearch').addEventListener('input', render);
  byId('texTikzThemeFilter').addEventListener('change', render);
  byId('texTikzCategoryFilter').addEventListener('change', render);
  byId('texTikzNew').addEventListener('click', () => { selected = -1; Object.values(fields).forEach(field => { field.value = ''; }); setStatus('texTikzStatus', '请输入新宏命令并保存。'); });
  byId('texTikzSave').addEventListener('click', () => { void save(); });
  byId('texTikzDelete').addEventListener('click', async () => { if (selected < 0) return; items.splice(selected, 1); selected = -1; await storageSet({ [TIKZ_STORAGE_KEY]: items }); render(); setStatus('texTikzStatus', '宏命令已删除。', 'success'); });
  byId('texTikzCopy').addEventListener('click', () => copyText(fields.macro.value, 'texTikzStatus', '宏命令已复制。'));
  byId('texTikzExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'tikzPGF.json'; link.click(); URL.revokeObjectURL(url);
  });
  render();
};

const initializeColors = () => {
  const groups = byId('texColorGroups');
  const info = byId('texColorInfo');
  if (!groups) return;
  const describeColor = (name, value) => {
    const match = String(value || '').trim().match(/^#([0-9a-f]{6})$/i);
    if (!match) return `${name} · ${value}`;
    const rgb = [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16));
    return `${name} · ${value.toUpperCase()} · RGB(${rgb.join(', ')})`;
  };
  const showColorInfo = (name, value) => {
    if (info) info.textContent = describeColor(name, value);
  };
  fetch('tex/colorlib-data.json').then(response => response.json()).then(data => {
    Object.entries(data || {}).forEach(([name, palette]) => {
      const section = document.createElement('section'); section.className = 'tex-color-group'; section.setAttribute('role', 'listitem');
      const heading = document.createElement('button'); heading.type = 'button'; heading.className = 'tex-color-heading'; heading.innerHTML = `<span>${name}</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>`;
      const body = document.createElement('div'); body.className = 'tex-color-grid';
      Object.entries(palette || {}).sort(([, first], [, second]) => {
        const a = colorSortKey(first); const b = colorSortKey(second);
        return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
      }).forEach(([colorName, value]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tex-color-swatch';
        button.title = `${colorName} ${value}`;
        button.setAttribute('aria-label', `${colorName} ${value}`);
        button.style.setProperty('--swatch', value);
        button.addEventListener('mouseenter', () => showColorInfo(colorName, value));
        button.addEventListener('focus', () => showColorInfo(colorName, value));
        button.addEventListener('click', () => copyText(colorName, 'texColorStatus', `${colorName} 已复制。`)); body.appendChild(button);
      });
      heading.addEventListener('click', () => { body.hidden = !body.hidden; heading.classList.toggle('is-collapsed', body.hidden); });
      section.append(heading, body); groups.appendChild(section);
    });
  }).catch(error => setStatus('texColorStatus', `颜色库加载失败：${error?.message || error}`, 'error'));
};

const initializeTexPanel = () => {
  if (!byId('texS2tPanel') && !byId('texBibPanel') && !byId('texTikzPanel') && !byId('texColorPanel')) return;
  initializeS2t(); initializeBib(); initializeTikz(); initializeColors();
  ['tabTexS2t', 'tabTexBib', 'tabTexTikz', 'tabTexColor'].forEach(tabId => {
    byId(tabId)?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('wos-aide:tex-tab-activated')));
  });
};

module.exports = { initializeTexPanel };
