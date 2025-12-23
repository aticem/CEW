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
  // Files live in: public/MV_PULLING_PROGRESS_TRACKING/
  csvFormat: 'mvf', // from,to,length CSV
  csvPath: '/MV_PULLING_PROGRESS_TRACKING/mv_cable.csv',
  linkPath: '/MV_PULLING_PROGRESS_TRACKING/link',
  circuitsMultiplier: 3,
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
    { url: '/MV_PULLING_PROGRESS_TRACKING/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/MV_PULLING_PROGRESS_TRACKING/mv_trench.geojson', name: 'mv_trench', color: '#eab308', fillColor: '#facc15' },
    { url: '/MV_PULLING_PROGRESS_TRACKING/subs.geojson', name: 'subs', color: '#94a3b8', fillColor: '#94a3b8' },
    // Feed subs_text into the existing "string_text" rendering path (toggle + perf).
    { url: '/MV_PULLING_PROGRESS_TRACKING/subs_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
  ],
};

export const MV_FIBRE_TRENCH_PROGRESS_TRACKING_CONFIG = {
  key: 'MVFT',
  label: 'MV+FIBRE_TRENCH_PROGRESS_TRACKING',
  // Files live in: public/MV+FIBRE_TRENCH_PROGRESS_TRACKING/
  // This scaffold is GeoJSON-only by default (no CSV required).
  csvFormat: null,
  csvPath: null,
  linkPath: '/MV+FIBRE_TRENCH_PROGRESS_TRACKING/link',
  simpleCounters: true,
  simpleCounterUnit: 'm',
  submitWorkUnit: 'm excavated',
  // Render subs_text through shared string_text pipeline (toggle + perf)
  stringTextVisibility: 'always',
  stringTextToggle: true,
  stringTextDefaultOn: true,
  // Keep labels readable
  stringTextColor: 'rgba(250,204,21,0.98)',
  stringTextBaseSize: 22,
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0.85)',
  stringTextStrokeWidthFactor: 1.2,
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  geojsonFiles: [
    { url: '/MV+FIBRE_TRENCH_PROGRESS_TRACKING/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/MV+FIBRE_TRENCH_PROGRESS_TRACKING/mv_trench.geojson', name: 'mv_trench', color: '#eab308', fillColor: '#facc15' },
    { url: '/MV+FIBRE_TRENCH_PROGRESS_TRACKING/subs.geojson', name: 'subs', color: '#94a3b8', fillColor: '#94a3b8' },
    { url: '/MV+FIBRE_TRENCH_PROGRESS_TRACKING/subs_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
  ],
};

export const FIBRE_MODULE_CONFIG = {
  key: 'FIB',
  label: 'FIBRE PULLING PROGRESS TRACKING',
  // Files live in: public/FIBRE_PULLING_PROGRESS_TRACKING/
  csvFormat: 'mvf',
  csvPath: '/FIBRE_PULLING_PROGRESS_TRACKING/fibre_cable.csv',
  linkPath: '/FIBRE_PULLING_PROGRESS_TRACKING/link',
  circuitsMultiplier: 1,
  simpleCounters: true,
  stringTextVisibility: 'always',
  stringTextToggle: true,
  stringTextDefaultOn: true,
  stringTextColor: 'rgba(250,204,21,0.98)',
  stringTextBaseSize: 22,
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0.85)',
  stringTextStrokeWidthFactor: 1.2,
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  geojsonFiles: [
    { url: '/FIBRE_PULLING_PROGRESS_TRACKING/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/FIBRE_PULLING_PROGRESS_TRACKING/mv_trench.geojson', name: 'mv_trench', color: '#eab308', fillColor: '#facc15' },
    { url: '/FIBRE_PULLING_PROGRESS_TRACKING/subs.geojson', name: 'subs', color: '#94a3b8', fillColor: '#94a3b8' },
    { url: '/FIBRE_PULLING_PROGRESS_TRACKING/subs_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
  ],
};

