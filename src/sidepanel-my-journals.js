'use strict';

const {
  MAX_LIST_BYTES,
  parseManualJournalTitles,
  parseJournalListCsv,
  createJournalList,
  buildWosJournalSearchUrl
} = require('./my-journal-lists');
const {
  loadJournalListState,
  saveJournalList,
  deleteJournalList,
  saveSelectedJournalListId,
  saveOpenWosInCurrentTab
} = require('./my-journal-list-storage');
const { message } = require('./i18n');

const PAGE_SIZE = 200;
const EASYSCHOLAR_API_KEY = 'wos-easyscholar-api-key';
const EASYSCHOLAR_VERIFIED_KEY = 'wos-easyscholar-api-key-verified';

const currentLanguage = () => document.documentElement.lang === 'en' ? 'en' : 'zh';
const listMessage = key => message(currentLanguage(), `myJournals.${key}`);
const replaceTokens = (value, tokens) => Object.entries(tokens).reduce(
  (result, [key, replacement]) => result.replace(`{${key}}`, replacement),
  value
);

const queryActiveTab = () => new Promise(resolve => {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0] || null));
});

const createTab = url => new Promise((resolve, reject) => {
  chrome.tabs.create({ url, active: true }, tab => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(tab);
  });
});

const updateTab = (tabId, url) => new Promise((resolve, reject) => {
  chrome.tabs.update(tabId, { url, active: true }, tab => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else resolve(tab);
  });
});

const getStorage = keys => new Promise(resolve => {
  chrome.storage.local.get(keys, result => resolve(result || {}));
});

