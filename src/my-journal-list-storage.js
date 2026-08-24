'use strict';

const { createDefaultJournalList } = require('./my-journal-lists');

const DATABASE_NAME = 'wos-aide-my-journal-lists';
const DATABASE_VERSION = 1;
const LIST_STORE = 'lists';
const PREFERENCE_STORE = 'preferences';
const SELECTED_LIST_KEY = 'selected-list-id';
const CURRENT_TAB_KEY = 'open-wos-in-current-tab';
const DEFAULTS_INITIALIZED_KEY = 'defaults-initialized';

const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Journal-list database request failed.'));
});

const transactionDone = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onerror = () => reject(transaction.error || new Error('Journal-list transaction failed.'));
  transaction.onabort = () => reject(transaction.error || new Error('Journal-list transaction was aborted.'));
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LIST_STORE)) {
        database.createObjectStore(LIST_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(PREFERENCE_STORE)) {
        database.createObjectStore(PREFERENCE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open the journal-list database.'));
  });
}

async function loadJournalListState() {
  const database = await openDatabase();
  try {
    let lists = await requestResult(database.transaction(LIST_STORE, 'readonly').objectStore(LIST_STORE).getAll());
    const preferences = database.transaction(PREFERENCE_STORE, 'readonly').objectStore(PREFERENCE_STORE);
    let [selectedListId, openInCurrentTab, defaultsInitialized] = await Promise.all([
      requestResult(preferences.get(SELECTED_LIST_KEY)),
      requestResult(preferences.get(CURRENT_TAB_KEY)),
      requestResult(preferences.get(DEFAULTS_INITIALIZED_KEY))
    ]);
    if (defaultsInitialized !== true) {
      const transaction = database.transaction([LIST_STORE, PREFERENCE_STORE], 'readwrite');
      if (!lists.length) {
        const defaultList = createDefaultJournalList();
        transaction.objectStore(LIST_STORE).put(defaultList);
        transaction.objectStore(PREFERENCE_STORE).put(defaultList.id, SELECTED_LIST_KEY);
        lists = [defaultList];
        selectedListId = defaultList.id;
      }
      transaction.objectStore(PREFERENCE_STORE).put(true, DEFAULTS_INITIALIZED_KEY);
      await transactionDone(transaction);
      defaultsInitialized = true;
    }
    const selectedExists = lists.some(list => list.id === selectedListId);
    return {
      lists: lists.slice().sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0)),
      selectedListId: selectedExists ? selectedListId : (lists[0]?.id || ''),
      openInCurrentTab: openInCurrentTab === true
    };
  } finally {
    database.close();
  }
}

async function saveJournalList(list) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(LIST_STORE, 'readwrite');
    transaction.objectStore(LIST_STORE).put(list);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function deleteJournalList(id) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(LIST_STORE, 'readwrite');
    transaction.objectStore(LIST_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function savePreference(key, value) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PREFERENCE_STORE, 'readwrite');
    transaction.objectStore(PREFERENCE_STORE).put(value, key);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

const saveSelectedJournalListId = id => savePreference(SELECTED_LIST_KEY, id);
const saveOpenWosInCurrentTab = value => savePreference(CURRENT_TAB_KEY, Boolean(value));

module.exports = {
  loadJournalListState,
  saveJournalList,
  deleteJournalList,
  saveSelectedJournalListId,
  saveOpenWosInCurrentTab
};
