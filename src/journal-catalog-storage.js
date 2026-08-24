'use strict';

const DATABASE_NAME = 'wos-aide-journal-catalog';
const DATABASE_VERSION = 1;
const SOURCE_STORE = 'sources';

const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Journal catalog database request failed.'));
});

const transactionDone = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onerror = () => reject(transaction.error || new Error('Journal catalog transaction failed.'));
  transaction.onabort = () => reject(transaction.error || new Error('Journal catalog transaction was aborted.'));
});

function openJournalCatalogDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SOURCE_STORE)) {
        request.result.createObjectStore(SOURCE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open the journal catalog database.'));
  });
}

async function listJournalSources() {
  const database = await openJournalCatalogDatabase();
  try {
    return await requestResult(database.transaction(SOURCE_STORE, 'readonly').objectStore(SOURCE_STORE).getAll());
  } finally {
    database.close();
  }
}

async function saveJournalSources(sources) {
  const database = await openJournalCatalogDatabase();
  try {
    const transaction = database.transaction(SOURCE_STORE, 'readwrite');
    const store = transaction.objectStore(SOURCE_STORE);
    sources.forEach(source => store.put(source));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function deleteJournalSource(id) {
  const database = await openJournalCatalogDatabase();
  try {
    const transaction = database.transaction(SOURCE_STORE, 'readwrite');
    transaction.objectStore(SOURCE_STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function clearJournalSources() {
  const database = await openJournalCatalogDatabase();
  try {
    const transaction = database.transaction(SOURCE_STORE, 'readwrite');
    transaction.objectStore(SOURCE_STORE).clear();
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

module.exports = {
  listJournalSources,
  saveJournalSources,
  deleteJournalSource,
  clearJournalSources
};
