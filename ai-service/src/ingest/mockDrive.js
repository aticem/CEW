export function listMockDriveFiles() {
  // Bu listeyi senin gerçek dosya isimlerinle değiştirebilirsin.
  // Şimdilik sadece pipeline'ı test etmek için.
  return [
    {
      id: "drv_002",
      name: "BOM_BOQ_MV_Connectors.xlsx",
      path: "CEW_AI/BOM_BOQ/",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      updatedAt: "2026-01-03T19:00:00Z",
      sizeBytes: 4_200_000,
    },
    {
      id: "drv_003",
      name: "Trench_Sections_Crossings_Set.pdf",
      path: "CEW_AI/Drawings/",
      mime: "application/pdf",
      updatedAt: "2026-01-02T08:30:00Z",
      sizeBytes: 95_000_000,
    },
    {
      id: "drv_004",
      name: "QAQC_ITP_Electrical.pdf",
      path: "CEW_AI/QAQC/",
      mime: "application/pdf",
      updatedAt: "2026-01-01T12:15:00Z",
      sizeBytes: 12_000_000,
    },
    {
      id: "drv_005",
      name: "Technical description_Rev01.docx",
      path: "CEW_AI/Specifications/",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      updatedAt: "2026-01-05T09:00:00Z",
      sizeBytes: 900_000,
      localPath: "sample/Technical Description_Rev01.docx",
    },
  ];
}