export const MC4_MODULE_CONFIG = {
  key: 'MC4',
  label: 'MC4 INSTALLATION',
  // Files live in: public/MC4_INSTALLATION_AND_DC_TERMINATION_PROGRESS_TRACKING/
  csvFormat: 'mc4_strings',
  csvPath: '/MC4_INSTALLATION_AND_DC_TERMINATION_PROGRESS_TRACKING/dc_strings.csv',
  linkPath: '/MC4_INSTALLATION_AND_DC_TERMINATION_PROGRESS_TRACKING/link',
  // Spec: CSV contains 9056 strings -> total endpoints = 9056 * 2 = 18112
  mc4DefaultStrings: 9056,
  // Render inv_id points as LV-style text plates (visual only; not clickable completion).
  invIdLabelMode: true,
  // Match LV inv_id appearance
  invIdTextScale: 1.2,
  invIdTextBaseSize: 16,
  invIdTextStyle: '400',
  invIdTextMinFontSize: 10,
  invIdTextMaxFontSize: 18,
  invIdTextRefZoom: 20,
  invIdTextStrokeColor: 'rgba(0,0,0,0.65)',
  invIdTextStrokeWidthFactor: 1.0,
  invIdTextBgColor: 'rgba(11,18,32,0.86)',
  invIdTextBgPaddingX: 5,
  invIdTextBgPaddingY: 2,
  invIdTextBgStrokeColor: 'rgba(255,255,255,0.35)',
  invIdTextBgStrokeWidth: 1,
  invIdTextBgCornerRadius: 0,
  invIdTextMinTextZoom: 16,
  invIdTextMinBgZoom: 18,
  // MC4: render ONLY subs_text labels (we map subs_text.geojson to the shared string_text renderer).
  // We still do NOT include string_text.geojson in this mode.
  stringTextVisibility: 'always',
  stringTextToggle: false,
  stringTextDefaultOn: false,
  // subs_text styling
  stringTextColor: 'rgba(250,204,21,0.98)',
  stringTextBaseSize: 22,
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0.85)',
  stringTextStrokeWidthFactor: 1.2,
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  geojsonFiles: [
    {
      url: '/MC4_INSTALLATION_AND_DC_TERMINATION_PROGRESS_TRACKING/full.geojson',
      name: 'full',
      color: '#2563eb',
      fillColor: '#3b82f6',
    },
    // Feed subs_text into the existing "string_text" rendering path.
    { url: '/MC4_INSTALLATION_AND_DC_TERMINATION_PROGRESS_TRACKING/subs_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
    {
      url: '/MC4_INSTALLATION_AND_DC_TERMINATION_PROGRESS_TRACKING/subs.geojson',
      name: 'subs',
      color: '#94a3b8',
      fillColor: '#94a3b8',
    },
    {
      url: '/MC4_INSTALLATION_AND_DC_TERMINATION_PROGRESS_TRACKING/inv_id.geojson',
      name: 'inv_id',
      color: '#16a34a',
      fillColor: '#22c55e',
    },
    {
      url: '/MC4_INSTALLATION_AND_DC_TERMINATION_PROGRESS_TRACKING/lv_box.geojson',
      name: 'lv_box',
      color: '#eab308',
      fillColor: '#facc15',
      weight: 3,
      fillOpacity: 0.6,
    },
  ],
};

