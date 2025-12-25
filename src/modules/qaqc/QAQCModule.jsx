import { useState, useCallback, useRef, useMemo } from 'react';
import { DOC_STATUSES, NCR_STATUSES, generateId } from './schema.js';
import { 
  initializeMetadata, 
  getMetadata, 
  addDocument, 
  updateDocSlot, 
  updateStatus, 
  deleteDocument,
  createFolder,
  deleteFolder,
  calculateStats 
} from './metadataStorage.js';
import { saveFile, deleteFile, getFileUrl } from './fileStorage.js';

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
      className={`${small ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px]'} font-bold uppercase tracking-wide rounded cursor-pointer hover:opacity-80 transition-opacity`}
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
      <span className="text-[11px] font-medium text-slate-300">{label}</span>
      <span className="text-[11px] font-bold text-white">{done}/{total} ({percentage}%)</span>
    </div>
    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
      <div 
        className="h-full transition-all duration-300 rounded-full"
        style={{ width: `${percentage}%`, backgroundColor: color }}
      />
    </div>
  </div>
);

export default function QAQCModule() {
  const [metadata, setMetadata] = useState(() => initializeMetadata());
  const [selectedCategory, setSelectedCategory] = useState('ITPs');
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);
  const [uploadTarget, setUploadTarget] = useState(null);
  const [newFolderParent, setNewFolderParent] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  
  // Calculate stats from metadata
  const stats = useMemo(() => calculateStats(metadata), [metadata]);
  
  const refreshMetadata = useCallback(() => {
    const meta = getMetadata();
    setMetadata(meta);
  }, []);
  
  // Toggle folder expand/collapse
  const toggleExpand = useCallback((nodeId) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);
  
  // Handle file upload
  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTarget) return;
    
    try {
      const fileId = generateId();
      await saveFile(fileId, file);
      
      const docData = {
        fileId,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        uploadedAt: Date.now(),
        name: file.name,
      };
      
      if (uploadTarget.type === 'slot') {
        updateDocSlot(uploadTarget.category, uploadTarget.slotKey, docData);
      } else if (uploadTarget.type === 'folder') {
        addDocument(uploadTarget.category, uploadTarget.path, docData);
      } else if (uploadTarget.type === 'category') {
        addDocument(uploadTarget.category, [], docData);
      }
      
      refreshMetadata();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload file');
    }
    
    setUploadTarget(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [uploadTarget, refreshMetadata]);
  
  // Handle status change
  const handleStatusChange = useCallback((categoryKey, path, newStatus) => {
    updateStatus(categoryKey, path, newStatus);
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
    createFolder(newFolderParent.category, newFolderParent.path, newFolderName.trim());
    refreshMetadata();
    setNewFolderParent(null);
    setNewFolderName('');
  }, [newFolderParent, newFolderName, refreshMetadata]);
  
  // Trigger file input
  const triggerUpload = useCallback((target) => {
    setUploadTarget(target);
    fileInputRef.current?.click();
  }, []);
  
  // Render tree node
  const renderNode = (node, nodeKey, path, categoryKey, isNCR = false, depth = 0) => {
    const fullPath = [...path, nodeKey];
    const nodeId = `${categoryKey}-${fullPath.join('-')}`;
    const isExpanded = expandedNodes.has(nodeId);
    const hasChildren = node.children && Object.keys(node.children).length > 0;
    const isFolder = node.type === 'folder';
    const isDocSlot = node.type === 'doc-slot';
    const isDocument = node.type === 'document';
    
    // Search filter
    if (searchQuery && !node.label?.toLowerCase().includes(searchQuery.toLowerCase())) {
      if (!hasChildren) return null;
      // Check if any children match
      const childrenMatch = Object.entries(node.children || {}).some(([, v]) => 
        v.label?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      if (!childrenMatch) return null;
    }
    
    return (
      <div key={nodeKey} className="select-none">
        <div 
          className={`flex items-center gap-2 py-1.5 px-2 hover:bg-slate-700/50 rounded cursor-pointer group ${depth > 0 ? 'ml-4' : ''}`}
          onClick={() => isFolder && toggleExpand(nodeId)}
        >
          {/* Expand/collapse icon for folders */}
          {isFolder && (
            <span className="w-4 h-4 flex items-center justify-center text-slate-500">
              {hasChildren ? (isExpanded ? '▼' : '▶') : '○'}
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
          
          {/* Label */}
          <span className={`flex-1 text-[12px] ${node.fileId ? 'text-white' : 'text-slate-400'}`}>
            {node.label}
            {isDocSlot && !node.fileId && <span className="text-red-400 ml-1">(required)</span>}
          </span>
          
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
            {/* Upload/Replace */}
            {(isDocSlot || isFolder || (isDocument && node.fileId)) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isDocSlot) {
                    triggerUpload({ type: 'slot', category: categoryKey, slotKey: nodeKey });
                  } else if (isFolder) {
                    triggerUpload({ type: 'folder', category: categoryKey, path: fullPath });
                  }
                }}
                className="p-1 hover:bg-slate-600 rounded text-[10px] text-slate-300"
                title={node.fileId ? 'Replace' : 'Upload'}
              >
                {node.fileId ? '↻' : '↑'}
              </button>
            )}
            
            {/* Preview */}
            {node.fileId && (
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
            
            {/* Delete (only for non-fixed items) */}
            {!node.fixed && (isDocument || (isFolder && !node.fixed)) && (
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
            
            {/* Add folder (only in Random or allowed folders) */}
            {isFolder && (node.allowFolderCreation || categoryKey === 'Random') && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setNewFolderParent({ category: categoryKey, path: fullPath });
                }}
                className="p-1 hover:bg-slate-600 rounded text-[10px] text-slate-300"
                title="New Folder"
              >
                +📁
              </button>
            )}
          </div>
        </div>
        
        {/* Children */}
        {isFolder && isExpanded && hasChildren && (
          <div className="border-l border-slate-700 ml-3">
            {Object.entries(node.children).map(([k, v]) => 
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
    <div className="fixed inset-0 bg-slate-900 flex">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
        accept="*/*"
      />
      
      {/* LEFT COLUMN - Categories */}
      <div className="w-56 flex-shrink-0 border-r-2 border-slate-700 bg-slate-900 flex flex-col">
        <div className="p-4 border-b-2 border-slate-700">
          <h1 className="text-[14px] font-bold text-white tracking-wide">QA / QC</h1>
          <p className="text-[10px] text-slate-400 mt-1">Docs & Status</p>
        </div>
        
        <div className="flex-1 overflow-y-auto py-2">
          {Object.entries(metadata.tree).map(([key, category]) => (
            <button
              key={key}
              onClick={() => setSelectedCategory(key)}
              className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors ${
                selectedCategory === key 
                  ? 'bg-amber-500/20 border-r-2 border-amber-500 text-amber-400' 
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <CategoryIcon category={key} />
              <div className="flex-1">
                <div className="text-[12px] font-medium">{category.label}</div>
                <div className="text-[10px] text-slate-500">
                  {stats[key].done}/{stats[key].total} ({stats[key].percentage}%)
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      
      {/* MIDDLE COLUMN - Tree Explorer */}
      <div className="flex-1 flex flex-col min-w-0 border-r-2 border-slate-700">
        <div className="p-4 border-b-2 border-slate-700 flex items-center gap-3">
          <h2 className="text-[13px] font-bold text-white flex-shrink-0">
            {currentCategory?.label}
          </h2>
          
          {/* Search */}
          <div className="flex-1 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>
          
          {/* Add buttons */}
          {(currentCategory?.allowMultiple || currentCategory?.isNCR) && (
            <button
              onClick={() => triggerUpload({ type: 'category', category: selectedCategory })}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wide rounded"
            >
              + Upload
            </button>
          )}
          
          {(currentCategory?.allowFolderCreation || selectedCategory === 'Random') && (
            <button
              onClick={() => setNewFolderParent({ category: selectedCategory, path: [] })}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold uppercase tracking-wide rounded"
            >
              + Folder
            </button>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto p-3">
          {currentCategory?.children && Object.entries(currentCategory.children).map(([k, v]) => 
            renderNode(v, k, [], selectedCategory, isNCR)
          )}
          
          {(!currentCategory?.children || Object.keys(currentCategory.children).length === 0) && (
            <div className="text-center text-slate-500 text-[12px] py-8">
              No documents yet. Click "Upload" to add documents.
            </div>
          )}
        </div>
      </div>
      
      {/* RIGHT COLUMN - Overall Panel */}
      <div className="w-72 flex-shrink-0 bg-slate-800/50 flex flex-col">
        <div className="p-4 border-b-2 border-slate-700">
          <h2 className="text-[13px] font-bold text-white">Overall Status</h2>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          {/* Overall completion */}
          <div className="mb-6 p-4 bg-slate-700/50 rounded-lg">
            <div className="text-center mb-3">
              <div className="text-[32px] font-black text-white">{stats.overall.percentage}%</div>
              <div className="text-[11px] text-slate-400">Overall Completion</div>
            </div>
            <div className="h-3 bg-slate-600 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-500"
                style={{ width: `${stats.overall.percentage}%` }}
              />
            </div>
            <div className="text-center mt-2 text-[11px] text-slate-400">
              {stats.overall.done} of {stats.overall.total} items complete
            </div>
          </div>
          
          {/* Per-category completion */}
          <div className="space-y-4">
            <CompletionBar 
              label="ITPs" 
              done={stats.ITPs.done} 
              total={stats.ITPs.total} 
              percentage={stats.ITPs.percentage}
              color="#3b82f6"
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
          
          {/* Missing docs indicator */}
          {stats.ITPs.total > 0 && stats.ITPs.done < stats.ITPs.total && (
            <div className="mt-6 p-3 bg-red-500/10 border border-red-500/30 rounded">
              <div className="text-[11px] font-bold text-red-400 mb-1">⚠ Missing Required Docs</div>
              <div className="text-[10px] text-red-300/70">
                {stats.ITPs.total - stats.ITPs.done} ITP document(s) not uploaded
              </div>
            </div>
          )}
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
                onClick={() => setNewFolderParent(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-bold uppercase rounded"
              >
                Cancel
              </button>
              <button
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
  );
}
