export function chunkExcelStub(file) {
  // Şimdilik gerçek Excel okumuyoruz.
  // Formatı sabitlemek için 2 satır örneği üretelim.
  return [
    {
      chunkId: `${file.id}::sheet_MVConnectors::row_12`,
      docId: file.id,
      docName: file.name,
      docType: file.classification.docType,
      folder: file.path,
      sheetName: "MV Connectors (stub)",
      rowNumber: 12,
      text: "Stub row: 19/33kV connector for 240mm2 Al cable, qty 10 (to be replaced by real extraction)",
      source: {
        kind: "drive",
        path: file.path + file.name,
        updatedAt: file.updatedAt,
      },
    },
    {
      chunkId: `${file.id}::sheet_MVConnectors::row_13`,
      docId: file.id,
      docName: file.name,
      docType: file.classification.docType,
      folder: file.path,
      sheetName: "MV Connectors (stub)",
      rowNumber: 13,
      text: "Stub row: heat shrink kit, qty 10 (to be replaced by real extraction)",
      source: {
        kind: "drive",
        path: file.path + file.name,
        updatedAt: file.updatedAt,
      },
    },
  ];
}
