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
  invIdTextScale: 1.2, // smaller
  // LV inv_id text: grow by size (not weight) and remain readable when zoomed out
  invIdTextBaseSize: 16,
  invIdTextStyle: '400', // slimmer, not bold
  invIdTextMinFontSize: 10,
  invIdTextMaxFontSize: 18,
  invIdTextRefZoom: 20,
  invIdTextStrokeColor: 'rgba(0,0,0,0.65)',
  invIdTextStrokeWidthFactor: 1.0,
  // Add a square background plate behind inv_id so it doesn't blend into tables
  invIdTextBgColor: 'rgba(11,18,32,0.86)',
  invIdTextBgPaddingX: 5,
  invIdTextBgPaddingY: 2,
  invIdTextBgStrokeColor: 'rgba(255,255,255,0.35)',
  invIdTextBgStrokeWidth: 1,
  invIdTextBgCornerRadius: 0,
  // Completed inv_id highlight (make it really obvious on the map)
  invIdDoneTextColor: 'rgba(11,18,32,0.98)',
  invIdDoneTextColorNoBg: 'rgba(34,197,94,0.98)',
  invIdDoneBgColor: 'rgba(34,197,94,0.92)',
  invIdDoneBgStrokeColor: 'rgba(255,255,255,0.70)',
  invIdDoneBgStrokeWidth: 2,
  // Declutter: hide inv_id text/plate when zoomed out so it doesn't look like "soup"
  // Show text earlier (readable sooner), but only show the background plate when closer.
  invIdTextMinTextZoom: 16,
  invIdTextMinBgZoom: 18,
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

export const MV_FIBER_MODULE_CONFIG = {
  key: 'MVF',
  label: 'MV+FIBER PULLING PROGRESS TRACKING',
  // Files live in: public/MV+FIBER_PULLING_PROGRESS_TRACKING/
  csvFormat: 'mvf', // from,to,length CSV
  csvPath: '/MV+FIBER_PULLING_PROGRESS_TRACKING/mv_cable.csv',
  linkPath: '/MV+FIBER_PULLING_PROGRESS_TRACKING/link',
  // Text labels (subs_text) are small here; keep visible by default.
  stringTextVisibility: 'always',
  stringTextToggle: true,
  stringTextDefaultOn: true,
  simpleCounters: true,
  // subs_text styling (it is wired through the shared string_text renderer)
  stringTextColor: 'rgba(250,204,21,0.98)', // yellow
  stringTextBaseSize: 22, // bigger by size (not weight)
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0.85)',
  stringTextStrokeWidthFactor: 1.2,
  // Make subs_text readable even when zoomed out (clamped font size + no min-zoom gate)
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  geojsonFiles: [
    { url: '/MV+FIBER_PULLING_PROGRESS_TRACKING/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/MV+FIBER_PULLING_PROGRESS_TRACKING/mv_trench.geojson', name: 'mv_trench', color: '#eab308', fillColor: '#facc15' },
    { url: '/MV+FIBER_PULLING_PROGRESS_TRACKING/subs.geojson', name: 'subs', color: '#94a3b8', fillColor: '#94a3b8' },
    // Feed subs_text into the existing "string_text" rendering path (toggle + perf).
    { url: '/MV+FIBER_PULLING_PROGRESS_TRACKING/subs_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
  ],
};


