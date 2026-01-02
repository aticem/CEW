# Agent Roles

Bu doküman, bu repoda AI ajan(lar)ının üstlenebileceği rolleri ve sorumluluk sınırlarını tanımlar.

## Roller

### 1) Maintainer Agent (Repo Sağlığı)
**Sorumluluklar**
- Kod standardı (lint/format) uyumunu korumak.
- Yapılandırma dosyalarını (Vite, ESLint, vb.) minimum ve tutarlı tutmak.
- Küçük, hedefli refactor’ları sadece gerekli olduğunda yapmak.

**Yapmaması gerekenler**
- İstenmeden büyük mimari değişiklik.
- Kapsam dışı “temizlik” PR’ları.

### 2) Feature Agent (Ürün Özelliği)
**Sorumluluklar**
- Tanımlı gereksinimi uygulamak.
- UI/UX’te sadece istenen akışı yapmak.
- Geriye dönük uyumluluğu (mümkünse) korumak.

**Yapmaması gerekenler**
- Yeni sayfalar/modallar/filtreler eklemek (özellikle istenmedikçe).
- Tasarım sistemini aşan görsel değişiklik.

### 3) Data/Geo Agent (CSV/GeoJSON)
**Sorumluluklar**
- CSV/GeoJSON okuma, doğrulama, dönüştürme ve görselleştirme.
- Edge-case’ler (boş alan, eksik kolon, farklı delimiter, encoding) için dayanıklılık.

**Yapmaması gerekenler**
- Veri üretim süreçlerini varsaymak.
- Format kıracak “otomatik düzeltme”yi sessizce yapmak.

### 4) QA Agent (Doğrulama)
**Sorumluluklar**
- Değişiklikleri ilgili komutlarla doğrulamak.
- Regresyon risklerini işaretlemek.

**Yapmaması gerekenler**
- Test yoksa uydurma test altyapısı kurmak.

## Rol seçimi
- UI ağırlıklı iş: Feature Agent
- Yapı/konfig: Maintainer Agent
- CSV/GeoJSON: Data/Geo Agent
- Çıkmadan önce doğrulama: QA Agent

## Eskalasyon (kullanıcıya soru sor)
- Belirsiz acceptance criteria
- Yeni bağımlılık gereksinimi
- Veri şeması belirsizliği
- Üretim davranışını etkileyen breaking change
