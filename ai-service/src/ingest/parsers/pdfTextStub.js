export function chunkPdfTextStub(file) {
  // Şimdilik gerçek PDF okumuyoruz.
  // Sadece chunk formatını sabitliyoruz.
  return [
    {
      chunkId: `${file.id}::p4::sec_tools`,
      docId: file.id,
      docName: file.name,
      docType: file.classification.docType,
      folder: file.path,
      page: 4,
      sectionTitle: "Recommended Equipment & Tools (stub)",
      text: "Stub text: torque wrench is recommended... (to be replaced by real extraction)",
      source: {
        kind: "drive",
        path: file.path + file.name,
        updatedAt: file.updatedAt,
      },
    },
  ];
}