export const MV_TERMINATION_MODULE_CONFIG = {
  key: 'MVT',
  label: 'MV TERMINATION PROGRESS TRACKING',
  // Files live in: public/MV_TERMINATION_PROGRESS_TRACKING/
  csvFormat: null, // no CSV for now
  csvPath: null,
  linkPath: '/MV_TERMINATION_PROGRESS_TRACKING/link',
  simpleCounters: true,
  stringTextVisibility: 'always',
  stringTextToggle: true,
  stringTextDefaultOn: true,
  stringTextColor: 'rgba(255,255,255,0.98)',
  stringTextBaseSize: 22,
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0.85)',
  stringTextStrokeWidthFactor: 1.2,
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  geojsonFiles: [
    { url: '/MV_TERMINATION_PROGRESS_TRACKING/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/MV_TERMINATION_PROGRESS_TRACKING/mv_trench.geojson', name: 'mv_trench', color: '#eab308', fillColor: '#facc15' },
    { url: '/MV_TERMINATION_PROGRESS_TRACKING/subs.geojson', name: 'subs', color: '#94a3b8', fillColor: '#94a3b8' },
    { url: '/MV_TERMINATION_PROGRESS_TRACKING/subs_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
    { url: '/MV_TERMINATION_PROGRESS_TRACKING/mv_text.geojson', name: 'mv_text', color: '#22c55e', fillColor: '#22c55e' },
    { url: '/MV_TERMINATION_PROGRESS_TRACKING/arrow.geojson', name: 'arrow', color: '#f97316', fillColor: '#fb923c' },
  ],
};

