INGEST FLOW’UN AMACI

Ingest Flow’un amacı:

Google Drive’daki doğru dokümanları

kontrollü, tekrar edilebilir ve izlenebilir şekilde

AI’nin sorgulayabileceği hale getirmek

Bu aşamada:

yorum yok

hesap yok

AI cevap üretmez

Ingest sadece şunu yapar:

“Bu doküman var, içeriği bu, kaynağı burası.”

2️⃣ INGEST NE ZAMAN ÇALIŞIR? (MVP)
MVP Kararı (Bilinçli)

Ingest otomatik tetiklenmez

manuel tetiklenir

Örnek:

“Dokümanları güncelledim”

“Yeni QAQC ekledim”

➡️ Sonra ingest çalıştırılır.

📌 Sebep:

Debug kolaylığı

Versiyon karmaşası yok

“AI niye eskiyi okudu?” sorusu yok

3️⃣ DRIVE TARAFINDA BAŞLANGIÇ NOKTASI

AI sadece tek bir root klasörü görür:

CEW_AI/


Bu klasör dışındaki hiçbir şeye bakılmaz.

Alt klasörler (MVP):

CEW_AI/
├─ Specifications/
├─ Manuals/
├─ QAQC/
├─ BOM_BOQ/
├─ Drawings/
└─ Legends/


Bu klasör yapısı:

sabit

bilinen

routing için ipucu

4️⃣ INGEST ADIM ADIM NE YAPAR?
🔹 Adım 1 — Dosya Listeleme

Drive API ile:

Root klasör altındaki tüm dosyalar listelenir

Her dosya için:

Dosya adı

Uzantı

Drive path

Son güncelleme tarihi alınır

Henüz:

İçerik okunmaz

Parse edilmez

🔹 Adım 2 — Doküman Türü Tanıma

Her dosya bir tipe atanır:

Uzantı	Tür
.pdf	PDF_TEXT / PDF_DRAWING / SCANNED_PDF
.xlsx	EXCEL_BOM
.xls	EXCEL_BOM
Diğer	UNSUPPORTED

⚠️ Bu ayrım kritik.
AI’nin davranışı buradan şekillenir.

🔹 Adım 3 — PDF Ayrımı (Çok Önemli)

PDF dosyaları 3 gruba ayrılır:

1️⃣ PDF_TEXT

Metin extract edilebiliyor

Spesifikasyon, manual, QAQC

➡️ Tam destek

2️⃣ PDF_DRAWING

Çizim ağırlıklı

Legend / başlık metni var

Ölçüler çoğunlukla görsel

➡️ Sınırlı destek

3️⃣ SCANNED_PDF

Metin extract edilemiyor

Görsel bazlı

➡️ MVP’de dışarıda
➡️ Flag: OCR_REQUIRED

🔹 Adım 4 — İçerik Okuma & Parçalama (Chunking)
PDF_TEXT için:

Sayfa bazlı okuma

Başlıklar algılanır (varsa)

İçerik anlamlı parçalara bölünür

Her parça şunları taşır:

Doküman adı

Sayfa numarası

Bölüm başlığı (varsa)

Kaynak path

📌 Amaç:

AI “nereden okuduğunu” bilsin.

EXCEL_BOM için:

Her sheet ayrı ele alınır

Her satır:

Sheet adı

Satır numarası

Item description

Quantity / Unit

➡️ Her satır bir bilgi parçasıdır

PDF_DRAWING için:

Metin olan alanlar alınır:

Section adı

Legend açıklamaları

Görsel ölçüler:

okunmaz

tahmin edilmez

🔹 Adım 5 — Metadata Oluşturma

Her bilgi parçası şu metadata’yı taşır:

doc_name

doc_type

folder (Manuals, Specs, etc.)

page (PDF)

section

sheet (Excel)

updated_at

Bu metadata:

Source gösterimi

Guard kontrolü

Debug için altın değerindedir

🔹 Adım 6 — Index’e Ekleme

Her parça index’e eklenir

Eski versiyon varsa:

Güncellenir

Veya işaretlenir (outdated)

📌 MVP’de:

“Incremental update” basit tutulur

Karmaşık versioning yok

5️⃣ INGEST SÜRECİNDE ASLA YAPILMAYACAKLAR

❌ Tahmin
❌ Ölçü hesaplama
❌ Çizim yorumlama
❌ Doküman değiştirme
❌ Doküman upload etme

Ingest = okuma & düzenleme, başka bir şey değil.

6️⃣ INGEST’İN AI DAVRANIŞINA ETKİSİ

Bu akış sayesinde:

AI:

“Bu bilgi nereden?” sorusunu her zaman cevaplar

Drawing sorularında:

“Metin yok” diyebilir

Excel sorularında:

Sheet bazlı net cevap verir

7️⃣ MVP İÇİN BİLİNÇLİ SINIRLAR

OCR yok

DWG yok

Auto-ingest yok

Multi-project yok

Ama:

İlk MVP sahada çalışır