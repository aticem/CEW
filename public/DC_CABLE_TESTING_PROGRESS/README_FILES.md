## DC_CABLE_TESTING_PROGRESS

Place your GeoJSON files in this folder. The app will load them when you select the **DC_CABLE_TESTING_PROGRESS** module.

### Expected files (you can replace these placeholders)
- `full.geojson`: tables/boundary polygons (FeatureCollection)
- `string_text.geojson`: text labels (FeatureCollection of Points with `properties.text` + optional `properties.angle`)
- `inv_id.geojson`: inverter ID points (FeatureCollection of Points with `properties.text` or `properties.inv_id`)
- `lv_box.geojson`: optional boundary boxes (FeatureCollection)
- `link`: optional DWG/link text file (single line URL/path)

### Notes
- All files must be valid JSON (GeoJSON FeatureCollection).
- If a file is missing, the app will simply skip it.