export const LV_TERMINATION_AND_TESTING_MODULE_CONFIG = {
  key: 'LVTT',
  label: 'LV_TERMINATION_and_TESTING PROGRESS',
  // Files live in: public/LV_TERMINATION_and_TESTING PROGRESS/
  csvFormat: null,
  csvPath: '/LV_TERMINATION_and_TESTING PROGRESS/lv_testing.csv',
  linkPath: '/LV_TERMINATION_and_TESTING PROGRESS/link',
  simpleCounters: true,
  stringTextVisibility: 'always',
  stringTextToggle: true,
  stringTextDefaultOn: true,
  stringTextColor: 'rgba(255,255,255,0.98)',
  stringTextBaseSize: 22,
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0.85)',
  stringTextStrokeWidthFactor: 1.2,
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  // Enable inv_id labels in label mode (clickable for LVTT test popup)
  invIdLabelMode: true,
  invIdTextScale: 1,
  invIdTextBaseSize: 18,
  invIdTextRefZoom: 20,
  invIdTextStyle: '600',
  invIdTextMinFontSize: 10,
  invIdTextMaxFontSize: 24,
  invIdTextStrokeColor: 'rgba(0,0,0,0.88)',
  invIdTextStrokeWidthFactor: 1.45,
  geojsonFiles: [
    { url: '/LV_TERMINATION_and_TESTING PROGRESS/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    // Map subs_text.geojson into the shared string_text rendering path
    { url: '/LV_TERMINATION_and_TESTING PROGRESS/subs_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
    { url: '/LV_TERMINATION_and_TESTING PROGRESS/inv_id.geojson', name: 'inv_id', color: '#16a34a', fillColor: '#22c55e' },
    {
      // This dataset uses inv_box.geojson as the LV box/boundary layer
      url: '/LV_TERMINATION_and_TESTING PROGRESS/inv_box.geojson',
      name: 'lv_box',
      color: '#eab308',
      fillColor: '#facc15',
      weight: 3,
      fillOpacity: 0.6,
    },
  ],
};

export const DC_CABLE_TESTING_PROGRESS_MODULE_CONFIG = {
  key: 'DCCT',
  label: 'DC_CABLE_TESTING_PROGRESS',
  // DCCT uses dc_riso.csv for passed/failed testing data
  csvFormat: 'dcct_riso',
  csvPath: '/DC_CABLE_TESTING_PROGRESS/dc_riso.csv',
  linkPath: '/DC_CABLE_TESTING_PROGRESS/link',
  simpleCounters: false, // DCCT uses custom testing counters
  dcctMode: true, // Enable DC Cable Testing mode
  // string_text styling - same as DC Cable Pulling module
  stringTextVisibility: 'always',
  stringTextToggle: false,
  stringTextDefaultOn: true,
  stringTextColor: 'rgba(255,255,255,0.92)',
  stringTextBaseSize: 11,
  stringTextStyle: '300',
  stringTextStrokeColor: 'rgba(0,0,0,0.6)',
  stringTextStrokeWidthFactor: 1,
  stringTextMinZoom: 18,
  stringTextMinFontSize: null,
  stringTextMaxFontSize: null,
  stringTextRefZoom: 20,
  // No inv_id label mode for DCCT - we color strings based on test results
  invIdLabelMode: false,
  geojsonFiles: [
    { url: '/DC_CABLE_TESTING_PROGRESS/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/DC_CABLE_TESTING_PROGRESS/string_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
    { url: '/DC_CABLE_TESTING_PROGRESS/inv_id.geojson', name: 'inv_id', color: '#16a34a', fillColor: '#22c55e' },
    {
      url: '/DC_CABLE_TESTING_PROGRESS/lv_box.geojson',
      name: 'lv_box',
      color: '#eab308',
      fillColor: '#facc15',
      weight: 3,
      fillOpacity: 0.6,
    },
  ],
};

export const MODULE_INSTALLATION_PROGRESS_TRACKING_MODULE_CONFIG = {
  key: 'MIPT',
  label: 'MODULE_INSTALLATION_PROGRES_TRACKING',
  // Files live in: public/MODULE_INSTALLATION_PROGRES_TRACKING/
  csvFormat: null,
  csvPath: null,
  linkPath: '/MODULE_INSTALLATION_PROGRES_TRACKING/link',
  simpleCounters: true,
  simpleCounterUnit: '',
  // Weighted counters by table type (auto-classified from full.geojson geometry sizes)
  workUnitWeights: { long: 27, medium: 14, short: 13 },
  stringTextVisibility: 'always',
  stringTextToggle: true,
  stringTextDefaultOn: true,
  stringTextColor: 'rgba(255,255,255,0.98)',
  stringTextBaseSize: 22,
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0.85)',
  stringTextStrokeWidthFactor: 1.2,
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  geojsonFiles: [
    { url: '/MODULE_INSTALLATION_PROGRES_TRACKING/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/MODULE_INSTALLATION_PROGRES_TRACKING/string_text.geojson', name: 'string_text', color: '#dc2626', fillColor: '#ef4444' },
    { url: '/MODULE_INSTALLATION_PROGRES_TRACKING/inv_id.geojson', name: 'inv_id', color: '#16a34a', fillColor: '#22c55e' },
    {
      // This dataset uses inv_box.geojson as the LV box/boundary layer
      url: '/MODULE_INSTALLATION_PROGRES_TRACKING/inv_box.geojson',
      name: 'lv_box',
      color: '#eab308',
      fillColor: '#facc15',
      weight: 3,
      fillOpacity: 0.6,
    },
  ],
};

export const TABLE_INSTALLATION_PROGRESS_MODULE_CONFIG = {
  key: 'TIP',
  label: 'TABLE_INSTALLATION_PROGRESS',
  // Files live in: public/TABLE_INSTALLATION_PROGRESS/
  csvFormat: null,
  csvPath: null,
  linkPath: '/TABLE_INSTALLATION_PROGRESS/link',
  // Keep the same UI/counters layout as MIPT by default.
  simpleCounters: true,
  simpleCounterUnit: '', // No unit for table counts
  // Table size counters - küçük ve büyük masa sayısı
  tableCounters: true,
  tableAreaThreshold: 50, // m² - bu değerden küçükse small (2V14), büyükse big (2V27)
  smallTableLabel: '2V14',
  bigTableLabel: '2V27',
  // string_text görünmez olacak (render edilir ama opacity 0)
  stringTextVisibility: 'always',
  stringTextToggle: false,
  stringTextDefaultOn: false,
  stringTextColor: 'rgba(255,255,255,0)',       // Görünmez
  stringTextBaseSize: 22,
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0)',       // Görünmez
  stringTextStrokeWidthFactor: 1.2,
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  geojsonFiles: [
    { url: '/TABLE_INSTALLATION_PROGRESS/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/TABLE_INSTALLATION_PROGRESS/inv_id.geojson', name: 'inv_id', color: '#16a34a', fillColor: '#22c55e' },
    {
      // This dataset uses inv_box.geojson as the LV box/boundary layer
      url: '/TABLE_INSTALLATION_PROGRESS/inv_box.geojson',
      name: 'lv_box',
      color: '#eab308',
      fillColor: '#facc15',
      weight: 3,
      fillOpacity: 0.6,
    },
  ],
};

