import { useState, useCallback, useRef, useMemo } from 'react';
import { DOC_STATUSES, NCR_STATUSES, generateId } from './schema.js';
import { 
  initializeMetadata, 
  getMetadata, 
  addDocument, 
  updateDocSlot, 
  clearDocSlot,
  updateDocumentFile,
  updateStatus,
  updatePublicFileStatus,
  deleteDocument,
  createFolder,
  createCategory,
  renameCategory,
  deleteCategory,
  deleteFolder,
  renameFolder,
  calculateStats,
  resetMetadata 
} from './metadataStorage.js';
import { saveFile, deleteFile, getFile, getFileUrl } from './fileStorage.js';

// Debug: expose reset function to window for manual reset
if (typeof window !== 'undefined') {
  window.resetQAQCMetadata = () => {
    const fresh = resetMetadata();
    console.log('[QAQC] Metadata reset to fresh state:', fresh);
    window.location.reload();
  };
  console.log('[QAQC] To reset metadata, run: window.resetQAQCMetadata()');
}

// Category icons
const CategoryIcon = ({ category }) => {
  const icons = {
    ITPs: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
    Checklists: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    NCRs: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
    ThirdParty: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    Random: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
    ),
  };
  return icons[category] || icons.Random;
};

// File type icon
const FileIcon = ({ type }) => {
  const isPdf = type?.includes('pdf');
  const isImage = type?.startsWith('image/');
  const isExcel = type?.includes('sheet') || type?.includes('excel');
  const isWord = type?.includes('word') || type?.includes('document');
  
  if (isPdf) return <span className="text-red-400">PDF</span>;
  if (isImage) return <span className="text-blue-400">IMG</span>;
  if (isExcel) return <span className="text-green-400">XLS</span>;
  if (isWord) return <span className="text-blue-300">DOC</span>;
  return <span className="text-slate-400">FILE</span>;
};

// Status badge component
const StatusBadge = ({ status, isNCR, onChange, small = false }) => {
  const statuses = isNCR ? NCR_STATUSES : DOC_STATUSES;
  const statusObj = Object.values(statuses).find(s => s.key === status) || Object.values(statuses)[0];
  
  const handleClick = (e) => {
    e.stopPropagation();
    const keys = Object.keys(statuses);
    const currentIdx = keys.findIndex(k => statuses[k].key === status);
    const nextIdx = (currentIdx + 1) % keys.length;
    onChange(statuses[keys[nextIdx]].key);
  };
  
  return (
    <button
      onClick={handleClick}
      className={`${small ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]'} font-bold uppercase tracking-wide rounded-none cursor-pointer hover:opacity-80 transition-opacity`}
      style={{ 
        color: statusObj.color, 
        backgroundColor: statusObj.bgColor,
        border: `1px solid ${statusObj.color}40`
      }}
      title="Click to change status"
    >
      {statusObj.label}
    </button>
  );
};

// Completion bar
const CompletionBar = ({ label, done, total, percentage, color = '#22c55e' }) => (
  <div className="mb-3">
    <div className="flex justify-between items-center mb-1">
      <span className="text-[12px] font-normal text-slate-300">{label}</span>
      <span className="text-[12px] font-normal text-slate-200">{done}/{total} ({percentage}%)</span>
    </div>
    <div className="h-2 bg-slate-700 rounded-none overflow-hidden">
      <div 
        className="h-full transition-all duration-300 rounded-none"
        style={{ width: `${percentage}%`, backgroundColor: color }}
      />
    </div>
  </div>
);

// Public file item component
const PublicFileItem = ({ file, categoryKey, nodeKey, onStatusChange, metadata, depth = 0 }) => {
  // Get status from metadata's publicFileStatuses
  const statusKey = `${categoryKey}-${nodeKey}-${file.name}`;
  const savedStatus = metadata?.publicFileStatuses?.[statusKey] || 'incomplete';
  
  return (
    <div 
      className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-700/50 rounded-none cursor-pointer group"
      style={{ marginLeft: `${(depth + 1) * 20}px` }}
    >
      <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold">
        <FileIcon type={file.type} />
      </span>
      
      <span className="flex-1 text-[12px] text-white">
        {file.name}
      </span>
      
      <StatusBadge 
        status={savedStatus}
        isNCR={false}
        onChange={(s) => onStatusChange(statusKey, [], s, true)}
        small
      />
      
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <a
          href={file.path}
          download={file.name}
          onClick={(e) => e.stopPropagation()}
          className="p-1 hover:bg-slate-600 rounded text-[10px] text-slate-300"
          title="Download"
        >
          ⬇
        </a>
      </div>
    </div>
  );
};

