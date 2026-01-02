# MVP Scope

Bu doküman, repoda AI ile yapılacak işlerde "MVP" kapsamını netleştirmek için vardır.

## MVP hedefi
- Mevcut uygulamayı bozmayacak şekilde, ihtiyaç duyulan en küçük özellik setini teslim etmek.
- Karmaşıklık ve bakım maliyetini düşük tutmak.

## MVP kapsamında (varsayılan)
- Var olan ekran/akış içinde küçük UI iyileştirmeleri
- Hata düzeltmeleri (bugfix)
- Veri okuma/parse iyileştirmeleri (CSV/GeoJSON)
- Performans için küçük optimizasyonlar (ölçülü)
- Basit dokümantasyon eklemeleri (bu klasör gibi)

## MVP kapsamında değil (açıkça istenmedikçe)
- Yeni sayfa, yeni modül, yeni büyük özellik alanı
- Yeni tasarım sistemi, yeni tema, büyük görsel revamp
- Büyük refactor / mimari yeniden yazım
- Yeni backend/servis, auth sistemi, deployment altyapısı
- Kapsamlı test altyapısı kurulumu (mevcutta yoksa)

## Kabul kriteri (her iş için)
- "Ne değişti?" net olmalı.
- Kullanıcı akışı bozulmamalı.
- Hata durumları ele alınmalı (en azından güvenli fallback).

## Çıkış kontrol listesi
- Lint/build komutları çalışıyorsa: en az birini çalıştır
- Konsolda kritik error yok
- Feature/bugfix istenen senaryoda çalışıyor