export const LV_BOX_INV_BOX_INSTALLATION_PROGRESS_CONFIG = {
  key: 'LVIB',
  label: 'LV BOX & INV BOX INSTALLATION PROGRESS TRACKING',
  // Files live in: public/LV_BOX_INV_BOX_INSTALLATION_PROGRESS_TRACKING/
  csvFormat: null,
  csvPath: null,
  linkPath: '/LV_BOX_INV_BOX_INSTALLATION_PROGRESS_TRACKING/link',
  simpleCounters: true,
  simpleCounterUnit: '', // No unit
  // Box labels for LV and INV boxes
  boxLabelsEnabled: true,
  lvBoxLabel: 'LV',
  invBoxLabel: 'INV',
  // Box label text styling (smaller, lighter, fits inside boxes)
  boxLabelTextBaseSize: 6,
  boxLabelTextStyle: '400',
  boxLabelTextMinFontSize: 4,
  boxLabelTextMaxFontSize: 10,
  boxLabelTextRefZoom: 20,
  boxLabelTextStrokeColor: 'rgba(0,0,0,0.7)',
  boxLabelTextStrokeWidthFactor: 0.8,
  stringTextVisibility: 'always',
  stringTextToggle: true,
  stringTextDefaultOn: true,
  stringTextColor: 'rgba(250,204,21,0.98)',
  stringTextBaseSize: 22,
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0.85)',
  stringTextStrokeWidthFactor: 1.2,
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  geojsonFiles: [
    { url: '/LV_BOX_INV_BOX_INSTALLATION_PROGRESS_TRACKING/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/LV_BOX_INV_BOX_INSTALLATION_PROGRESS_TRACKING/inv_id.geojson', name: 'inv_id', color: '#16a34a', fillColor: '#22c55e' },
    {
      url: '/LV_BOX_INV_BOX_INSTALLATION_PROGRESS_TRACKING/lv_box.geojson',
      name: 'lv_box',
      color: '#dc2626',
      fillColor: '#ef4444',
      weight: 3,
      fillOpacity: 0.6,
      boxLabel: 'LV',
    },
    {
      url: '/LV_BOX_INV_BOX_INSTALLATION_PROGRESS_TRACKING/inv_box.geojson',
      name: 'inv_box',
      color: '#dc2626',
      fillColor: '#ef4444',
      weight: 3,
      fillOpacity: 0.6,
      boxLabel: 'INV',
    },
  ],
};

export const PARAMETER_AND_TABLE_EARTHING_PROGRESS_MODULE_CONFIG = {
  key: 'PTEP',
  label: 'PARAMETER & TABLE EARTHING PROGRESS',
  // Files live in: public/PARAMETER_and_TABLE_EARTHING_PROGRESS/
  csvFormat: null,
  csvPath: null,
  linkPath: '/PARAMETER_and_TABLE_EARTHING_PROGRESS/link',
  simpleCounters: true, // Use simpleCounters branch (PTEP has custom rendering inside)
  simpleCounterUnit: '',
  // Earthing mode - special layer handling
  earthingMode: true,
  // Text labels visibility
  stringTextVisibility: 'always',
  stringTextToggle: true,
  stringTextDefaultOn: true,
  stringTextColor: 'rgba(250,204,21,0.98)',
  stringTextBaseSize: 22,
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0.85)',
  stringTextStrokeWidthFactor: 1.2,
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  geojsonFiles: [
    // Background layer - not selectable, just visual reference
    { url: '/PARAMETER_and_TABLE_EARTHING_PROGRESS/earthing_full.geojson', name: 'earthing_full', color: 'rgba(255,255,255,0.26)', fillColor: 'transparent' },
    // Parameter layer - rendered normally, not selectable
    { url: '/PARAMETER_and_TABLE_EARTHING_PROGRESS/earthing_parameter.geojson', name: 'earthing_parameter', color: 'rgba(255,255,255,0.5)', fillColor: 'transparent' },
    // Table-to-table layer - SELECTABLE, thick white -> green on click
    { url: '/PARAMETER_and_TABLE_EARTHING_PROGRESS/earthing_tabletotable.geojson', name: 'earthing_tabletotable', color: '#ffffff', fillColor: 'transparent' },
  ],
};