function initializeMyJournalLists() {
  const elements = {
    tabs: document.getElementById('myJournalListTabs'),
    listSubTab: document.getElementById('myJournalsListSubTab'),
    editorSubTab: document.getElementById('myJournalsEditorSubTab'),
    editorSubTabLabel: document.getElementById('myJournalsEditorSubTabLabel'),
    listSubPanel: document.getElementById('myJournalsListSubPanel'),
    editorSubPanel: document.getElementById('myJournalsEditorSubPanel'),
    openCurrent: document.getElementById('myJournalsOpenCurrentTab'),
    openModeLabel: document.getElementById('myJournalsOpenModeLabel'),
    currentName: document.getElementById('myJournalsCurrentName'),
    currentCount: document.getElementById('myJournalsCurrentCount'),
    edit: document.getElementById('myJournalsEditBtn'),
    duplicate: document.getElementById('myJournalsDuplicateBtn'),
    delete: document.getElementById('myJournalsDeleteBtn'),
    sort: document.getElementById('myJournalsSortBtn'),
    rows: document.getElementById('myJournalsRows'),
    empty: document.getElementById('myJournalsEmpty'),
    status: document.getElementById('myJournalsStatus'),
    csvInput: document.getElementById('myJournalsCsvInput'),
    form: document.getElementById('myJournalsEditorForm'),
    dialogTitle: document.getElementById('myJournalsDialogTitle'),
    close: document.getElementById('myJournalsDialogCloseBtn'),
    cancel: document.getElementById('myJournalsCancelBtn'),
    nameInput: document.getElementById('myJournalsNameInput'),
    titlesInput: document.getElementById('myJournalsTitlesInput'),
    import: document.getElementById('myJournalsImportBtn'),
    pick: document.getElementById('myJournalsPickBtn'),
    pickLabel: document.querySelector('#myJournalsPickBtn [data-i18n="myJournals.autoPick"]'),
    draftCount: document.getElementById('myJournalsDraftCount'),
    editorStatus: document.getElementById('myJournalsEditorStatus')
  };
  if (!elements.tabs || !elements.rows || !elements.sort || !elements.editorSubPanel || !elements.form) return;

  let lists = [];
  let selectedListId = '';
  let editingListId = null;
  let renderLimit = PAGE_SIZE;
  let busy = false;
  let picking = false;
  let pickingTabId = null;
  let pickPollTimer = null;
  let pickPollRunning = false;
  let statusTimer = null;

  const selectedList = () => lists.find(list => list.id === selectedListId) || lists[0] || null;

  const setJournalSubPanel = panelId => {
    const editor = panelId === 'editor';
    [elements.listSubPanel, elements.editorSubPanel].forEach((panel, index) => {
      if (panel) panel.hidden = editor ? index === 0 : index === 1;
    });
    [elements.listSubTab, elements.editorSubTab].forEach((tab, index) => {
      if (!tab) return;
      const active = editor ? index === 1 : index === 0;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
  };

  const setStatus = (text = '', variant = 'muted') => {
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = null;
    elements.status.textContent = text;
    elements.status.className = `helper status--${variant}`;
    if (text && variant === 'success') {
      statusTimer = window.setTimeout(() => {
        elements.status.textContent = '';
        elements.status.className = 'helper status--muted';
        statusTimer = null;
      }, 2500);
    }
  };

  const setEditorStatus = (text = '', variant = 'muted') => {
    elements.editorStatus.textContent = text;
    elements.editorStatus.className = `helper status--${variant}`;
  };

  const localizedError = error => {
    const keys = {
      'file-too-large': 'fileTooLarge',
      'too-many-rows': 'tooManyRows',
      'csv-only': 'csvOnly',
      'invalid-utf8': 'invalidUtf8',
      'malformed-csv': 'malformedCsv',
      'missing-title-column': 'missingTitleColumn',
      'empty-list': 'emptyImport'
    };
    const key = keys[error?.code];
    return key ? listMessage(key) : (error?.message || String(error));
  };

  const journalCountText = count => replaceTokens(listMessage('count'), {
    count: Number(count || 0).toLocaleString()
  });

  const updateOpenModeLabel = () => {
    const text = listMessage(elements.openCurrent.checked ? 'openCurrentTab' : 'openNewTab');
    elements.openModeLabel.textContent = text;
    elements.openCurrent.setAttribute('aria-label', text);
  };

  const setBusy = value => {
    busy = value;
    [elements.edit, elements.duplicate, elements.delete, elements.sort, elements.import].forEach(button => {
      if (button) button.disabled = value;
    });
    if (elements.pick) elements.pick.disabled = false;
    elements.form.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = value; });
  };

  const openJournal = async (title, forceNewTab = false) => {
    const url = buildWosJournalSearchUrl(title);
    try {
      if (!forceNewTab && elements.openCurrent.checked) {
        const tab = await queryActiveTab();
        if (tab?.id !== undefined) await updateTab(tab.id, url);
        else await createTab(url);
      } else {
        await createTab(url);
      }
      setStatus(replaceTokens(listMessage('opened'), { journal: title }), 'success');
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    }
  };

  const copyJournal = async title => {
    try {
      await navigator.clipboard.writeText(title);
      setStatus(listMessage('copiedJournal'), 'success');
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    }
  };

  const prepareRatingQuery = async title => {
    const queryInput = document.getElementById('scholarJournalInput');
    const queryStatus = document.getElementById('scholarQueryStatus');
    const scholarParentTab = document.getElementById('tabScholar');
    const queryTab = document.getElementById('scholarQuerySubTab');
    const configTab = document.getElementById('scholarConfigSubTab');
    const apiKeyInput = document.getElementById('easyScholarApiKeyInput');
    const apiKeyTest = document.getElementById('easyScholarApiKeyTestBtn');
    if (queryInput) {
      queryInput.value = title;
      queryInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    scholarParentTab?.click();

    const stored = await getStorage([EASYSCHOLAR_API_KEY, EASYSCHOLAR_VERIFIED_KEY]);
    const hasKey = Boolean(String(stored[EASYSCHOLAR_API_KEY] || '').trim());
    const verified = stored[EASYSCHOLAR_VERIFIED_KEY] === true || stored[EASYSCHOLAR_VERIFIED_KEY] === 'true';
    if (hasKey && verified) {
      queryTab?.click();
      if (queryStatus) {
        queryStatus.textContent = listMessage('ratingPrepared');
        queryStatus.className = 'helper status--success';
      }
      window.setTimeout(() => queryInput?.focus(), 0);
      setStatus(listMessage('ratingPrepared'), 'success');
      return;
    }

    configTab?.click();
    const hint = document.getElementById('easyScholarApiKeyHint');
    if (hint) {
      hint.textContent = listMessage('apiRequired');
      hint.className = 'helper status--error';
    }
    window.setTimeout(() => (hasKey ? apiKeyTest : apiKeyInput)?.focus(), 0);
  };

  const renderTabs = () => {
    elements.tabs.replaceChildren();
    let activeTab = null;
    lists.forEach(list => {
      const button = document.createElement('button');
      const active = list.id === selectedListId;
      button.type = 'button';
      button.className = `my-journal-list-tab${active ? ' is-active' : ''}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(active));
      button.title = list.name;
      button.textContent = list.name;
      button.addEventListener('click', async () => {
        selectedListId = list.id;
        renderLimit = PAGE_SIZE;
        await saveSelectedJournalListId(selectedListId);
        render();
      });
      elements.tabs.appendChild(button);
      if (active) activeTab = button;
    });
    window.setTimeout(() => activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }), 0);
  };

  const renderRows = () => {
    elements.rows.replaceChildren();
    const list = selectedList();
    const direction = list?.sortDirection === 'desc' ? 'desc' : 'asc';
    const collator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });
    const matching = (list?.journals || [])
      .slice()
      .sort((left, right) => {
        const result = collator.compare(left.title, right.title);
        return direction === 'desc' ? -result : result;
      });
    const visible = matching.slice(0, renderLimit);
    elements.empty.hidden = matching.length > 0;
    elements.empty.textContent = listMessage('empty');

    visible.forEach(journal => {
      const row = document.createElement('div');
      row.className = 'my-journal-row';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'my-journal-row__title';
      open.textContent = journal.title;
      open.title = replaceTokens(listMessage('openJournal'), { journal: journal.title });
      open.addEventListener('click', () => { void openJournal(journal.title); });
      const external = document.createElement('button');
      external.type = 'button';
      external.className = 'icon-button my-journal-row__action';
      external.title = listMessage('openNewTab');
      external.setAttribute('aria-label', `${listMessage('openNewTab')}: ${journal.title}`);
      external.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>';
      external.addEventListener('click', () => { void openJournal(journal.title, true); });

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'icon-button my-journal-row__action';
      copy.title = listMessage('copyJournal');
      copy.setAttribute('aria-label', `${copy.title}: ${journal.title}`);
      copy.innerHTML = '<i class="fa-solid fa-copy" aria-hidden="true"></i>';
      copy.addEventListener('click', () => { void copyJournal(journal.title); });

      const rating = document.createElement('button');
      rating.type = 'button';
      rating.className = 'icon-button my-journal-row__action';
      rating.title = listMessage('queryRating');
      rating.setAttribute('aria-label', `${rating.title}: ${journal.title}`);
      rating.innerHTML = '<i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>';
      rating.addEventListener('click', () => {
        void prepareRatingQuery(journal.title).catch(error => {
          setStatus(error?.message || String(error), 'error');
        });
      });

      const actions = document.createElement('div');
      actions.className = 'my-journal-row__actions';
      actions.append(copy, rating, external);
      row.append(open, actions);
      elements.rows.appendChild(row);
    });

    if (visible.length < matching.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'button button--ghost my-journals-more';
      more.textContent = replaceTokens(listMessage('showMore'), {
        remaining: Math.min(PAGE_SIZE, matching.length - visible.length).toLocaleString()
      });
      more.addEventListener('click', () => {
        renderLimit += PAGE_SIZE;
        renderRows();
      });
      elements.rows.appendChild(more);
    }
  };

  const render = () => {
    const list = selectedList();
    if (list && list.id !== selectedListId) selectedListId = list.id;
    renderTabs();
    elements.currentName.textContent = list?.name || listMessage('title');
    elements.currentCount.textContent = journalCountText(list?.journals?.length || 0);
    updateOpenModeLabel();
    const descending = list?.sortDirection === 'desc';
    elements.sort.querySelector('i').className = `fa-solid ${descending ? 'fa-arrow-down-z-a' : 'fa-arrow-down-a-z'}`;
    elements.sort.querySelector('span').textContent = descending ? 'Z–A' : 'A–Z';
    elements.sort.title = listMessage(descending ? 'sortDescending' : 'sortAscending');
    elements.sort.setAttribute('aria-label', elements.sort.title);
    [elements.edit, elements.duplicate, elements.delete, elements.sort].forEach(control => {
      if (control) control.disabled = !list || busy;
    });
    renderRows();
  };

  const updateDraftCount = () => {
    try {
      const journals = parseManualJournalTitles(elements.titlesInput.value);
      elements.draftCount.textContent = journalCountText(journals.length);
      setEditorStatus();
    } catch (error) {
      elements.draftCount.textContent = journalCountText(0);
      setEditorStatus(localizedError(error), 'error');
    }
  };

  const appendPickedJournal = value => {
    const title = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!title) return false;
    const journals = parseManualJournalTitles(elements.titlesInput.value);
    const existing = new Set(journals.map(journal => journal.title.toLocaleLowerCase('en-US')));
    if (existing.has(title.toLocaleLowerCase('en-US'))) return false;
    elements.titlesInput.value = [...journals.map(journal => journal.title), title].join('\n');
    updateDraftCount();
    return true;
  };

  const pollPickedJournals = async () => {
    if (!picking || pickPollRunning || !pickingTabId) return;
    pickPollRunning = true;
    try {
      await new Promise(resolve => {
        chrome.scripting.executeScript({
          target: { tabId: pickingTabId },
          world: 'MAIN',
          func: () => {
            const queue = Array.isArray(window.__WOS_AIDE_JOURNAL_PICK_QUEUE__)
              ? window.__WOS_AIDE_JOURNAL_PICK_QUEUE__.splice(0)
              : [];
            return queue;
          }
        }, result => {
          if (!chrome.runtime.lastError) {
            (result?.[0]?.result || []).forEach(value => {
              if (appendPickedJournal(value)) {
                setEditorStatus(replaceTokens(listMessage('picked'), { count: '1' }), 'success');
              }
            });
          }
          resolve();
        });
      });
    } finally {
      pickPollRunning = false;
    }
  };

  function openEditor(list = null) {
    editingListId = list?.id || null;
    elements.dialogTitle.textContent = list ? listMessage('editList') : listMessage('newList');
    elements.nameInput.value = list?.name || '';
    elements.titlesInput.value = (list?.journals || []).map(journal => journal.title).join('\n');
    setEditorStatus();
    updateDraftCount();
    elements.editorSubTabLabel.textContent = list ? listMessage('editList') : listMessage('newList');
    setJournalSubPanel('editor');
    window.setTimeout(() => elements.nameInput.focus(), 0);
  }

  const closeEditor = () => {
    if (busy) return;
    setJournalSubPanel('list');
    elements.editorSubTabLabel.textContent = listMessage('newList');
    editingListId = null;
    elements.csvInput.value = '';
  };

  const uniqueCopyName = sourceName => {
    const suffix = listMessage('copySuffix');
    const existing = new Set(lists.map(list => list.name.trim().toLocaleLowerCase('en-US')));
    let candidate = `${sourceName} ${suffix}`.trim();
    let number = 2;
    while (existing.has(candidate.toLocaleLowerCase('en-US'))) {
      candidate = `${sourceName} ${suffix} ${number}`.trim();
      number += 1;
    }
    return candidate;
  };

  elements.openCurrent.addEventListener('change', () => {
    updateOpenModeLabel();
    saveOpenWosInCurrentTab(elements.openCurrent.checked).catch(error => {
      setStatus(error?.message || String(error), 'error');
    });
  });
  elements.tabs.addEventListener('wheel', event => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    elements.tabs.scrollLeft += event.deltaY;
    event.preventDefault();
  }, { passive: false });
  elements.sort.addEventListener('click', async () => {
    const list = selectedList();
    if (!list || busy) return;
    const next = { ...list, sortDirection: list.sortDirection === 'desc' ? 'asc' : 'desc' };
    setBusy(true);
    try {
      await saveJournalList(next);
      lists = lists.map(item => item.id === next.id ? next : item);
      renderLimit = PAGE_SIZE;
    } catch (error) {
      setStatus(error?.message || String(error), 'error');
    } finally {
      setBusy(false);
      render();
    }
  });
  elements.edit.addEventListener('click', () => openEditor(selectedList()));
  elements.duplicate.addEventListener('click', async () => {
    const source = selectedList();
    if (!source || busy) return;
    setBusy(true);
    try {
      const duplicate = createJournalList(uniqueCopyName(source.name), source.journals);
      duplicate.sortDirection = source.sortDirection === 'desc' ? 'desc' : 'asc';
      await saveJournalList(duplicate);
      lists.push(duplicate);
      selectedListId = duplicate.id;
      await saveSelectedJournalListId(selectedListId);
      render();
      setStatus(listMessage('duplicated'), 'success');
    } catch (error) {
      setStatus(localizedError(error), 'error');
    } finally {
      setBusy(false);
      render();
    }
  });
  elements.delete.addEventListener('click', async () => {
    const list = selectedList();
    if (!list || busy || !window.confirm(replaceTokens(listMessage('deleteConfirm'), { name: list.name }))) return;
    setBusy(true);
    try {
      await deleteJournalList(list.id);
      const state = await loadJournalListState();
      lists = state.lists;
      selectedListId = state.selectedListId;
      await saveSelectedJournalListId(selectedListId);
      renderLimit = PAGE_SIZE;
      setStatus(listMessage('deleted'), 'success');
    } catch (error) {
      setStatus(localizedError(error), 'error');
    } finally {
      setBusy(false);
      render();
    }
  });
  elements.listSubTab?.addEventListener('click', closeEditor);
  elements.editorSubTab?.addEventListener('click', () => {
    if (elements.editorSubPanel.hidden) openEditor();
  });
  elements.close.addEventListener('click', closeEditor);
  elements.cancel.addEventListener('click', closeEditor);
  elements.titlesInput.addEventListener('input', updateDraftCount);
  elements.import.addEventListener('click', () => elements.csvInput.click());
  elements.pick?.addEventListener('click', async () => {
    if (picking) {
      const tab = await queryActiveTab();
      if (tab?.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => window.dispatchEvent(new CustomEvent('__WOS_AIDE_CANCEL_JOURNAL_PICK__'))
        }, () => {});
      }
      return;
    }
    if (busy) return;
    const tab = await queryActiveTab();
    if (!tab?.id) {
      setEditorStatus(listMessage('picking'), 'error');
      return;
    }
    picking = true;
    pickingTabId = tab.id;
    pickPollTimer = window.setInterval(() => { void pollPickedJournals(); }, 250);
    elements.pickLabel.textContent = listMessage('cancelPick');
    setBusy(true);
    setEditorStatus(listMessage('picking'), 'info');
    try {
      const selected = await new Promise((resolve, reject) => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => new Promise(resolve => {
            const picked = [];
            let highlighted = null;
            const previousOutline = new WeakMap();
            const cleanup = () => {
              document.removeEventListener('mouseover', onMouseOver, true);
              document.removeEventListener('click', onClick, true);
              document.removeEventListener('keydown', onKeyDown, true);
              window.removeEventListener('__WOS_AIDE_CANCEL_JOURNAL_PICK__', onCancel);
              if (highlighted) highlighted.style.outline = previousOutline.get(highlighted) || '';
              window.clearTimeout(timeout);
            };
            const textFor = target => String(target?.closest?.('a, button, [data-ta], span, div')?.textContent || target?.textContent || '')
              .replace(/\s+/g, ' ').trim().slice(0, 300);
            const onMouseOver = event => {
              const target = event.target instanceof HTMLElement ? event.target : null;
              if (!target) return;
              if (highlighted) highlighted.style.outline = previousOutline.get(highlighted) || '';
              highlighted = target;
              previousOutline.set(target, target.style.outline);
              target.style.outline = '2px solid #202123';
            };
            const onClick = event => {
              event.preventDefault();
              event.stopImmediatePropagation();
              const value = textFor(event.target);
              if (value && !picked.some(item => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
                picked.push(value);
                window.__WOS_AIDE_JOURNAL_PICK_QUEUE__ = window.__WOS_AIDE_JOURNAL_PICK_QUEUE__ || [];
                window.__WOS_AIDE_JOURNAL_PICK_QUEUE__.push(value);
                window.postMessage({ type: 'WOS_AIDE_JOURNAL_PICK', value }, '*');
              }
            };
            const onKeyDown = event => {
              if (event.key !== 'Escape') return;
              cleanup();
              resolve(picked);
            };
            const onCancel = () => { cleanup(); resolve(picked); };
            document.addEventListener('mouseover', onMouseOver, true);
            document.addEventListener('click', onClick, true);
            document.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('__WOS_AIDE_CANCEL_JOURNAL_PICK__', onCancel);
            const timeout = window.setTimeout(() => {
              cleanup();
              resolve(picked);
            }, 30000);
          })
        }, result => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result?.[0]?.result || []);
        });
      });
      const additions = (Array.isArray(selected) ? selected : [selected]).filter(value => appendPickedJournal(value)).length;
      setEditorStatus(replaceTokens(listMessage('picked'), { count: String(additions) }), 'success');
    } catch (error) {
      setEditorStatus(error?.message || String(error), 'error');
    } finally {
      if (pickPollTimer) window.clearInterval(pickPollTimer);
      pickPollTimer = null;
      await pollPickedJournals();
      picking = false;
      pickingTabId = null;
      elements.pickLabel.textContent = listMessage('autoPick');
      setBusy(false);
    }
  });
  chrome.runtime.onMessage.addListener((request, sender) => {
    if (!picking || request?.type !== 'WOS_AIDE_JOURNAL_PICK' || sender.tab?.id !== pickingTabId) return;
    if (appendPickedJournal(request.value)) {
      setEditorStatus(replaceTokens(listMessage('picked'), { count: '1' }), 'success');
    }
  });
  elements.csvInput.addEventListener('change', async () => {
    const file = elements.csvInput.files?.[0];
    if (!file) return;
    setBusy(true);
    setEditorStatus(listMessage('importing'), 'info');
    try {
      if (!/\.csv$/i.test(file.name || '')) {
        const error = new Error();
        error.code = 'csv-only';
        throw error;
      }
      if (file.size > MAX_LIST_BYTES) {
        const error = new Error();
        error.code = 'file-too-large';
        throw error;
      }
      let contents;
      try {
        contents = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      } catch (_error) {
        const error = new Error();
        error.code = 'invalid-utf8';
        throw error;
      }
      const journals = parseJournalListCsv(contents);
      elements.titlesInput.value = journals.map(journal => journal.title).join('\n');
      elements.draftCount.textContent = journalCountText(journals.length);
      setEditorStatus(replaceTokens(listMessage('imported'), { count: journals.length.toLocaleString() }), 'success');
    } catch (error) {
      setEditorStatus(localizedError(error), 'error');
    } finally {
      elements.csvInput.value = '';
      setBusy(false);
    }
  });
  elements.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const name = elements.nameInput.value.trim();
    if (!name) {
      setEditorStatus(listMessage('nameRequired'), 'error');
      elements.nameInput.focus();
      return;
    }
    if (lists.some(list => list.id !== editingListId && list.name.trim().toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) {
      setEditorStatus(listMessage('nameDuplicate'), 'error');
      elements.nameInput.focus();
      return;
    }

    setBusy(true);
    try {
      const journals = parseManualJournalTitles(elements.titlesInput.value);
      const existing = lists.find(list => list.id === editingListId);
      const next = existing
        ? { ...existing, name, journals, updatedAt: Date.now() }
        : createJournalList(name, journals);
      await saveJournalList(next);
      if (existing) lists = lists.map(list => list.id === existing.id ? next : list);
      else lists.push(next);
      selectedListId = next.id;
      await saveSelectedJournalListId(selectedListId);
      setJournalSubPanel('list');
      elements.editorSubTabLabel.textContent = listMessage('newList');
      editingListId = null;
      renderLimit = PAGE_SIZE;
      render();
      setStatus(listMessage('saved'), 'success');
    } catch (error) {
      setEditorStatus(localizedError(error), 'error');
    } finally {
      setBusy(false);
      render();
    }
  });

  document.addEventListener('wos-aide:language-changed', () => {
    render();
    if (elements.editorSubPanel && !elements.editorSubPanel.hidden) {
      elements.dialogTitle.textContent = editingListId ? listMessage('editList') : listMessage('newList');
      elements.editorSubTabLabel.textContent = editingListId ? listMessage('editList') : listMessage('newList');
      updateDraftCount();
    }
  });

  loadJournalListState().then(state => {
    lists = state.lists;
    selectedListId = state.selectedListId;
    elements.openCurrent.checked = state.openInCurrentTab;
    render();
    setJournalSubPanel('list');
  }).catch(error => setStatus(error?.message || String(error), 'error'));
}

module.exports = { initializeMyJournalLists };
