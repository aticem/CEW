# PARAMETER_and_TABLE_EARTHING_PROGRESS

Bu klasöre aşağıdaki GeoJSON dosyalarını ekleyin:

## Gerekli Dosyalar

1. **full.geojson** - Tüm tabloların/parametrelerin ana geometri dosyası (Polygon/MultiPolygon)
2. **inv_id.geojson** - Inverter ID etiketleri (Point geometriler, "name" property ile)
3. **inv_box.geojson** - Inverter box sınır çizgileri (Polygon/LineString)

## Opsiyonel Dosyalar

- **string_text.geojson** - String etiketleri (Point geometriler)
- **subs_text.geojson** - Alt istasyon etiketleri

## GeoJSON Formatı

Her dosya standart GeoJSON formatında olmalıdır:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "örnek_isim"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [...]
      }
    }
  ]
}
```

## Notlar

- Koordinatlar WGS84 (EPSG:4326) formatında olmalıdır
- "name" property'si etiketleme için kullanılır