export const DC_AC_TRENCH_PROGRESS_MODULE_CONFIG = {
  key: 'DATP',
  label: 'DC&AC TRENCH PROGRESS',
  // Files live in: public/DC_AC_TRENCH_PROGRESS/
  csvFormat: null,
  csvPath: null,
  linkPath: '/DC_AC_TRENCH_PROGRESS/link',
  simpleCounters: true,
  simpleCounterUnit: 'm',
  submitWorkUnit: 'm excavated',
  // Use same string_text rendering as DC module (simple, zoom-based visibility)
  stringTextVisibility: 'always',
  stringTextToggle: false,
  stringTextDefaultOn: true,
  // Zoom-based visibility: only show labels when zoomed in enough
  stringTextMinZoom: 18,
  geojsonFiles: [
    // Full panels - background reference
    { url: '/DC_AC_TRENCH_PROGRESS/dc_trench_full_panels.geojson', name: 'full', color: '#64748b', fillColor: '#475569', weight: 1, fillOpacity: 0.2 },
    // Boundary - RED (kırmızı)
    { url: '/DC_AC_TRENCH_PROGRESS/dc_trench_boundry.geojson', name: 'boundry', color: '#ef4444', fillColor: 'transparent', weight: 3 },
    // Trench lines - BLUE (mavi, selectable)
    { url: '/DC_AC_TRENCH_PROGRESS/dc_trench_trench_line.geojson', name: 'trench', color: '#3b82f6', fillColor: '#3b82f6', weight: 2.5 },
    // Text labels - YELLOW (sarı) - rendered via string_text pipeline
    { url: '/DC_AC_TRENCH_PROGRESS/dc_trench_text.geojson', name: 'string_text', color: '#facc15', fillColor: '#facc15' },
  ],
};

export const PUNCH_LIST_MODULE_CONFIG = {
  key: 'PL',
  label: 'PUNCH LIST',
  // Files live in: public/PUNCH_LIST/
  basePath: '/PUNCH_LIST',
  csvFormat: null,
  csvPath: null,
  linkPath: '/PUNCH_LIST/link',
  simpleCounters: true,
  simpleCounterUnit: '',
  stringTextVisibility: 'always',
  stringTextToggle: true,
  stringTextDefaultOn: true,
  stringTextColor: 'rgba(255,255,255,0.98)',
  stringTextBaseSize: 22,
  stringTextStyle: '400',
  stringTextStrokeColor: 'rgba(0,0,0,0.85)',
  stringTextStrokeWidthFactor: 1.2,
  stringTextMinZoom: 0,
  stringTextMinFontSize: 14,
  stringTextMaxFontSize: 26,
  stringTextRefZoom: 20,
  geojsonFiles: [
    { url: '/PUNCH_LIST/full.geojson', name: 'full', color: '#2563eb', fillColor: '#3b82f6' },
    { url: '/PUNCH_LIST/inv_id.geojson', name: 'inv_id', color: '#16a34a', fillColor: '#22c55e' },
    {
      url: '/PUNCH_LIST/inv_box.geojson',
      name: 'inv_box',
      color: '#eab308',
      fillColor: '#facc15',
      weight: 3,
      fillOpacity: 0.6,
    },
  ],
};