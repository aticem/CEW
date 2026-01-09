# AI Assistant Rules

Bu klasör, repo içinde AI ile çalışma kurallarını ve kapsamı standartlaştırır.

## 1) Amaç
- Geliştirme hızını artırmak.
- Tutarlı kararlar almak.
- Kapsam dışına taşmayı (scope creep) önlemek.

## 2) Varsayılan davranış
- **Önce mevcut yapıyı koru:** Var olan mimari, kod stili ve dosya organizasyonunu bozmadan ilerle.
- **Minimum değişiklik:** İstenen gereksinim için en küçük ve en güvenli değişikliği yap.
- **Tek sorumluluk:** Bir PR/commit’te tek konu; alakasız refactor yapma.

## 3) Çalışma şekli
- Değişiklik yapmadan önce:
  - Hedefi netleştir.
  - Etkilenecek dosyaları belirle.
  - Riskli/geri dönüşü zor adımları kullanıcıya sor.
- Değişiklik yaptıktan sonra:
  - Lint/test/build komutları varsa çalıştırmayı öner.
  - Hata çıkarsa ilgili kapsamda düzelt.

## 4) Kapsam ve sınırlar
- **MVP kapsamı** için [MVP_SCOPE.md](MVP_SCOPE.md) esas alınır.
- Belirsiz isteklerde varsayılan: **en basit yorum**.
- Yeni bağımlılık eklemek gerekiyorsa:
  - Gerekçeyi açıkla.
  - Alternatifleri belirt.

## 5) Kod kalitesi kuralları
- Public API’leri gerekmedikçe değiştirme.
- Hata mesajları anlaşılır ve aksiyon alınabilir olmalı.
- Veri formatları (CSV/GeoJSON) için:
  - Şema/alan adlarını sabit kabul etme; doğrulama yap.
  - Bozuk/veri eksikliği durumunda güvenli şekilde degrade et.

## 6) Güvenlik ve veri
- Gizli bilgi (token, anahtar, kişisel veri) loglama/commit etme.
- Örnek veri gerekiyorsa: anonimleştirilmiş/temsilî veri kullan.

## 7) İletişim
- Kısa ve net cevap ver.
- Yapılan değişiklikleri dosya bazında özetle.
- Engeller varsa net sorular sor (maksimum 1–3 soru).
