/**
 * Google Drive Adapter — Drive'dan dosya listesi ve indirme
 * 
 * Senin Drive linkin: https://drive.google.com/drive/folders/18BSaPrbfyXIe-w4qGrO6-PmQrdwrIpGc
 */

const DRIVE_FOLDER_ID = "18BSaPrbfyXIe-w4qGrO6-PmQrdwrIpGc";

export const SUPPORTED_MIMES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls"
};

export async function listDriveFiles() {
  // TODO: Google Drive API implementasyonu
  throw new Error("DRIVE_NOT_IMPLEMENTED");
}

export async function downloadFile(fileId) {
  // TODO: Google Drive API implementasyonu
  throw new Error("DRIVE_NOT_IMPLEMENTED");
}

export async function getChangedFiles(lastSyncToken = null) {
  // TODO: Drive Changes API - incremental sync için
  throw new Error("DRIVE_NOT_IMPLEMENTED");
}

export function isDriveConfigured() {
  return false;
}

export const DRIVE_CONFIG = {
  folderId: DRIVE_FOLDER_ID,
  folderUrl: `https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`,
  scopes: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.metadata.readonly"
  ],
  supportedTypes: Object.keys(SUPPORTED_MIMES)
};
