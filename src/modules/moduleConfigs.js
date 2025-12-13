export const DC_MODULE_CONFIG = {
  key: 'DC',
  label: 'DC CABLE PULLING PROGRESS TRACKING',
  csvFormat: 'dc',
  csvPath: '/dc-cable-pulling-progress/dc_strings.csv',
  linkPath: '/dc-cable-pulling-progress/link',
  stringTextVisibility: 'always', // 'always' | 'hover' | 'none'
  stringTextToggle: false,
  stringTextDefaultOn: true,
  geojsonFiles: [
    { url: '/dc-cable-pulling-progress/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/dc-cable-pulling-progress/string_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
    { url: '/dc-cable-pulling-progress/inv_id.geojson', name: 'inv_id', color: '#16a34a', fillColor: '#22c55e' },
    {
      url: '/dc-cable-pulling-progress/lv_box.geojson',
      name: 'lv_box',
      color: '#eab308',
      fillColor: '#facc15',
      weight: 3,
      fillOpacity: 0.6,
    },
  ],
};

export const LV_MODULE_CONFIG = {
  key: 'LV',
  label: 'LV CABLE PULLING PROGRESS TRACKING',
  csvFormat: 'lv',
  csvPath: '/LV_CABLE_PULLING _PROGRESS_TRACKING/lv_pulling.csv',
  linkPath: '/LV_CABLE_PULLING _PROGRESS_TRACKING/link',
  stringTextVisibility: 'cursor', // show only near cursor position
  stringTextToggle: true,
  stringTextDefaultOn: false,
  geojsonFiles: [
    { url: '/LV_CABLE_PULLING _PROGRESS_TRACKING/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/LV_CABLE_PULLING _PROGRESS_TRACKING/string_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
    { url: '/LV_CABLE_PULLING _PROGRESS_TRACKING/inv_id.geojson', name: 'inv_id', color: '#16a34a', fillColor: '#22c55e' },
    {
      url: '/LV_CABLE_PULLING _PROGRESS_TRACKING/lv_box.geojson',
      name: 'lv_box',
      color: '#eab308',
      fillColor: '#facc15',
      weight: 3,
      fillOpacity: 0.6,
    },
  ],
};


