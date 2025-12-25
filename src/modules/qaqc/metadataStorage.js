// LocalStorage helper for QA/QC metadata
import { QAQC_SCHEMA, generateId } from './schema.js';

const STORAGE_KEY = 'cew-qaqc-metadata';

// Deep clone helper
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Deep merge schema into existing metadata (keeps user data, adds new schema nodes)
function mergeSchemaIntoNode(schemaNode, existingNode) {
  if (!schemaNode) return existingNode;
  if (!existingNode) return deepClone(schemaNode);
  
  // Merge properties from schema
  const merged = { ...existingNode };
  
  // Copy fixed schema properties
  if (schemaNode.type) merged.type = schemaNode.type;
  if (schemaNode.label) merged.label = schemaNode.label;
  if (schemaNode.fixed !== undefined) merged.fixed = schemaNode.fixed;
  if (schemaNode.isNCR !== undefined) merged.isNCR = schemaNode.isNCR;
  if (schemaNode.allowMultiple !== undefined) merged.allowMultiple = schemaNode.allowMultiple;
  if (schemaNode.publicPath !== undefined) merged.publicPath = schemaNode.publicPath;
  
  // Merge children recursively
  if (schemaNode.children) {
    merged.children = merged.children || {};
    for (const [key, childSchema] of Object.entries(schemaNode.children)) {
      merged.children[key] = mergeSchemaIntoNode(childSchema, merged.children[key]);
    }
  }
  
  return merged;
}

// Initialize metadata from schema if not exists
export function initializeMetadata() {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      // Merge with current schema to pick up any new folders
      const merged = {
        ...parsed,
        tree: {},
      };
      for (const [key, schemaCategory] of Object.entries(QAQC_SCHEMA)) {
        merged.tree[key] = mergeSchemaIntoNode(schemaCategory, parsed.tree?.[key]);
      }
      merged.updatedAt = Date.now();
      saveMetadata(merged);
      return merged;
    } catch (e) {
      console.error('Failed to parse QAQC metadata:', e);
    }
  }
  
  // Initialize from schema
  const metadata = {
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tree: deepClone(QAQC_SCHEMA),
    publicFileStatuses: {}, // Store status for public files
  };
  
  saveMetadata(metadata);
  return metadata;
}

export function getMetadata() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return initializeMetadata();
  try {
    return JSON.parse(stored);
  } catch (e) {
    return initializeMetadata();
  }
}

export function saveMetadata(metadata) {
  metadata.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
}

// Helper to find a node by path (array of keys)
function findNode(tree, path) {
  let node = tree;
  for (const key of path) {
    if (!node || !node.children) return null;
    node = node.children[key] || node[key];
  }
  return node;
}

// Add a document to a folder
export function addDocument(categoryKey, folderPath, docData) {
  const metadata = getMetadata();
  const category = metadata.tree[categoryKey];
  if (!category) return null;
  
  let target = category;
  if (folderPath && folderPath.length > 0) {
    for (const key of folderPath) {
      if (target.children && target.children[key]) {
        target = target.children[key];
      } else {
        return null;
      }
    }
  }
  
  if (!target.children) target.children = {};
  
  const docId = generateId();
  target.children[docId] = {
    type: 'document',
    label: docData.name,
    fileId: docData.fileId,
    fileName: docData.fileName,
    fileType: docData.fileType,
    fileSize: docData.fileSize,
    uploadedAt: docData.uploadedAt || Date.now(),
    status: category.isNCR ? 'open' : 'incomplete',
  };
  
  saveMetadata(metadata);
  return docId;
}

// Update a document slot (for ITPs)
export function updateDocSlot(categoryKey, slotKey, docData) {
  const metadata = getMetadata();
  const category = metadata.tree[categoryKey];
  if (!category || !category.children || !category.children[slotKey]) return false;
  
  const slot = category.children[slotKey];
  slot.fileId = docData.fileId;
  slot.fileName = docData.fileName;
  slot.fileType = docData.fileType;
  slot.fileSize = docData.fileSize;
  slot.uploadedAt = docData.uploadedAt || Date.now();
  if (!slot.status) slot.status = 'incomplete';
  
  saveMetadata(metadata);
  return true;
}

// Update document status
export function updateStatus(categoryKey, path, status) {
  const metadata = getMetadata();
  const category = metadata.tree[categoryKey];
  if (!category) return false;
  
  let target = category;
  if (path && path.length > 0) {
    for (const key of path) {
      if (target.children && target.children[key]) {
        target = target.children[key];
      } else if (target[key]) {
        target = target[key];
      } else {
        return false;
      }
    }
  }
  
  target.status = status;
  saveMetadata(metadata);
  return true;
}

// Update status for a public file
export function updatePublicFileStatus(statusKey, status) {
  const metadata = getMetadata();
  if (!metadata.publicFileStatuses) {
    metadata.publicFileStatuses = {};
  }
  metadata.publicFileStatuses[statusKey] = status;
  saveMetadata(metadata);
  return true;
}