export default function QAQCModule() {
  const [metadata, setMetadata] = useState(() => initializeMetadata());
  const [selectedCategory, setSelectedCategory] = useState('ITPs');
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [selectedContainer, setSelectedContainer] = useState(null); // { categoryKey, path } where path is a folder path
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);
  const uploadTargetRef = useRef(null);
  const [newFolderParent, setNewFolderParent] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newCategoryModal, setNewCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editCategoryModal, setEditCategoryModal] = useState(null); // { key, name, fixed }
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editingFolder, setEditingFolder] = useState(null); // { categoryKey, path, currentName }
  
  // Public files manifest - static definition of files in public/QAQC folders
  // When you add files to public/QAQC/Checklists/*, add them here too
  const publicFiles = useMemo(() => ({
    'ITPs': {
      'itp-civil': [
        { name: 'civil.docx', path: '/QAQC/ITPs/civil/civil.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      ],
      'itp-electrical': [
        { name: 'electrical.docx', path: '/QAQC/ITPs/electrical/electrical.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      ],
      'itp-mechanical': [
        { name: 'mechanical.docx', path: '/QAQC/ITPs/mechanical/mechanical.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      ],
    },
    'Checklists': {
      'cl-dc-cable': [
        { name: 'civil - Copy.docx', path: '/QAQC/Checklists/electrical/dc-cable/civil - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'electrical - Copy.docx', path: '/QAQC/Checklists/electrical/dc-cable/electrical - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical - Copy.docx', path: '/QAQC/Checklists/electrical/dc-cable/mechanical - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
      'cl-earthing-foc': [
        { name: 'civil.docx', path: '/QAQC/Checklists/electrical/earthing-foc/civil.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'electrical.docx', path: '/QAQC/Checklists/electrical/earthing-foc/electrical.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical.docx', path: '/QAQC/Checklists/electrical/earthing-foc/mechanical.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
      'cl-inverter-lv': [
        { name: 'civil - Copy (2).docx', path: '/QAQC/Checklists/electrical/inverter-lv/civil - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'civil - Copy - Copy.docx', path: '/QAQC/Checklists/electrical/inverter-lv/civil - Copy - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'electrical - Copy (2).docx', path: '/QAQC/Checklists/electrical/inverter-lv/electrical - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'electrical - Copy - Copy.docx', path: '/QAQC/Checklists/electrical/inverter-lv/electrical - Copy - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical - Copy (2).docx', path: '/QAQC/Checklists/electrical/inverter-lv/mechanical - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical - Copy - Copy.docx', path: '/QAQC/Checklists/electrical/inverter-lv/mechanical - Copy - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
      'cl-module-installation': [
        { name: 'civil - Copy (2).docx', path: '/QAQC/Checklists/mechanical/module-installation/civil - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'civil - Copy - Copy.docx', path: '/QAQC/Checklists/mechanical/module-installation/civil - Copy - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'electrical - Copy (2).docx', path: '/QAQC/Checklists/mechanical/module-installation/electrical - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'electrical - Copy - Copy.docx', path: '/QAQC/Checklists/mechanical/module-installation/electrical - Copy - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical - Copy (2).docx', path: '/QAQC/Checklists/mechanical/module-installation/mechanical - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical - Copy - Copy.docx', path: '/QAQC/Checklists/mechanical/module-installation/mechanical - Copy - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
      'cl-mounting-structure': [
        { name: 'civil - Copy.docx', path: '/QAQC/Checklists/mechanical/mounting-structure-assembly/civil - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'civil.docx', path: '/QAQC/Checklists/mechanical/mounting-structure-assembly/civil.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'electrical - Copy.docx', path: '/QAQC/Checklists/mechanical/mounting-structure-assembly/electrical - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical - Copy.docx', path: '/QAQC/Checklists/mechanical/mounting-structure-assembly/mechanical - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical.docx', path: '/QAQC/Checklists/mechanical/mounting-structure-assembly/mechanical.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
    },
    'NCRs': {
      'NCRs': [
        { name: 'civil - Copy - Copy.docx', path: '/QAQC/NCRs/civil - Copy - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'electrical - Copy (2).docx', path: '/QAQC/NCRs/electrical - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical - Copy (2).docx', path: '/QAQC/NCRs/mechanical - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
    },
    'ThirdParty': {
      'tp-dnv': [
        { name: 'electrical - Copy (2).docx', path: '/QAQC/ThirdParty/DNV/electrical - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical - Copy (2).docx', path: '/QAQC/ThirdParty/DNV/mechanical - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical - Copy - Copy.docx', path: '/QAQC/ThirdParty/DNV/mechanical - Copy - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'mechanical - Copy.docx', path: '/QAQC/ThirdParty/DNV/mechanical - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
      'tp-cea': [
        { name: 'civil - Copy (2).docx', path: '/QAQC/ThirdParty/CEA/civil - Copy (2).docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'civil - Copy - Copy.docx', path: '/QAQC/ThirdParty/CEA/civil - Copy - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'civil - Copy.docx', path: '/QAQC/ThirdParty/CEA/civil - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'civil.docx', path: '/QAQC/ThirdParty/CEA/civil.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'electrical - Copy - Copy.docx', path: '/QAQC/ThirdParty/CEA/electrical - Copy - Copy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      ],
    },
  }), []);
  
  // Calculate stats from metadata
  const stats = useMemo(() => calculateStats(metadata, publicFiles), [metadata, publicFiles]);
  
  const refreshMetadata = useCallback(() => {
    const meta = getMetadata();
    setMetadata(meta);
  }, []);

  const expandFolderPath = useCallback((categoryKey, folderPath) => {
    if (!folderPath || folderPath.length === 0) return;
    setExpandedNodes(prev => {
      const next = new Set(prev);
      for (let i = 1; i <= folderPath.length; i++) {
        const prefix = folderPath.slice(0, i);
        next.add(`${categoryKey}-${prefix.join('-')}`);
      }
      return next;
    });
  }, []);
  
  // Toggle folder expand/collapse - when collapsing, also collapse all children
  const toggleExpand = useCallback((nodeId) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        // Collapse: remove this node and all children (nodes starting with this nodeId)
        next.delete(nodeId);
        for (const id of prev) {
          if (id.startsWith(nodeId + '-')) {
            next.delete(id);
          }
        }
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);
  
  // Handle file upload
  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    const target = uploadTargetRef.current;
    console.log('[QAQC Upload] Starting upload:', { file: file?.name, target });
    if (!file || !target) {
      console.log('[QAQC Upload] No file or target, aborting');
      return;
    }
    
    try {
      const fileId = generateId();
      await saveFile(fileId, file);
      console.log('[QAQC Upload] File saved with ID:', fileId);
      
      const docData = {
        fileId,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        uploadedAt: Date.now(),
        name: file.name,
      };
      
      let docId = null;
      let oldFileIdToDelete = null;
      if (target.type === 'slot') {
        console.log('[QAQC Upload] Updating slot:', target.slotKey);
        oldFileIdToDelete = updateDocSlot(target.category, target.slotKey, docData) || null;
      } else if (target.type === 'folder') {
        console.log('[QAQC Upload] Adding to folder:', target.category, target.path);
        docId = addDocument(target.category, target.path, docData);
        console.log('[QAQC Upload] addDocument returned:', docId);
        if (docId) {
          // Make sure the folder is expanded so the uploaded file is visible immediately
          expandFolderPath(target.category, target.path);
          // Also expand this specific folder
          const nodeId = `${target.category}-${target.path.join('-')}`;
          setExpandedNodes(prev => new Set([...prev, nodeId]));
          setSelectedContainer({ categoryKey: target.category, path: target.path });
        } else {
          console.error('[QAQC Upload] Failed to add document - path not found');
          alert('Failed to add document to folder. Path may not exist.');
        }
      } else if (target.type === 'document') {
        console.log('[QAQC Upload] Replacing document at path:', target.category, target.path);
        oldFileIdToDelete = updateDocumentFile(target.category, target.path, docData) || null;
      } else if (target.type === 'category') {
        console.log('[QAQC Upload] Adding to category root:', target.category);
        docId = addDocument(target.category, [], docData);
        console.log('[QAQC Upload] addDocument returned:', docId);
      }
      
      if (oldFileIdToDelete && oldFileIdToDelete !== fileId) {
        try {
          await deleteFile(oldFileIdToDelete);
        } catch (err) {
          console.warn('[QAQC Upload] Failed to delete old file:', oldFileIdToDelete, err);
        }
      }

      refreshMetadata();
      console.log('[QAQC Upload] Metadata refreshed');
    } catch (err) {
      console.error('[QAQC Upload] Upload failed:', err);
      alert('Failed to upload file: ' + err.message);
    }
    
    uploadTargetRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [refreshMetadata, expandFolderPath]);

  const triggerBrowserDownload = useCallback((blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const downloadStoredFile = useCallback(async (fileId, fileName) => {
    const record = await getFile(fileId);
    if (!record?.data) return false;
    const blob = new Blob([record.data], { type: record.type || 'application/octet-stream' });
    triggerBrowserDownload(blob, fileName || record.name || 'download');
    return true;
  }, [triggerBrowserDownload]);

  const handleFolderDownload = useCallback(async (categoryKey, folderPath) => {
    const meta = getMetadata();
    const category = meta.tree?.[categoryKey];
    if (!category) return;

    let target = category;
    for (const key of folderPath) {
      if (target.children && target.children[key]) {
        target = target.children[key];
      } else {
        return;
      }
    }

    const files = [];
    function walk(node, labelPath) {
      if (!node) return;
      if (node.type === 'document' && node.fileId) {
        files.push({ fileId: node.fileId, fileName: node.fileName || node.label, path: labelPath });
      }
      if (node.type === 'doc-slot' && node.fileId) {
        files.push({ fileId: node.fileId, fileName: node.fileName || node.label, path: labelPath });
      }
      if (node.children) {
        for (const [k, child] of Object.entries(node.children)) {
          walk(child, [...labelPath, child?.label || k]);
        }
      }
    }

    walk(target, [target?.label || 'folder']);

    if (files.length === 0) {
      alert('No downloadable files in this folder.');
      return;
    }

    if (files.length === 1) {
      const ok = await downloadStoredFile(files[0].fileId, files[0].fileName);
      if (!ok) alert('File not found in storage.');
      return;
    }

    const manifest = {
      folder: target?.label || 'folder',
      category: categoryKey,
      exportedAt: new Date().toISOString(),
      files: files.map((f) => ({ fileId: f.fileId, fileName: f.fileName, path: f.path })),
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    triggerBrowserDownload(blob, `${categoryKey}-${target?.label || 'folder'}-manifest.json`);
  }, [downloadStoredFile, triggerBrowserDownload]);
  
  // Handle status change (supports both regular docs and public files)
  const handleStatusChange = useCallback((categoryKeyOrStatusKey, path, newStatus, isPublicFile = false) => {
    if (isPublicFile) {
      // Update public file status
      updatePublicFileStatus(categoryKeyOrStatusKey, newStatus);
    } else {
      updateStatus(categoryKeyOrStatusKey, path, newStatus);
    }
    refreshMetadata();
  }, [refreshMetadata]);
  
  // Handle delete
  const handleDelete = useCallback(async (categoryKey, path, isFolder = false) => {
    if (!confirm(`Are you sure you want to delete this ${isFolder ? 'folder' : 'document'}?`)) return;
    
    try {
      if (isFolder) {
        const fileIds = deleteFolder(categoryKey, path);
        for (const id of fileIds) {
          await deleteFile(id);
        }
      } else {
        const fileId = deleteDocument(categoryKey, path);
        if (fileId) await deleteFile(fileId);
      }
      refreshMetadata();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [refreshMetadata]);

  const handleClearSlot = useCallback(async (categoryKey, slotKey, fileId) => {
    if (!fileId) return;
    if (!confirm('Remove this file from the slot?')) return;
    try {
      const oldId = clearDocSlot(categoryKey, slotKey);
      if (oldId) await deleteFile(oldId);
      refreshMetadata();
    } catch (err) {
      console.error('Clear slot failed:', err);
    }
  }, [refreshMetadata]);
  
  // Handle preview
  const handlePreview = useCallback(async (fileId, fileName, fileType) => {
    try {
      const url = await getFileUrl(fileId);
      if (url) {
        setPreviewFile({ name: fileName, type: fileType });
        setPreviewUrl(url);
      }
    } catch (err) {
      console.error('Preview failed:', err);
    }
  }, []);
  
  // Close preview
  const closePreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewFile(null);
    setPreviewUrl(null);
  }, [previewUrl]);
  
  // Create folder
  const handleCreateFolder = useCallback(() => {
    if (!newFolderParent || !newFolderName.trim()) return;
    const folderId = createFolder(newFolderParent.category, newFolderParent.path, newFolderName.trim());
    if (folderId) {
      // Ensure parent path is expanded so the new folder is visible
      expandFolderPath(newFolderParent.category, newFolderParent.path);
      // Also expand the parent folder if it exists
      if (newFolderParent.path.length > 0) {
        const parentNodeId = `${newFolderParent.category}-${newFolderParent.path.join('-')}`;
        setExpandedNodes(prev => new Set([...prev, parentNodeId]));
      }
      // Expand the newly created folder too
      const newFolderPath = [...newFolderParent.path, folderId];
      const newNodeId = `${newFolderParent.category}-${newFolderPath.join('-')}`;
      setExpandedNodes(prev => new Set([...prev, newNodeId]));
      setSelectedContainer({ categoryKey: newFolderParent.category, path: newFolderPath });
    }
    refreshMetadata();
    setNewFolderParent(null);
    setNewFolderName('');
  }, [newFolderParent, newFolderName, refreshMetadata, expandFolderPath]);
  
  // Create new category (tab)
  const handleCreateCategory = useCallback(() => {
    if (!newCategoryName.trim()) return;
    const newKey = createCategory(newCategoryName.trim());
    refreshMetadata();
    setSelectedCategory(newKey);
    setNewCategoryModal(false);
    setNewCategoryName('');
  }, [newCategoryName, refreshMetadata]);

  const openEditCategory = useCallback((categoryKey) => {
    const category = metadata?.tree?.[categoryKey];
    if (!category) return;
    setEditCategoryModal({ key: categoryKey, name: category.label, fixed: !!category.fixed });
    setEditCategoryName(category.label || '');
  }, [metadata]);

  const handleRenameCategory = useCallback(() => {
    if (!editCategoryModal) return;
    const nextName = editCategoryName.trim();
    if (!nextName) return;
    renameCategory(editCategoryModal.key, nextName);
    refreshMetadata();
    setEditCategoryModal(null);
    setEditCategoryName('');
  }, [editCategoryModal, editCategoryName, refreshMetadata]);

  const handleDeleteCategory = useCallback(async () => {
    if (!editCategoryModal) return;
    if (editCategoryModal.fixed) return;
    if (!confirm('Are you sure you want to delete this category and all its files?')) return;

    try {
      const fileIds = deleteCategory(editCategoryModal.key);
      for (const id of fileIds) {
        await deleteFile(id);
      }
    } catch (err) {
      console.error('Delete category failed:', err);
    }

    const metaAfter = getMetadata();
    setMetadata(metaAfter);

    if (selectedCategory === editCategoryModal.key) {
      const fallback = metaAfter.tree?.ITPs ? 'ITPs' : Object.keys(metaAfter.tree || {})[0];
      if (fallback) setSelectedCategory(fallback);
    }
    if (selectedContainer?.categoryKey === editCategoryModal.key) {
      setSelectedContainer(null);
    }

    setEditCategoryModal(null);
    setEditCategoryName('');
  }, [editCategoryModal, selectedCategory, selectedContainer]);
  
  // Rename folder
  const handleRenameFolder = useCallback((newName) => {
    if (!editingFolder || !newName.trim()) return;
    renameFolder(editingFolder.categoryKey, editingFolder.path, newName.trim());
    refreshMetadata();
    setEditingFolder(null);
  }, [editingFolder, refreshMetadata]);
  
  // Trigger file input
  const triggerUpload = useCallback((target) => {
    uploadTargetRef.current = target;
    fileInputRef.current?.click();
  }, []);

  const searchLower = searchQuery.trim().toLowerCase();

  const nodeOrDescendantMatchesSearch = useCallback(
    function matches(node, nodeKey, categoryKey) {
      if (!searchLower) return true;
      const label = (node?.label || '').toLowerCase();
      if (label.includes(searchLower)) return true;

      const folderPublicFiles = publicFiles?.[categoryKey]?.[nodeKey] || [];
      if (folderPublicFiles.some((f) => (f.name || '').toLowerCase().includes(searchLower))) {
        return true;
      }

      if (node?.children) {
        for (const [childKey, child] of Object.entries(node.children)) {
          if (matches(child, childKey, categoryKey)) return true;
        }
      }

      return false;
    },
    [publicFiles, searchLower]
  );
  
  // Render tree node
  const renderNode = (node, nodeKey, path, categoryKey, isNCR = false, depth = 0) => {
    if (node?.hidden) return null;
    const fullPath = [...path, nodeKey];
    const nodeId = `${categoryKey}-${fullPath.join('-')}`;
    const isExpanded = expandedNodes.has(nodeId);
    const effectiveExpanded = searchLower ? true : isExpanded;
    const isFolder = node.type === 'folder';
    const isDocSlot = node.type === 'doc-slot';
    const isDocument = node.type === 'document';

    const categoryAllowsFolderCreation = !!(metadata?.tree?.[categoryKey]?.allowFolderCreation);
    const isSelectedFolder =
      !!selectedContainer &&
      selectedContainer.categoryKey === categoryKey &&
      selectedContainer.path.join('-') === fullPath.join('-');
    
    // Get public files for this folder
    const folderPublicFiles = publicFiles[categoryKey]?.[nodeKey] || [];
    const hasPublicFiles = folderPublicFiles.length > 0;
    const hasChildNodes = node.children && Object.keys(node.children).length > 0;
    const hasChildren = hasChildNodes || hasPublicFiles;
    
    // Visibility rules:
    // - Documents and doc-slots should always render.
    // - User-created folders should render even if empty (so users can see what they created).
    // - Fixed folders always render.
    // - Other empty non-fixed folders can stay hidden.
    const shouldShow =
      isDocument ||
      isDocSlot ||
      (isFolder &&
        (node.fixed || node.userCreated || hasChildren || categoryAllowsFolderCreation || categoryKey === 'Random'));
    
    // Search filter (deep, includes public files)
    if (searchLower && !nodeOrDescendantMatchesSearch(node, nodeKey, categoryKey)) {
      return null;
    }
    
    // Don't render non-fixed empty folders
    if (!shouldShow) return null;
    
    return (
      <div key={nodeKey} className="select-none">
        <div 
          className={`flex items-center gap-2 py-1.5 px-2 rounded-none cursor-pointer group ${
            isSelectedFolder ? 'bg-slate-700/70' : 'hover:bg-slate-700/50'
          }`}
          style={{ marginLeft: `${depth * 20}px` }}
          onClick={() => {
            if (isFolder) {
              setSelectedContainer({ categoryKey, path: fullPath });
              toggleExpand(nodeId);
            }
          }}
        >
          {/* Expand/collapse icon for folders */}
          {isFolder && (
            <span className="w-4 h-4 flex items-center justify-center text-slate-500">
              {hasChildren ? (effectiveExpanded ? '▼' : '▶') : '○'}
            </span>
          )}
          
          {/* Folder/File icon */}
          {isFolder ? (
            <svg className="w-4 h-4 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
          ) : (
            <span className="w-4 h-4 flex items-center justify-center text-[10px] font-bold">
              <FileIcon type={node.fileType} />
            </span>
          )}
          
          {/* Label - editable for non-fixed folders in Random */}
          {editingFolder && editingFolder.categoryKey === categoryKey && 
           editingFolder.path.join('-') === fullPath.join('-') ? (
            <input
              type="text"
              defaultValue={node.label}
              autoFocus
              className="flex-1 bg-slate-700 border border-amber-500 rounded px-2 py-0.5 text-[12px] text-white focus:outline-none"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameFolder(e.target.value);
                } else if (e.key === 'Escape') {
                  setEditingFolder(null);
                }
              }}
              onBlur={(e) => handleRenameFolder(e.target.value)}
            />
          ) : (
            <span 
              className={`flex-1 text-[12px] ${node.fileId ? 'text-white' : 'text-slate-400'}`}
              onDoubleClick={(e) => {
                if (isFolder && !node.fixed && categoryKey === 'Random') {
                  e.stopPropagation();
                  setEditingFolder({ categoryKey, path: fullPath, currentName: node.label });
                }
              }}
            >
              {node.label}
              {isDocSlot && !node.fileId && <span className="text-red-400 ml-1">(required)</span>}
            </span>
          )}
          
          {/* Upload date */}
          {node.uploadedAt && (
            <span className="text-[9px] text-slate-500 mr-2">
              {new Date(node.uploadedAt).toLocaleDateString()}
            </span>
          )}
          
          {/* Status badge */}
          {(isDocSlot || isDocument) && node.fileId && (
            <StatusBadge 
              status={node.status || (isNCR ? 'open' : 'incomplete')} 
              isNCR={isNCR}
              onChange={(s) => handleStatusChange(categoryKey, fullPath, s)}
              small
            />
          )}
          
          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Download (folders only) */}
            {isFolder && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleFolderDownload(categoryKey, fullPath);
                }}
                className="p-1 hover:bg-slate-600 rounded text-[10px] text-slate-300"
                title="Download"
              >
                ↓
              </button>
            )}

            {/* Upload/Replace (documents + doc-slots only) */}
            {(isDocSlot || isDocument) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isDocSlot) {
                    triggerUpload({ type: 'slot', category: categoryKey, slotKey: nodeKey });
                  } else if (isDocument) {
                    triggerUpload({ type: 'document', category: categoryKey, path: fullPath });
                  }
                }}
                className="p-1 hover:bg-slate-600 rounded text-[10px] text-slate-300"
                title={node.fileId ? 'Replace' : 'Upload'}
              >
                {node.fileId ? '↻' : '↑'}
              </button>
            )}
            
            {/* Preview (documents + doc-slots) */}
            {(isDocSlot || isDocument) && node.fileId && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePreview(node.fileId, node.fileName, node.fileType);
                }}
                className="p-1 hover:bg-slate-600 rounded text-[10px] text-slate-300"
                title="Preview"
              >
                👁
              </button>
            )}

            {/* Rename (folders only) */}
            {isFolder && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingFolder({ categoryKey, path: fullPath, currentName: node.label });
                }}
                className="p-1 hover:bg-slate-600 rounded text-[10px] text-slate-300"
                title="Rename"
              >
                ✎
              </button>
            )}

            {/* Remove file / Delete */}
            {isDocSlot && node.fileId && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearSlot(categoryKey, nodeKey, node.fileId);
                }}
                className="p-1 hover:bg-red-600/50 rounded text-[10px] text-red-400"
                title="Remove"
              >
                ✕
              </button>
            )}

            {isDocument && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(categoryKey, fullPath, false);
                }}
                className="p-1 hover:bg-red-600/50 rounded text-[10px] text-red-400"
                title="Remove"
              >
                ✕
              </button>
            )}

            {isFolder && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(categoryKey, fullPath, isFolder);
                }}
                className="p-1 hover:bg-red-600/50 rounded text-[10px] text-red-400"
                title="Delete"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        
        {/* Children and Public Files */}
        {isFolder && effectiveExpanded && hasChildren && (
          <div className="border-l-2 border-slate-600 ml-2">
            {/* Render public files first */}
            {folderPublicFiles.map((file) => (
              <PublicFileItem 
                key={file.path}
                file={file}
                categoryKey={categoryKey}
                nodeKey={nodeKey}
                onStatusChange={handleStatusChange}
                metadata={metadata}
                depth={depth}
              />
            ))}
            {/* Then render children */}
            {Object.entries(node.children || {}).map(([k, v]) => 
              renderNode(v, k, fullPath, categoryKey, isNCR, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };
  
  if (!metadata || !stats) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        <div className="text-white">Loading QA/QC Module...</div>
      </div>
    );
  }
  
  const currentCategory = metadata.tree[selectedCategory];
  const isNCR = currentCategory?.isNCR;
  
  return (
    <div className="fixed inset-0 bg-slate-900 flex flex-col">
      {/* Title bar - same as other modules, with hamburger button */}
      <div className="w-full border-0 bg-[#0b1220] py-3 text-center text-lg font-black uppercase tracking-[0.22em] text-slate-200 relative">
        {/* Hamburger button positioned at left */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 z-[1200]">
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('toggleHamburgerMenu'));
            }}
            aria-label="Mode"
            className="inline-flex h-10 w-10 items-center justify-center border-2 border-slate-700 bg-slate-900 text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
        </div>
        QA / QC – Docs & Status
      </div>
      
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
        accept="*/*"
      />
      
      <div className="flex-1 flex overflow-hidden px-32">
      
      {/* MAIN AREA - Categories + Tree Explorer */}
      <div className="flex-1 flex flex-col min-w-0 border-r-2 border-slate-700">
        {/* Categories row inside the main column */}
        <div className="flex-shrink-0 border-b-2 border-slate-700 bg-slate-900/80 overflow-x-auto">
          <div className="flex items-center px-3 py-2 gap-1">
            {Object.entries(metadata.tree).map(([key, category]) => {
              const catStats = stats?.[key] || { done: 0, total: 0, percentage: 0 };
              return (
                <div key={key} className="relative flex-shrink-0 group">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(key)}
                    className={`px-4 py-3 flex items-center gap-2 text-left transition-colors rounded-none ${
                      selectedCategory === key 
                        ? 'bg-amber-500/20 border border-amber-500 text-amber-400' 
                        : 'text-slate-300 hover:bg-slate-800 border border-transparent'
                    }`}
                  >
                    <CategoryIcon category={key} />
                    <div>
                      <div className="text-[13px] font-medium">{category.label}</div>
                      <div className="text-[10px] text-slate-500">
                        {catStats.done}/{catStats.total} ({catStats.percentage}%)
                      </div>
                    </div>
                  </button>

                  {/* Edit category (rename/delete) - overlay, does not affect layout */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditCategory(key);
                    }}
                    className={`absolute top-1 right-1 h-4 w-4 flex items-center justify-center rounded text-[10px] transition-opacity ${
                      selectedCategory === key
                        ? 'text-amber-300 opacity-100'
                        : 'text-slate-400 opacity-0 group-hover:opacity-100'
                    } hover:bg-slate-700`}
                    title="Edit category"
                  >
                    ✎
                  </button>
                </div>
              );
            })}
            {/* Add new category button */}
            <button
              type="button"
              onClick={() => setNewCategoryModal(true)}
              className="flex-shrink-0 px-4 py-3 flex items-center justify-center transition-colors rounded-none text-slate-400 hover:bg-slate-700 hover:text-white border border-dashed border-slate-600 hover:border-amber-500"
              title="Add new category"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Tree Explorer Header */}
        <div className="p-4 border-b-2 border-slate-700 flex items-center gap-3">
          {/* Search - global across all categories */}
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search all categories..."
              className="w-full bg-slate-800 border border-slate-600 rounded-none px-3 py-2 text-[12px] text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>
          
          {/* Add buttons */}
          <button
            type="button"
            onClick={() => {
              const targetPath =
                selectedContainer?.categoryKey === selectedCategory
                  ? selectedContainer.path
                  : [];
              if (targetPath.length > 0) {
                triggerUpload({ type: 'folder', category: selectedCategory, path: targetPath });
              } else {
                triggerUpload({ type: 'category', category: selectedCategory });
              }
            }}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wide rounded-none"
          >
            + Upload
          </button>
          
          <button
            type="button"
            onClick={() => {
              const targetPath =
                selectedContainer?.categoryKey === selectedCategory
                  ? selectedContainer.path
                  : [];
              setNewFolderParent({ category: selectedCategory, path: targetPath });
            }}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold uppercase tracking-wide rounded-none"
          >
            + Folder
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3">
          {searchLower ? (
            <>
              {Object.entries(metadata.tree || {}).map(([catKey, catData]) => {
                const catIsNCR = !!catData?.isNCR;
                const childEntries = Object.entries(catData?.children || {});
                const hasChildMatch = childEntries.some(([k, v]) =>
                  nodeOrDescendantMatchesSearch(v, k, catKey)
                );

                const rootPublic = publicFiles?.[catKey]?.[catKey] || [];
                const rootPublicMatches = rootPublic.filter((f) =>
                  (f.name || '').toLowerCase().includes(searchLower)
                );

                if (!hasChildMatch && rootPublicMatches.length === 0) return null;

                return (
                  <div key={catKey} className="mb-4">
                    <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wide mb-2 px-2 py-1 bg-slate-700/30 rounded">
                      {catData?.label || catKey}
                    </div>

                    {rootPublicMatches.map((file) => (
                      <PublicFileItem
                        key={file.path}
                        file={file}
                        categoryKey={catKey}
                        nodeKey={catKey}
                        onStatusChange={handleStatusChange}
                        metadata={metadata}
                        depth={-1}
                      />
                    ))}

                    {childEntries.map(([k, v]) => renderNode(v, k, [], catKey, catIsNCR))}
                  </div>
                );
              })}
            </>
          ) : (
            <>
              {/* Show public files directly in category (for NCRs, ThirdParty) */}
              {publicFiles[selectedCategory]?.[selectedCategory]?.map((file) => (
                <PublicFileItem 
                  key={file.path}
                  file={file}
                  categoryKey={selectedCategory}
                  nodeKey={selectedCategory}
                  onStatusChange={handleStatusChange}
                  metadata={metadata}
                  depth={-1}
                />
              ))}

              {currentCategory?.children &&
                Object.entries(currentCategory.children).map(([k, v]) =>
                  renderNode(v, k, [], selectedCategory, isNCR)
                )}

              {(!currentCategory?.children || Object.keys(currentCategory.children).length === 0) &&
                !publicFiles[selectedCategory]?.[selectedCategory]?.length && (
                  <div className="text-center text-slate-500 text-[12px] py-8">
                    {selectedCategory === 'Random' ? (
                      <div>
                        <p className="mb-2">No folders or documents yet.</p>
                        <p>
                          Click <span className="text-amber-400 font-bold">"+ Folder"</span> to create a folder or{' '}
                          <span className="text-emerald-400 font-bold">"+ Upload"</span> to add files.
                        </p>
                      </div>
                    ) : (
                      'No documents yet. Click "Upload" to add documents.'
                    )}
                  </div>
                )}
            </>
          )}
        </div>
      </div>
      
      {/* RIGHT COLUMN - Overall Panel */}
      <div className="w-72 flex-shrink-0 bg-slate-800/50 flex flex-col">
        <div className="h-[78px] px-3 border-b-2 border-slate-700 flex items-center justify-center">
          <h2 className="text-[16px] font-bold text-white text-center">Overall Status</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Overall completion - three status percentages */}
          <div className="mb-5 p-4 bg-slate-700/50 rounded-none">
            <div className="flex justify-between items-center mb-3">
              <div className="text-center flex-1">
                <div className="text-[18px] font-medium text-emerald-400">{stats.overall.percentage}%</div>
                <div className="mt-1 inline-block px-2 py-0.5 bg-slate-800/60 border border-slate-600/50 rounded-none text-[9px] text-slate-300">
                  Completed
                </div>
              </div>
              <div className="text-center flex-1">
                <div className="text-[18px] font-medium text-amber-400">{stats.overall.inProgressPercentage}%</div>
                <div className="mt-1 inline-block px-2 py-0.5 bg-slate-800/60 border border-slate-600/50 rounded-none text-[9px] text-slate-300">
                  In Progress
                </div>
              </div>
              <div className="text-center flex-1">
                <div className="text-[18px] font-medium text-red-400">{stats.overall.incompletePercentage}%</div>
                <div className="mt-1 inline-block px-2 py-0.5 bg-slate-800/60 border border-slate-600/50 rounded-none text-[9px] text-slate-300">
                  Incomplete
                </div>
              </div>
            </div>
            <div className="text-center text-[10px] text-slate-400">
              {stats.overall.done} completed, {stats.overall.inProgress} in progress,{' '}
              {stats.overall.total - stats.overall.done - stats.overall.inProgress} incomplete
            </div>
          </div>

          <div className="p-3 bg-slate-700/30 rounded-none border border-slate-600/50">
            <CompletionBar
              label="ITPs"
              done={stats.ITPs.done}
              total={stats.ITPs.total}
              percentage={stats.ITPs.percentage}
              color="#22c55e"
            />
            <CompletionBar
              label="Checklists"
              done={stats.Checklists.done}
              total={stats.Checklists.total}
              percentage={stats.Checklists.percentage}
              color="#8b5cf6"
            />
            <CompletionBar
              label="NCR Closure"
              done={stats.NCRs.done}
              total={stats.NCRs.total}
              percentage={stats.NCRs.percentage}
              color="#f59e0b"
            />
            <CompletionBar
              label="Third Party"
              done={stats.ThirdParty.done}
              total={stats.ThirdParty.total}
              percentage={stats.ThirdParty.percentage}
              color="#ec4899"
            />
            <CompletionBar
              label="Random"
              done={stats.Random.done}
              total={stats.Random.total}
              percentage={stats.Random.percentage}
              color="#6366f1"
            />
          </div>
        </div>
      </div>
      
      {/* New Folder Modal */}
      {newFolderParent && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setNewFolderParent(null)}>
          <div className="bg-slate-800 border-2 border-slate-600 p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-[14px] font-bold text-white mb-4">Create New Folder</h3>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name..."
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-[12px] text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setNewFolderParent(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-bold uppercase rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-[11px] font-bold uppercase rounded"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* New Category Modal */}
      {newCategoryModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setNewCategoryModal(false)}>
          <div className="bg-slate-800 border-2 border-slate-600 p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-[14px] font-bold text-white mb-4">Create New Category</h3>
            <p className="text-[11px] text-slate-400 mb-3">This will add a new tab next to ITPs, Checklists, etc.</p>
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Category name..."
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-[12px] text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setNewCategoryModal(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-bold uppercase rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCategory}
                disabled={!newCategoryName.trim()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-[11px] font-bold uppercase rounded"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Category Modal */}
      {editCategoryModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setEditCategoryModal(null)}>
          <div className="bg-slate-800 border-2 border-slate-600 p-6 w-96" onClick={e => e.stopPropagation()}>
            <h3 className="text-[14px] font-bold text-white mb-4">Edit Category</h3>
            <input
              type="text"
              value={editCategoryName}
              onChange={(e) => setEditCategoryName(e.target.value)}
              placeholder="Category name..."
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-[12px] text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 mb-3"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleRenameCategory()}
            />
            {editCategoryModal.fixed && (
              <div className="text-[11px] text-slate-400 mb-3">
                This is a system category. You can rename it, but you cannot delete it.
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleDeleteCategory}
                disabled={editCategoryModal.fixed}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-[11px] font-bold uppercase rounded"
              >
                Delete
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditCategoryModal(null)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-bold uppercase rounded"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleRenameCategory}
                  disabled={!editCategoryName.trim()}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-[11px] font-bold uppercase rounded"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Preview Modal */}
      {previewFile && previewUrl && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={closePreview}>
          <div className="bg-slate-800 border-2 border-slate-600 max-w-4xl max-h-[90vh] w-full m-4 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-600 flex items-center justify-between">
              <h3 className="text-[13px] font-bold text-white truncate">{previewFile.name}</h3>
              <div className="flex items-center gap-2">
                <a
                  href={previewUrl}
                  download={previewFile.name}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold uppercase rounded"
                >
                  Download
                </a>
                <button
                  onClick={closePreview}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold uppercase rounded"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-900/50">
              {previewFile.type?.includes('pdf') ? (
                <iframe src={previewUrl} className="w-full h-full min-h-[60vh]" />
              ) : previewFile.type?.startsWith('image/') ? (
                <img src={previewUrl} alt={previewFile.name} className="max-w-full max-h-[70vh] object-contain" />
              ) : (
                <div className="text-center text-slate-400">
                  <p className="text-[14px] mb-4">Preview not available for this file type.</p>
                  <a
                    href={previewUrl}
                    download={previewFile.name}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold uppercase rounded inline-block"
                  >
                    Download File
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
