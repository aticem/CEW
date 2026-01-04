export function chunkDrawingStub(file) {
  // MVP: drawing OCR yok, ölçüleri “çıkaramıyoruz”.
  // Yine de legend/başlık gibi metin parçalarını temsil edelim.
  return [
    {
      chunkId: `${file.id}::drawing::legend_stub`,
      docId: file.id,
      docName: file.name,
      docType: file.classification.docType,
      folder: file.path,
      page: 1,
      sectionTitle: "Legend (stub)",
      text: "Stub legend: S = auxiliary services, C = communications, J = combined (to be replaced by real extraction)",
      source: {
        kind: "drive",
        path: file.path + file.name,
        updatedAt: file.updatedAt,
      },
      flags: ["LIMITED_SUPPORT_NO_OCR"],
    },
  ];
}