// Delete a document
export function deleteDocument(categoryKey, path) {
  const metadata = getMetadata();
  const category = metadata.tree[categoryKey];
  if (!category) return null;
  
  if (path.length === 1) {
    // Direct child of category
    const docId = path[0];
    const doc = category.children?.[docId];
    if (doc) {
      const fileId = doc.fileId;
      delete category.children[docId];
      saveMetadata(metadata);
      return fileId;
    }
  } else {
    // Nested
    let parent = category;
    for (let i = 0; i < path.length - 1; i++) {
      if (parent.children && parent.children[path[i]]) {
        parent = parent.children[path[i]];
      } else {
        return null;
      }
    }
    const docId = path[path.length - 1];
    const doc = parent.children?.[docId];
    if (doc) {
      const fileId = doc.fileId;
      delete parent.children[docId];
      saveMetadata(metadata);
      return fileId;
    }
  }
  return null;
}

// Create a folder (only in Random or where allowed)
export function createFolder(categoryKey, parentPath, folderName) {
  const metadata = getMetadata();
  const category = metadata.tree[categoryKey];
  if (!category) return null;
  
  let target = category;
  if (parentPath && parentPath.length > 0) {
    for (const key of parentPath) {
      if (target.children && target.children[key]) {
        target = target.children[key];
      } else {
        return null;
      }
    }
  }
  
  if (!target.children) target.children = {};
  
  const folderId = generateId();
  target.children[folderId] = {
    type: 'folder',
    label: folderName,
    fixed: false,
    allowMultiple: true,
    allowFolderCreation: categoryKey === 'Random',
    children: {},
  };
  
  saveMetadata(metadata);
  return folderId;
}

// Delete a folder (only non-fixed folders)
export function deleteFolder(categoryKey, path) {
  const metadata = getMetadata();
  const category = metadata.tree[categoryKey];
  if (!category) return [];
  
  // Collect all fileIds to delete
  function collectFileIds(node) {
    const ids = [];
    if (node.fileId) ids.push(node.fileId);
    if (node.children) {
      for (const child of Object.values(node.children)) {
        ids.push(...collectFileIds(child));
      }
    }
    return ids;
  }
  
  let parent = category;
  for (let i = 0; i < path.length - 1; i++) {
    if (parent.children && parent.children[path[i]]) {
      parent = parent.children[path[i]];
    } else {
      return [];
    }
  }
  
  const folderId = path[path.length - 1];
  const folder = parent.children?.[folderId];
  if (folder && !folder.fixed) {
    const fileIds = collectFileIds(folder);
    delete parent.children[folderId];
    saveMetadata(metadata);
    return fileIds;
  }
  
  return [];
}

// Calculate completion stats
export function calculateStats(metadata, publicFiles = {}) {
  const stats = {
    overall: { total: 0, done: 0, inProgress: 0 },
    ITPs: { total: 0, done: 0, inProgress: 0 },
    Checklists: { total: 0, done: 0, inProgress: 0 },
    NCRs: { total: 0, done: 0, inProgress: 0 },
    ThirdParty: { total: 0, done: 0, inProgress: 0 },
    Random: { total: 0, done: 0, inProgress: 0 },
  };
  
  function countDocs(node, categoryKey, isNCR = false) {
    if (node.type === 'document' || node.type === 'doc-slot') {
      if (node.fileId) {
        stats[categoryKey].total++;
        stats.overall.total++;
        
        const isDone = isNCR 
          ? node.status === 'closed'
          : node.status === 'completed';
        
        const isInProgress = node.status === 'in_progress';
        
        if (isDone) {
          stats[categoryKey].done++;
          stats.overall.done++;
        } else if (isInProgress) {
          stats[categoryKey].inProgress++;
          stats.overall.inProgress++;
        }
      } else if (node.type === 'doc-slot' && node.required) {
        // Required slot without file counts as incomplete
        stats[categoryKey].total++;
        stats.overall.total++;
      }
    }
    
    if (node.children) {
      for (const child of Object.values(node.children)) {
        countDocs(child, categoryKey, isNCR);
      }
    }
  }
  
  for (const [key, category] of Object.entries(metadata.tree)) {
    countDocs(category, key, category.isNCR);
  }
  
  // Count public files
  const publicFileStatuses = metadata.publicFileStatuses || {};
  for (const [categoryKey, folders] of Object.entries(publicFiles)) {
    for (const [nodeKey, files] of Object.entries(folders)) {
      for (const file of files) {
        const statusKey = `${categoryKey}-${nodeKey}-${file.name}`;
        const status = publicFileStatuses[statusKey] || 'incomplete';
        
        stats[categoryKey].total++;
        stats.overall.total++;
        
        if (status === 'completed') {
          stats[categoryKey].done++;
          stats.overall.done++;
        } else if (status === 'in_progress') {
          stats[categoryKey].inProgress++;
          stats.overall.inProgress++;
        }
      }
    }
  }
  
  // Calculate percentages
  for (const key of Object.keys(stats)) {
    const s = stats[key];
    s.percentage = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    s.inProgressPercentage = s.total > 0 ? Math.round((s.inProgress / s.total) * 100) : 0;
    s.incompletePercentage = s.total > 0 ? Math.round(((s.total - s.done - s.inProgress) / s.total) * 100) : 0;
  }
  
  return stats;
}
