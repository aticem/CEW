// IndexedDB helper for QA/QC file storage
const DB_NAME = 'cew-qaqc-files';
const DB_VERSION = 1;
const STORE_NAME = 'files';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
  
  return dbPromise;
}

export async function saveFile(id, file) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    const reader = new FileReader();
    reader.onload = () => {
      const record = {
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        data: reader.result,
        uploadedAt: Date.now(),
      };
      
      const request = store.put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export async function getFile(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteFile(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getAllFileIds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAllKeys();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Convert ArrayBuffer to Blob for preview
export function arrayBufferToBlob(arrayBuffer, type) {
  return new Blob([arrayBuffer], { type });
}

// Create object URL for file preview
export async function getFileUrl(id) {
  const file = await getFile(id);
  if (!file) return null;
  const blob = arrayBufferToBlob(file.data, file.type);
  return URL.createObjectURL(blob);
}
