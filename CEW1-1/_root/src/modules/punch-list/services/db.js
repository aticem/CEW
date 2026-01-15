/**
 * Punch List Database Service
 * Uses IndexedDB for robust storage of punches, history, and contractor configurations.
 */

const DB_NAME = 'cew-punch-list-db';
const DB_VERSION = 2;

const STORES = {
    PUNCHES: 'punches',
    HISTORY: 'history',
    CONTRACTORS: 'contractors',
    DISCIPLINES: 'disciplines',
    PUNCH_LISTS: 'punch_lists',
};

let dbInstance = null;

/**
 * Opens or creates the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
async function openDB() {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            dbInstance = request.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const tx = event.target.transaction;

            // Create object stores if they don't exist
            if (!db.objectStoreNames.contains(STORES.PUNCHES)) {
                const store = db.createObjectStore(STORES.PUNCHES, { keyPath: 'id' });
                store.createIndex('punchListId', 'punchListId', { unique: false });
            } else {
                // Version 2 upgrade: Add punchListId index
                const store = tx.objectStore(STORES.PUNCHES);
                if (!store.indexNames.contains('punchListId')) {
                    store.createIndex('punchListId', 'punchListId', { unique: false });
                }
            }

            if (!db.objectStoreNames.contains(STORES.HISTORY)) {
                const historyStore = db.createObjectStore(STORES.HISTORY, { keyPath: 'id' });
                historyStore.createIndex('createdAt', 'createdAt', { unique: false });
            }

            if (!db.objectStoreNames.contains(STORES.CONTRACTORS)) {
                db.createObjectStore(STORES.CONTRACTORS, { keyPath: 'id' });
            }

            if (!db.objectStoreNames.contains(STORES.DISCIPLINES)) {
                db.createObjectStore(STORES.DISCIPLINES, { keyPath: 'id' });
            }

            if (!db.objectStoreNames.contains(STORES.PUNCH_LISTS)) {
                db.createObjectStore(STORES.PUNCH_LISTS, { keyPath: 'id' });
            }
        };
    });
}

/**
 * Generic helper to get all items from a store.
 * @param {string} storeName
 * @returns {Promise<Array>}
 */
async function getAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Generic helper to get a single item by key.
 * @param {string} storeName
 * @param {string|number} key
 * @returns {Promise<any>}
 */
async function get(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Generic helper to put (upsert) an item into a store.
 * @param {string} storeName
 * @param {object} item
 * @returns {Promise<void>}
 */
async function put(storeName, item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.put(item);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Generic helper to delete an item from a store.
 * @param {string} storeName
 * @param {string|number} key
 * @returns {Promise<void>}
 */
async function remove(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Clear all items from a store.
 * @param {string} storeName
 * @returns {Promise<void>}
 */
async function clearStore(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Bulk put items into a store.
 * @param {string} storeName
 * @param {Array} items
 * @returns {Promise<void>}
 */
async function bulkPut(storeName, items) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        items.forEach(item => store.put(item));

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ============ Punch-specific functions ============

export async function getAllPunches() {
    return getAll(STORES.PUNCHES);
}

export async function savePunch(punch) {
    return put(STORES.PUNCHES, punch);
}

export async function deletePunch(id) {
    return remove(STORES.PUNCHES, id);
}

export async function savePunches(punches) {
    return bulkPut(STORES.PUNCHES, punches);
}

export async function clearPunches() {
    return clearStore(STORES.PUNCHES);
}

// ============ History-specific functions ============

export async function getAllHistory() {
    return getAll(STORES.HISTORY);
}

export async function getHistoryById(id) {
    return get(STORES.HISTORY, id);
}

export async function saveHistoryRecord(record) {
    return put(STORES.HISTORY, record);
}

export async function deleteHistoryRecord(id) {
    return remove(STORES.HISTORY, id);
}

// ============ Contractor-specific functions ============

export async function getAllContractors() {
    return getAll(STORES.CONTRACTORS);
}

export async function saveContractor(contractor) {
    return put(STORES.CONTRACTORS, contractor);
}

export async function saveContractors(contractors) {
    return bulkPut(STORES.CONTRACTORS, contractors);
}

export async function clearContractors() {
    return clearStore(STORES.CONTRACTORS);
}

export async function deleteContractor(id) {
    return remove(STORES.CONTRACTORS, id);
}

// ============ Discipline-specific functions ============

export async function getAllDisciplines() {
    return getAll(STORES.DISCIPLINES);
}

export async function saveDiscipline(discipline) {
    return put(STORES.DISCIPLINES, discipline);
}

export async function saveDisciplines(disciplines) {
    return bulkPut(STORES.DISCIPLINES, disciplines);
}

export async function clearDisciplines() {
    return clearStore(STORES.DISCIPLINES);
}

// Export store names for external use
export { STORES };

// ============ Punch List (Project) functions ============

export async function getAllPunchLists() {
    return getAll(STORES.PUNCH_LISTS);
}

export async function savePunchList(punchList) {
    return put(STORES.PUNCH_LISTS, punchList);
}

export async function deletePunchList(id) {
    // Note: This does NOT cascade delete punches. Caller must handle cleanup if desired.
    return remove(STORES.PUNCH_LISTS, id);
}

export async function getPunchesByListId(listId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.PUNCHES, 'readonly');
        const store = tx.objectStore(STORES.PUNCHES);
        const index = store.index('punchListId');
        const request = index.getAll(listId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export default {
    openDB,
    getAllPunches,
    savePunch,
    deletePunch,
    savePunches,
    clearPunches,
    getAllHistory,
    getHistoryById,
    saveHistoryRecord,
    deleteHistoryRecord,
    getAllContractors,
    saveContractor,
    deleteContractor,
    saveContractors,
    clearContractors,
    getAllDisciplines,
    saveDiscipline,
    saveDisciplines,
    clearDisciplines,
    getAllPunchLists,
    savePunchList,
    deletePunchList,
    getPunchesByListId,
};
