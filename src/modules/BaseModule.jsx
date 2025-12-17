import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../App.css';
import SubmitModal from '../components/SubmitModal';
import useDailyLog from '../hooks/useDailyLog';
import { useChartExport } from '../hooks/useChartExport';
import {
  asLineStrings,
  mergeIntervals,
  computeIntervalsInBox,
  buildCumulativeMeters,
  sliceLineByMeters,
  subtractInterval,
} from '../utils/lineBoxSelection';

// ═══════════════════════════════════════════════════════════════
// CUSTOM CANVAS TEXT LABEL CLASS
// ═══════════════════════════════════════════════════════════════
L.TextLabel = L.CircleMarker.extend({
  options: {
    text: '',
    textStyle: '300',
    textColor: 'rgba(255,255,255,0.65)',
    textStrokeColor: 'rgba(0,0,0,0.6)',
    textStrokeWidthFactor: 1,
    underline: false,
    underlineColor: null, // defaults to textColor if null
    underlineWidthFactor: 1,
    offsetX: 0, // px (applied after rotation)
    offsetY: 0, // px (applied after rotation)
    offsetXFactor: 0, // multiplied by computed fontSize (applied after rotation)
    offsetYFactor: 0, // multiplied by computed fontSize (applied after rotation)
    minFontSize: null,
    maxFontSize: null,
    bgColor: null, // e.g. 'rgba(11,18,32,0.85)'
    bgPaddingX: 0,
    bgPaddingY: 0,
    bgStrokeColor: null,
    bgStrokeWidth: 0,
    bgCornerRadius: 0, // 0 = square corners
    minTextZoom: null, // if set, hide text/bg below this zoom (prevents "soup" when zoomed out)
    minBgZoom: null, // if set, hide background box below this zoom (text can still render)
    textColorNoBg: null, // optional alternate text color when bg is hidden (e.g., completed green at zoomed-out)
    textBaseSize: 10,
    refZoom: 20,
    rotation: 0,
    interactive: false,
    radius: 0
  },

  _updatePath: function () {
    if (!this._renderer || !this._renderer._ctx) return;
    
    const ctx = this._renderer._ctx;
    const p = this._point;
    const map = this._map;
    
    if (!map || !p) return;

    const zoom = map.getZoom();
    const minTextZoom = typeof this.options.minTextZoom === 'number' ? this.options.minTextZoom : null;
    if (minTextZoom != null && zoom < minTextZoom) return;
    const scale = Math.pow(2, zoom - this.options.refZoom);
    let fontSize = this.options.textBaseSize * scale;

    // Optional clamping (module-configurable) so some labels remain readable when zoomed out
    // without making them heavier/bolder.
    const minFs = typeof this.options.minFontSize === 'number' ? this.options.minFontSize : null;
    const maxFs = typeof this.options.maxFontSize === 'number' ? this.options.maxFontSize : null;
    if (minFs != null) fontSize = Math.max(minFs, fontSize);
    if (maxFs != null) fontSize = Math.min(maxFs, fontSize);

    if (fontSize < 1) return;

    ctx.save();
    
    const rotationRad = (this.options.rotation || 0) * Math.PI / 180;
    ctx.translate(p.x, p.y);
    ctx.rotate(rotationRad);
    // Apply optional offsets AFTER rotation so "below" stays aligned with rotated text.
    const offX = Number(this.options.offsetX) || 0;
    const offYpx = Number(this.options.offsetY) || 0;
    const offXf = (Number(this.options.offsetXFactor) || 0) * fontSize;
    const offY = (Number(this.options.offsetYFactor) || 0) * fontSize;
    if (offX || offYpx || offXf || offY) ctx.translate(offX + offXf, offYpx + offY);

    ctx.font = this.options.textStyle + ' ' + fontSize + 'px sans-serif';
    // If background is configured but hidden at this zoom, allow an alternate text color
    // so completed markers remain visually distinct even when zoomed out.
    const minBgZoom = typeof this.options.minBgZoom === 'number' ? this.options.minBgZoom : null;
    const bgVisible = Boolean(this.options.bgColor) && (minBgZoom == null || zoom >= minBgZoom);
    const altNoBg = this.options.textColorNoBg;
    ctx.fillStyle = !bgVisible && altNoBg ? altNoBg : this.options.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const rawText = String(this.options.text || '');
    const lines = rawText.includes('\n') ? rawText.split(/\n+/).filter(Boolean) : [rawText];
    const lineGap = fontSize * 0.2;
    const lineH = fontSize + lineGap;

    // Optional background box behind text (square by default)
    if (bgVisible) {
      let maxW = 0;
      let ascent = fontSize * 0.8;
      let descent = fontSize * 0.25;
      for (const ln of lines) {
        const m = ctx.measureText(ln || '');
        maxW = Math.max(maxW, m.width || 0);
        if (typeof m.actualBoundingBoxAscent === 'number') ascent = Math.max(ascent, m.actualBoundingBoxAscent);
        if (typeof m.actualBoundingBoxDescent === 'number') descent = Math.max(descent, m.actualBoundingBoxDescent);
      }
      const textW = maxW;
      const textH = (lines.length * lineH) - lineGap; // no gap after last line
      const padX = Number(this.options.bgPaddingX) || 0;
      const padY = Number(this.options.bgPaddingY) || 0;
      const w = textW + padX * 2;
      const h = textH + padY * 2;
      const x = -w / 2;
      const y = -h / 2;

      ctx.save();
      ctx.fillStyle = this.options.bgColor;
      const r = Math.max(0, Number(this.options.bgCornerRadius) || 0);
      ctx.beginPath();
      if (r > 0) {
        const rr = Math.min(r, w / 2, h / 2);
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
      } else {
        ctx.rect(x, y, w, h);
      }
      ctx.closePath();
      ctx.fill();

      const sw = Number(this.options.bgStrokeWidth) || 0;
      if (sw > 0 && this.options.bgStrokeColor) {
        ctx.lineWidth = sw;
        ctx.strokeStyle = this.options.bgStrokeColor;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Make text look less "bold/fill-heavy":
    // - A bright stroke thickens glyphs; use a thin dark stroke instead.
    // - Skip stroke at small sizes (expensive + visually noisy).
    if (fontSize >= 10) {
      const factor = typeof this.options.textStrokeWidthFactor === 'number' ? this.options.textStrokeWidthFactor : 1;
      ctx.lineWidth = Math.max(0.55, fontSize / 18) * Math.max(0.5, factor);
      ctx.strokeStyle = this.options.textStrokeColor || 'rgba(0,0,0,0.6)';
      if (lines.length === 1) {
        ctx.strokeText(rawText, 0, 0);
      } else {
        const totalH = (lines.length * lineH) - lineGap;
        const startY = -totalH / 2 + (fontSize / 2);
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i] || '';
          const y = startY + i * lineH;
          ctx.strokeText(ln, 0, y);
        }
      }
    }

    if (lines.length === 1) {
      ctx.fillText(rawText, 0, 0);
    } else {
      const totalH = (lines.length * lineH) - lineGap;
      const startY = -totalH / 2 + (fontSize / 2);
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i] || '';
        const y = startY + i * lineH;
        ctx.fillText(ln, 0, y);
      }
    }

    // Optional underline (used for clickable "TESTED" label)
    if (this.options.underline) {
      const metrics = ctx.measureText(lines[lines.length - 1] || '');
      const w = metrics.width || 0;
      const y = (fontSize * 0.55); // slightly below baseline-middle
      const uc = this.options.underlineColor || ctx.fillStyle;
      const uf = typeof this.options.underlineWidthFactor === 'number' ? this.options.underlineWidthFactor : 1;
      ctx.beginPath();
      ctx.lineWidth = Math.max(1, fontSize * 0.08) * Math.max(0.6, uf);
      ctx.strokeStyle = uc;
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(w / 2, y);
      ctx.stroke();
    }
    
    ctx.restore();
  }
});

L.textLabel = function (latlng, options) {
  return new L.TextLabel(latlng, options);
};

// ═══════════════════════════════════════════════════════════════
// GLOBAL CANVAS RENDERER
// ═══════════════════════════════════════════════════════════════
// Smaller padding = less canvas redraw area => better performance on large datasets
const canvasRenderer = L.canvas({ padding: 0.1 });

// ═══════════════════════════════════════════════════════════════
// BASE MODULE (shared UI + shared logic)
// BaseModule receives module-specific data via props; UI/logic stays identical.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// YARDIMCI FONKSİYONLAR
// ═══════════════════════════════════════════════════════════════
function calculateLineAngle(coords) {
  if (!coords || coords.length < 2) return 0;
  
  let maxDist = 0;
  let bestAngle = 0;
  
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i+1][0] - coords[i][0];
    const dy = coords[i+1][1] - coords[i][1];
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    if (dist > maxDist) {
      maxDist = dist;
      bestAngle = Math.atan2(dy, dx) * 180 / Math.PI;
    }
  }
  
  if (bestAngle > 90) bestAngle -= 180;
  if (bestAngle < -90) bestAngle += 180;
  
  return bestAngle;
}

// ═══════════════════════════════════════════════════════════════
// ID NORMALİZASYONU
// ═══════════════════════════════════════════════════════════════
const normalizeId = (id) => (id ? id.toString().replace(/\s+/g, '').toLowerCase().trim() : '');

// (DCCT overlay ordering helper lives in utils so it's testable.)

// Selection tolerances (in meters)
const NEAR_DISTANCE_METERS = 15; // Tight match for nearby labels
const LOOSE_DISTANCE_METERS = 30; // Fallback for very small polygons

// Simple ray-casting point-in-polygon for Polygon / MultiPolygon geometries
const isPointInRing = (lat, lng, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1];
    const yi = ring[i][0];
    const xj = ring[j][1];
    const yj = ring[j][0];

    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < ((xj - xi) * (lng - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

// (unused helper retained for future module boundary overrides)
const _isPointInsideFeature = (lat, lng, geometry) => {
  if (!geometry) return false;

  if (geometry.type === 'Polygon') {
    const [outer, ...holes] = geometry.coordinates || [];
    if (!outer) return false;
    const inOuter = isPointInRing(lat, lng, outer);
    if (!inOuter) return false;
    return !holes.some(hole => isPointInRing(lat, lng, hole));
  }

  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).some(poly => {
      const [outer, ...holes] = poly || [];
      if (!outer) return false;
      const inOuter = isPointInRing(lat, lng, outer);
      if (!inOuter) return false;
      return !holes.some(hole => isPointInRing(lat, lng, hole));
    });
  }

  return false;
};

// ═══════════════════════════════════════════════════════════════
// ANA UYGULAMA
// ═══════════════════════════════════════════════════════════════
export default function BaseModule({
  name,
  counters = true,
  moduleConfig,
  customLogic: _customLogic = null,
  customSidebar: _customSidebar = null,
  customCounters = null,
  customFooter: _customFooter = null,
  customPanelLogic: _customPanelLogic = null,
  customBoundaryLogic = null,
}) {
  const activeMode = customBoundaryLogic ? customBoundaryLogic(moduleConfig) : moduleConfig;
  const moduleName = name || activeMode?.label || 'MODULE';
  const showCounters = Boolean(counters);
  const isLV = String(activeMode?.key || '').toUpperCase() === 'LV';
  // Treat any module with mvf-style CSV/logic as MVF-mode (e.g., MV + FIBRE modules).
  const isMVF = String(activeMode?.csvFormat || '').toLowerCase() === 'mvf';
  const isMC4 = String(activeMode?.key || '').toUpperCase() === 'MC4';
  const isMVT = String(activeMode?.key || '').toUpperCase() === 'MVT';
  const isLVTT = String(activeMode?.key || '').toUpperCase() === 'LVTT';
  // DC Cable Testing Progress mode
  const isDCCT = String(activeMode?.key || '').toUpperCase() === 'DCCT' || Boolean(activeMode?.dcctMode);
  const isDCCTRef = useRef(isDCCT);
  useEffect(() => {
    isDCCTRef.current = isDCCT;
  }, [isDCCT]);
  const mvfCircuitsMultiplier =
    typeof activeMode?.circuitsMultiplier === 'number' && Number.isFinite(activeMode.circuitsMultiplier)
      ? activeMode.circuitsMultiplier
      : 1;
  // Segment colors must never use green (reserved for "completed").
  const mvfSegmentPalette = [
    '#ef4444', // red
    '#f97316', // orange
    '#eab308', // amber
    '#06b6d4', // cyan
    '#3b82f6', // blue
    '#6366f1', // indigo
    '#a855f7', // purple
    '#ec4899', // pink
    '#0ea5e9', // sky
    '#94a3b8', // slate
  ];
  const mvfColorOfSegment = useCallback((key) => {
    const k = String(key || '');
    if (!k) return '#94a3b8';
    const cached = mvfSegmentColorByKeyRef.current?.[k];
    if (cached) return cached;
    // stable hash
    let h = 0;
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    const c = mvfSegmentPalette[h % mvfSegmentPalette.length];
    mvfSegmentColorByKeyRef.current[k] = c;
    return c;
  }, []);
  const useSimpleCounters = Boolean(activeMode?.simpleCounters) || isLV;
  const stringTextToggleEnabled = Boolean(activeMode?.stringTextToggle);
  const [stringTextUserOn, setStringTextUserOn] = useState(Boolean(activeMode?.stringTextDefaultOn));
  const effectiveStringTextVisibility = stringTextToggleEnabled
    ? (stringTextUserOn ? 'always' : 'none')
    : (activeMode?.stringTextVisibility || 'always'); // 'always' | 'hover' | 'cursor' | 'none'

  // Module-configurable string_text label styling (used by MVF subs_text and others)
  const stringTextBaseSizeCfg =
    typeof activeMode?.stringTextBaseSize === 'number' ? activeMode.stringTextBaseSize : 11;
  const stringTextColorCfg = activeMode?.stringTextColor || 'rgba(255,255,255,0.92)';
  const stringTextStyleCfg = activeMode?.stringTextStyle || '300';
  const stringTextStrokeColorCfg = activeMode?.stringTextStrokeColor || 'rgba(0,0,0,0.6)';
  const stringTextStrokeWidthFactorCfg =
    typeof activeMode?.stringTextStrokeWidthFactor === 'number'
      ? activeMode.stringTextStrokeWidthFactor
      : 1;
  const stringTextMinZoomCfg =
    // NOTE: keep this default as a literal because STRING_LABEL_MIN_ZOOM is declared later in this component.
    typeof activeMode?.stringTextMinZoom === 'number' ? activeMode.stringTextMinZoom : 18;
  const stringTextMinFontSizeCfg =
    typeof activeMode?.stringTextMinFontSize === 'number' ? activeMode.stringTextMinFontSize : null;
  const stringTextMaxFontSizeCfg =
    typeof activeMode?.stringTextMaxFontSize === 'number' ? activeMode.stringTextMaxFontSize : null;
  const stringTextRefZoomCfg =
    typeof activeMode?.stringTextRefZoom === 'number' ? activeMode.stringTextRefZoom : 20;

  // Keep current visibility in refs so Leaflet event handlers never call stale closures.
  const effectiveStringTextVisibilityRef = useRef(effectiveStringTextVisibility);
  const stringTextToggleEnabledRef = useRef(stringTextToggleEnabled);
  useEffect(() => {
    effectiveStringTextVisibilityRef.current = effectiveStringTextVisibility;
    stringTextToggleEnabledRef.current = stringTextToggleEnabled;
  }, [effectiveStringTextVisibility, stringTextToggleEnabled]);

  // Reset per-module toggle when switching modules
  useEffect(() => {
    setStringTextUserOn(Boolean(activeMode?.stringTextDefaultOn));
  }, [activeMode]);

  // Optional hooks for module-specific behavior (kept isolated)
  useEffect(() => {
    if (typeof _customLogic === 'function') {
      _customLogic({
        moduleName,
        activeMode,
        mapRef,
      });
    }
  }, [_customLogic, moduleName, activeMode]);

  useEffect(() => {
    if (typeof _customPanelLogic === 'function') {
      _customPanelLogic({
        moduleName,
        activeMode,
        mapRef,
      });
    }
  }, [_customPanelLogic, moduleName, activeMode]);

  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const stringTextRendererRef = useRef(null); // dedicated canvas renderer for string_text to avoid ghosting
  const lvttInvIdRendererRef = useRef(null); // dedicated canvas renderer for LVTT inv_id labels to avoid overlap when switching modes
  const lvttTermCounterRendererRef = useRef(null); // dedicated canvas renderer for LVTT termination counters
  const layersRef = useRef([]);
  const polygonIdCounter = useRef(0); // Counter for unique polygon IDs
  const polygonById = useRef({}); // uniqueId -> {layer, stringId}
                const boxRectRef = useRef(null);
  const draggingRef = useRef(null);
  const rafRef = useRef(null);
  const stringTextPointsRef = useRef([]); // [{lat,lng,text,angle,stringId}]
  const stringTextLayerRef = useRef(null); // L.LayerGroup
  // MVT: separate interactive layer for clickable "TESTED" labels (must not be in pointerEvents:none pane).
  const mvtTestedLayerRef = useRef(null); // L.LayerGroup
  const mvtTestedLabelPoolRef = useRef([]); // L.TextLabel[]
  const mvtTestedLabelActiveCountRef = useRef(0);
  // MVT: separate interactive layer for clickable termination counters (0/3..3/3).
  const mvtCounterLayerRef = useRef(null); // L.LayerGroup
  const mvtCounterLabelPoolRef = useRef([]); // L.TextLabel[]
  const mvtCounterLabelActiveCountRef = useRef(0);
  const mvtTestCsvByFromRef = useRef({}); // fromNorm -> { L1: 'PASS'|'FAIL'|..., L2, L3 }
  const mvtTerminationByStationRef = useRef({}); // ssNorm -> 0..3
  // LVTT: LV Termination & Testing mode - CSV data by inverter ID
  const lvttTestCsvByInvRef = useRef({}); // invNorm -> { L1: {value, status}, L2: {value, status}, L3: {value, status} }
  const lvttInvMetaByNormRef = useRef({}); // invNorm -> { lat, lng, angle, raw, displayId }
  // LVTT: separate clickable termination counter labels under inv_id
  const lvttTermCounterLayerRef = useRef(null); // L.LayerGroup
  const lvttTermCounterLabelPoolRef = useRef([]); // L.TextLabel[]
  const lvttTermCounterLabelActiveCountRef = useRef(0);
  // LVTT: sub-mode selector (single module with two internal modes)
  const [lvttSubMode, setLvttSubMode] = useState(() => {
    try {
      const raw = localStorage.getItem('cew:lvtt:submode');
      const v = String(raw || '').toLowerCase();
      return v === 'testing' ? 'testing' : 'termination';
    } catch (_e) {
      void _e;
      return 'termination';
    }
  }); // 'termination' | 'testing'
  const lvttSubModeRef = useRef(lvttSubMode);
  useEffect(() => {
    lvttSubModeRef.current = lvttSubMode;
    try {
      localStorage.setItem('cew:lvtt:submode', String(lvttSubMode || 'termination'));
    } catch (_e) {
      void _e;
    }
  }, [lvttSubMode]);
  // LVTT: manual termination counts per inverter (persistent)
  const [lvttTerminationByInv, setLvttTerminationByInv] = useState(() => ({})); // invNorm -> 0..3
  const lvttTerminationByInvRef = useRef(lvttTerminationByInv);
  useEffect(() => {
    lvttTerminationByInvRef.current = lvttTerminationByInv || {};
  }, [lvttTerminationByInv]);

  // DCCT: DC Cable Testing Progress state
  // dcctTestData: { [normalizedId]: 'passed' | 'failed' }
  const [dcctTestData, setDcctTestData] = useState(() => ({}));
  const dcctTestDataRef = useRef(dcctTestData);
  useEffect(() => {
    dcctTestDataRef.current = dcctTestData || {};
  }, [dcctTestData]);
  // DCCT: Full CSV values per ID (for click-to-show overlays)
  // { [normalizedId]: { plus: string, minus: string, status: 'passed'|'failed'|null, remarkRaw: string } }
  const dcctRisoByIdRef = useRef({});
  // DCCT: overlay labels for clicked tables
  const dcctOverlayLayerRef = useRef(null); // L.LayerGroup
  const dcctOverlayLabelsByIdRef = useRef({}); // normalizedId -> L.TextLabel
  // DCCT: Map IDs from string_text.geojson
  const [dcctMapIds, setDcctMapIds] = useState(() => new Set());
  const dcctMapIdsRef = useRef(dcctMapIds);
  useEffect(() => {
    dcctMapIdsRef.current = dcctMapIds || new Set();
  }, [dcctMapIds]);
  // DCCT: Active filter ('passed' | 'failed' | 'not_tested' | null)
  const [dcctFilter, setDcctFilter] = useState(null);
  const dcctFilterRef = useRef(dcctFilter);
  useEffect(() => {
    dcctFilterRef.current = dcctFilter;
  }, [dcctFilter]);
  // DCCT: CSV totals
  const [dcctCsvTotals, setDcctCsvTotals] = useState(() => ({ total: 0, passed: 0, failed: 0 }));

  const dcctClearTestOverlays = useCallback(() => {
    try {
      const layer = dcctOverlayLayerRef.current;
      if (layer) layer.clearLayers();
    } catch (_e) {
      void _e;
    }
    dcctOverlayLabelsByIdRef.current = {};
  }, []);

  // DCCT: Track open popups by idNorm
  const dcctOpenPopupsRef = useRef({}); // idNorm -> L.Popup

  const dcctToggleTestOverlay = useCallback((idNorm, latlng) => {
    const map = mapRef.current;
    if (!map || !idNorm || !latlng) return;

    const openPopups = dcctOpenPopupsRef.current || {};
    const existingPopup = openPopups[idNorm];

    // If popup exists and is open, close it (toggle off)
    if (existingPopup) {
      try {
        map.closePopup(existingPopup);
      } catch (_e) {
        void _e;
      }
      delete openPopups[idNorm];
      dcctOpenPopupsRef.current = openPopups;
      return;
    }

    // Get test data from CSV
    const rec = dcctRisoByIdRef.current?.[idNorm] || null;
    const plus = rec?.plus != null ? String(rec.plus).trim() : '';
    const minus = rec?.minus != null ? String(rec.minus).trim() : '';
    const status = rec?.status || 'not_tested'; // 'passed', 'failed', 'not_tested'

    const plusVal = plus || '999';
    const minusVal = minus || '999';

    // Status colors
    const passColor = '#059669';
    const failColor = '#dc2626';
    const naColor = '#64748b';
    const statusColor = status === 'passed' ? passColor : status === 'failed' ? failColor : naColor;

    // Create editable HTML content
    const popupContent = document.createElement('div');
    popupContent.style.cssText = `
      font-family: sans-serif;
      font-size: 13px;
      font-weight: 600;
      color: #10b981;
      min-width: 160px;
      user-select: none;
    `;
    popupContent.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <span style="color: #10b981;">Ins. Res (+):</span>
          <input type="text" value="${plusVal}" 
            style="width: 50px; background: #1e293b; border: 1px solid #334155; border-radius: 4px; 
                   color: #10b981; font-weight: 600; font-size: 13px; padding: 2px 6px; text-align: right;"
            data-field="plus" />
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <span style="color: #10b981;">Ins. Res (-):</span>
          <input type="text" value="${minusVal}"
            style="width: 50px; background: #1e293b; border: 1px solid #334155; border-radius: 4px;
                   color: #10b981; font-weight: 600; font-size: 13px; padding: 2px 6px; text-align: right;"
            data-field="minus" />
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; padding-top: 6px; border-top: 1px solid #334155;">
          <span style="color: ${statusColor};">Status:</span>
          <select data-field="status"
            style="background: #1e293b; border: 1px solid #334155; border-radius: 4px;
                   color: ${statusColor}; font-weight: 600; font-size: 12px; padding: 2px 6px; cursor: pointer;">
            <option value="passed" ${status === 'passed' ? 'selected' : ''} style="color: ${passColor};">PASSED</option>
            <option value="failed" ${status === 'failed' ? 'selected' : ''} style="color: ${failColor};">FAILED</option>
            <option value="not_tested" ${status === 'not_tested' || !status ? 'selected' : ''} style="color: ${naColor};">N/A</option>
          </select>
        </div>
      </div>
    `;

    // Add event listeners for changes
    const selectEl = popupContent.querySelector('select[data-field="status"]');
    if (selectEl) {
      selectEl.addEventListener('change', (e) => {
        const newStatus = e.target.value;
        const newColor = newStatus === 'passed' ? passColor : newStatus === 'failed' ? failColor : naColor;
        e.target.style.color = newColor;
        // Update the label span color too
        const labelSpan = e.target.parentElement?.querySelector('span');
        if (labelSpan) labelSpan.style.color = newColor;
      });
    }

    // Create popup
    const popup = L.popup({
      closeButton: true,
      autoClose: false,
      closeOnEscapeKey: true,
      closeOnClick: false,
      className: 'dcct-test-popup',
      maxWidth: 250,
      minWidth: 160,
    })
      .setLatLng(latlng)
      .setContent(popupContent);

    // Track popup close event
    popup.on('remove', () => {
      const pops = dcctOpenPopupsRef.current || {};
      delete pops[idNorm];
      dcctOpenPopupsRef.current = pops;
    });

    // Open popup and track it
    popup.openOn(map);
    openPopups[idNorm] = popup;
    dcctOpenPopupsRef.current = openPopups;

  }, []);

  // Clear DCCT popups when switching modules
  const dcctClearAllPopups = useCallback(() => {
    const map = mapRef.current;
    const openPopups = dcctOpenPopupsRef.current || {};
    Object.values(openPopups).forEach((popup) => {
      try {
        if (map) map.closePopup(popup);
      } catch (_e) {
        void _e;
      }
    });
    dcctOpenPopupsRef.current = {};
  }, []);

  // Clear DCCT overlays when switching modules
  useEffect(() => {
    dcctClearTestOverlays();
    dcctClearAllPopups();
  }, [activeMode?.key, dcctClearTestOverlays, dcctClearAllPopups]);
  
  const [_status, setStatus] = useState('Initializing map...');
  const [lengthData, setLengthData] = useState({}); // Length data from CSV
  const [stringPoints, setStringPoints] = useState([]); // String points (id, lat, lng)
  const [selectedPolygons, setSelectedPolygons] = useState(new Set()); // Selected polygon unique IDs
  const selectedPolygonsRef = useRef(selectedPolygons);
  useEffect(() => {
    selectedPolygonsRef.current = selectedPolygons;
  }, [selectedPolygons]);
  // MVT: test panel state for "TESTED" click
  const [mvtTestPanel, setMvtTestPanel] = useState(null); // { stationLabel, fromKey, phases: {L1,L2,L3} } | null
  // MVT: manual termination counter state (persistent)
  const [mvtTerminationByStation, setMvtTerminationByStation] = useState(() => ({})); // ssNorm -> 0..3
  useEffect(() => {
    mvtTerminationByStationRef.current = mvtTerminationByStation || {};
  }, [mvtTerminationByStation]);
  const [mvtTermPopup, setMvtTermPopup] = useState(null); // { stationLabel, stationNorm, draft, x, y } | null
  const [mvtTestPopup, setMvtTestPopup] = useState(null); // { stationLabel, fromKey, phases, x, y } | null
  const [mvtCsvTotals, setMvtCsvTotals] = useState(() => ({ total: 0, fromRows: 0, toRows: 0 })); // generic total
  // LVTT: popup state (content depends on sub-mode)
  const [lvttPopup, setLvttPopup] = useState(null);
  const [lvttCsvTotals, setLvttCsvTotals] = useState(() => ({ total: 0, passed: 0, failed: 0 }));
  const [mvtCsvVersion, setMvtCsvVersion] = useState(0);
  const [mvtCsvDebug, setMvtCsvDebug] = useState(() => ({ url: '', textLen: 0, rawLines: 0, filteredLines: 0, keys: 0 }));
  // When string_id ↔ polygon matching completes, bump this to recompute counters immediately (no extra click needed).
  const [stringMatchVersion, setStringMatchVersion] = useState(0);
  // MV+FIBER: segments list + completion + highlight
  const [mvfSegments, setMvfSegments] = useState([]); // [{key,label,length}]
  const [mvfActiveSegmentKeys, setMvfActiveSegmentKeys] = useState(() => new Set()); // Set<string>
  const mvfActiveSegmentKeysRef = useRef(mvfActiveSegmentKeys);
  const mvfPrevActiveSegmentKeysRef = useRef(new Set());
  const [mvfCurrentSegmentKey, setMvfCurrentSegmentKey] = useState(''); // required for box selection
  const mvfCurrentSegmentKeyRef = useRef(mvfCurrentSegmentKey);
  const mvfSegmentScaleByKeyRef = useRef({}); // key -> scale (CSV meters per trench meter)
  const mvfSegmentColorByKeyRef = useRef({}); // key -> css color
  const mvfRouteIntervalsBySegmentKeyRef = useRef({}); // key -> Map<"fid:lineIndex", [[a,b],...]>
  const [mvfDoneSegmentKeys, setMvfDoneSegmentKeys] = useState(() => new Set()); // Set<string>
  const mvfDoneSegmentKeysRef = useRef(mvfDoneSegmentKeys);
  const [mvfCompletedSegments, setMvfCompletedSegments] = useState(() => new Set());
  const mvfCompletedSegmentsRef = useRef(mvfCompletedSegments);
  const mvfSegmentLenByKeyRef = useRef({}); // key -> length
  const mvfHighlightLayerRef = useRef(null); // L.LayerGroup
  const mvfTrenchGraphRef = useRef(null); // { nodes, adj, grid }
  // MVF: mv_trench feature selection (click + box select)
  const [mvfSelectedTrenchIds, setMvfSelectedTrenchIds] = useState(() => new Set()); // Set<string>
  const mvfSelectedTrenchIdsRef = useRef(mvfSelectedTrenchIds);
  const mvfTrenchByIdRef = useRef({}); // id -> L.Path
  const mvfPrevSelectedTrenchRef = useRef(new Set());
  const mvfTrenchIdCounterRef = useRef(0);
  const mvfTrenchLenByIdRef = useRef({}); // id -> meters
  const [mvfTrenchTotalMeters, setMvfTrenchTotalMeters] = useState(0);
  const mvfTrenchEdgeIndexRef = useRef(new Map()); // "lat,lng|lat,lng" -> { fid, lineIndex, startM, endM }
  // MVF: partial trench completion via selection box (store selected/committed PART geometries)
  const [mvfSelectedTrenchParts, setMvfSelectedTrenchParts] = useState([]); // [{id, fid, coords:[[lat,lng],...], meters}]
  const [mvfCommittedTrenchParts, setMvfCommittedTrenchParts] = useState([]); // same shape, locked
  const mvfSelectedTrenchPartsRef = useRef(mvfSelectedTrenchParts);
  const mvfCommittedTrenchPartsRef = useRef(mvfCommittedTrenchParts);
  const mvfTrenchSelectedLayerRef = useRef(null); // L.LayerGroup
  const mvfTrenchCommittedLayerRef = useRef(null); // L.LayerGroup
  // MVF: committed (submitted/locked) trenches by day
  const [mvfCommittedTrenchIds, setMvfCommittedTrenchIds] = useState(() => new Set()); // Set<string>
  const mvfCommittedTrenchIdsRef = useRef(mvfCommittedTrenchIds);
  const [totalPlus, setTotalPlus] = useState(0); // Total +DC Cable from CSV
  const [totalMinus, setTotalMinus] = useState(0); // Total -DC Cable from CSV
  const [completedPlus, setCompletedPlus] = useState(0); // Selected +DC Cable
  const [completedMinus, setCompletedMinus] = useState(0); // Selected -DC Cable
  const [modalOpen, setModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySortBy, setHistorySortBy] = useState('date'); // 'date', 'workers', 'cable'
  const [historySortOrder, setHistorySortOrder] = useState('desc'); // 'asc', 'desc'
  
  // Note Mode state
  const [noteMode, setNoteMode] = useState(false);
  const initialNotes = (() => {
    const saved = localStorage.getItem('cew_notes');
    return saved ? JSON.parse(saved) : [];
  })();
  const [notesState, setNotesState] = useState(() => ({
    past: [],
    present: initialNotes,
    future: []
  }));
  const notes = notesState.present;
  const canUndoNotes = notesState.past.length > 0;
  const canRedoNotes = notesState.future.length > 0;
  const NOTES_HISTORY_LIMIT = 50;

  // ─────────────────────────────────────────────────────────────
  // GLOBAL UNDO/REDO (modules + sub-modes)
  // ─────────────────────────────────────────────────────────────
  const HISTORY_LIMIT = 60;

  // Generic selection history (selectedPolygons)
  const selectionHistoryRef = useRef({ past: [], future: [] }); // arrays of polygon ids
  const selectionHistorySuspendRef = useRef(false);
  const selectionPrevSnapshotRef = useRef([]);
  const [selectionHistoryTick, setSelectionHistoryTick] = useState(0);

  // LV inverter completion history (lvCompletedInvIds)
  const lvInvHistoryRef = useRef({ past: [], future: [] }); // arrays of invNorm
  const lvInvHistorySuspendRef = useRef(false);
  const lvInvPrevSnapshotRef = useRef([]);
  const [lvInvHistoryTick, setLvInvHistoryTick] = useState(0);

  // MVF selection history (mvfSelectedTrenchParts)
  const mvfPartsHistoryRef = useRef({ past: [], future: [] }); // arrays of trench-part objects
  const mvfPartsHistorySuspendRef = useRef(false);
  const mvfPartsPrevSnapshotRef = useRef([]);
  const [mvfPartsHistoryTick, setMvfPartsHistoryTick] = useState(0);

  // LVTT termination history (invNorm changes)
  const lvttTermHistoryRef = useRef({ actions: [], index: -1 });
  const [lvttTermHistoryTick, setLvttTermHistoryTick] = useState(0);

  // MVT termination history (stationNorm changes)
  const mvtTermHistoryRef = useRef({ actions: [], index: -1 });
  const [mvtTermHistoryTick, setMvtTermHistoryTick] = useState(0);

  const arraysEqualShallow = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  const cloneMvfParts = (parts) => {
    const arr = Array.isArray(parts) ? parts : [];
    return arr.map((p) => ({
      ...p,
      coords: Array.isArray(p?.coords) ? p.coords.map((c) => (Array.isArray(c) ? [...c] : c)) : p?.coords,
    }));
  };

  const pushSnapshotHistory = (ref, prevSnap, tickFn) => {
    const h = ref.current;
    h.past = [...h.past, prevSnap].slice(-HISTORY_LIMIT);
    h.future = [];
    tickFn((t) => t + 1);
  };

  const setNotes = (updater) => {
    setNotesState((s) => {
      const next = typeof updater === 'function' ? updater(s.present) : updater;
      if (next === s.present) return s;
      const past = [...s.past, s.present].slice(-NOTES_HISTORY_LIMIT);
      return { past, present: next, future: [] };
    });
  };

  const undoNotes = () => {
    setNotesState((s) => {
      if (s.past.length === 0) return s;
      const previous = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        present: previous,
        future: [s.present, ...s.future]
      };
    });
  };

  const redoNotes = () => {
    setNotesState((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0];
      return {
        past: [...s.past, s.present].slice(-NOTES_HISTORY_LIMIT),
        present: next,
        future: s.future.slice(1)
      };
    });
  };

  const lvttTermPushHistory = useCallback((invNorm, prev, next) => {
    if (!invNorm) return;
    const h = lvttTermHistoryRef.current;
    h.actions = h.actions.slice(0, h.index + 1);
    h.actions.push({ invNorm, prev, next });
    if (h.actions.length > HISTORY_LIMIT) h.actions = h.actions.slice(-HISTORY_LIMIT);
    h.index = h.actions.length - 1;
    setLvttTermHistoryTick((t) => t + 1);
  }, []);

  const mvtTermPushHistory = useCallback((stationNorm, prev, next) => {
    if (!stationNorm) return;
    const h = mvtTermHistoryRef.current;
    h.actions = h.actions.slice(0, h.index + 1);
    h.actions.push({ stationNorm, prev, next });
    if (h.actions.length > HISTORY_LIMIT) h.actions = h.actions.slice(-HISTORY_LIMIT);
    h.index = h.actions.length - 1;
    setMvtTermHistoryTick((t) => t + 1);
  }, []);

  const [selectedNotes, setSelectedNotes] = useState(new Set());
  const [editingNote, setEditingNote] = useState(null); // { id, lat, lng, text }
  const [noteText, setNoteText] = useState('');
  const [noteDate, setNoteDate] = useState(''); // YYYY-MM-DD
  const [notePhotoDataUrl, setNotePhotoDataUrl] = useState(null); // string | null
  const [notePhotoName, setNotePhotoName] = useState(''); // original filename (optional)
  const notePhotoInputRef = useRef(null);
  const noteMarkersRef = useRef({}); // id -> marker
  const markerClickedRef = useRef(false); // Track if a marker was just clicked

  // LV: inv_id daily completion tracking (click inv_id labels to mark completed for today)
  const getTodayYmd = () => new Date().toISOString().split('T')[0];
  const lvTodayYmd = getTodayYmd();
  const lvStorageKey = `cew:lv:inv_completed:${lvTodayYmd}`;
  const [lvCompletedInvIds, setLvCompletedInvIds] = useState(() => new Set());
  const lvCompletedInvIdsRef = useRef(lvCompletedInvIds);
  const lvInvLabelByIdRef = useRef({}); // invIdNorm -> L.TextLabel

  useEffect(() => {
    lvCompletedInvIdsRef.current = lvCompletedInvIds;
  }, [lvCompletedInvIds]);

  useEffect(() => {
    if (!isLV) return;
    try {
      const raw = localStorage.getItem(lvStorageKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setLvCompletedInvIds(new Set(arr.map(normalizeId)));
      else setLvCompletedInvIds(new Set());
    } catch (_e) {
      void _e;
      setLvCompletedInvIds(new Set());
    }
    // Reset polygon selection in LV (we count via inv_id clicks)
    setSelectedPolygons(new Set());
  }, [isLV, lvStorageKey]);

  useEffect(() => {
    if (!isLV) return;
    try {
      localStorage.setItem(lvStorageKey, JSON.stringify(Array.from(lvCompletedInvIds)));
    } catch (_e) {
      void _e;
    }
  }, [isLV, lvStorageKey, lvCompletedInvIds]);

  // MC4: panel-end progress tracking (two ends per panel: left/right)
  const MC4_PANEL_STATES = {
    NONE: null,
    MC4: 'mc4',
    TERMINATED: 'terminated',
  };
  // MC4 selection mode: 'mc4' or 'termination' - determines what type of work is being done
  // Default to 'mc4' (matches prior behavior), but allow user to uncheck back to null.
  const [mc4SelectionMode, setMc4SelectionMode] = useState('mc4'); // null | 'mc4' | 'termination'
  const mc4SelectionModeRef = useRef(mc4SelectionMode);
  useEffect(() => {
    mc4SelectionModeRef.current = mc4SelectionMode;
  }, [mc4SelectionMode]);
  const [mc4Toast, setMc4Toast] = useState('');
  const mc4ToastTimerRef = useRef(null);
  const showMc4Toast = useCallback((msg) => {
    if (!msg) return;
    setMc4Toast(msg);
    try {
      if (mc4ToastTimerRef.current) clearTimeout(mc4ToastTimerRef.current);
    } catch (_e) {
      void _e;
    }
    mc4ToastTimerRef.current = setTimeout(() => setMc4Toast(''), 2200);
  }, []);

  // NOTE: Do not auto-force a selection mode when entering MC4.
  // Users can intentionally set it to null (no mode) and we must respect that.
  const mc4TodayYmd = getTodayYmd();
  const mc4PanelStatesStorageKey = `cew:mc4:panel_states:${mc4TodayYmd}`;
  const [mc4PanelStates, setMc4PanelStates] = useState(() => ({})); // { [panelId]: { left, right } }
  const mc4PanelStatesRef = useRef(mc4PanelStates);
  const [mc4TotalStringsCsv, setMc4TotalStringsCsv] = useState(null); // number | null
  const mc4HistoryRef = useRef({ actions: [], index: -1 });
  const [mc4HistoryTick, setMc4HistoryTick] = useState(0);
  const mc4EndsLayerRef = useRef(null); // L.LayerGroup

  useEffect(() => {
    mc4PanelStatesRef.current = mc4PanelStates;
  }, [mc4PanelStates]);

  const mc4GetPanelState = useCallback((panelId) => {
    const s = mc4PanelStatesRef.current?.[panelId];
    return s && typeof s === 'object' ? { left: s.left ?? null, right: s.right ?? null } : { left: null, right: null };
  }, []);

  // mc4Cycle: cycle through states based on current selection mode
  const mc4Cycle = useCallback((cur) => {
    if (mc4SelectionMode === 'mc4') {
      // MC4 mode: toggle between NONE and MC4 (blue)
      if (cur == null) return MC4_PANEL_STATES.MC4;
      if (cur === MC4_PANEL_STATES.MC4) return MC4_PANEL_STATES.NONE;
      // If already terminated, can't change in MC4 mode
      return cur;
    } else if (mc4SelectionMode === 'termination') {
      // Termination mode: MC4 -> TERMINATED, or toggle TERMINATED off
      if (cur === MC4_PANEL_STATES.MC4) return MC4_PANEL_STATES.TERMINATED;
      if (cur === MC4_PANEL_STATES.TERMINATED) return MC4_PANEL_STATES.MC4; // back to MC4, not NONE
      // Can't terminate if not MC4 first
      return cur;
    }
    // No mode selected - default cycle
    if (cur == null) return MC4_PANEL_STATES.MC4;
    if (cur === MC4_PANEL_STATES.MC4) return MC4_PANEL_STATES.TERMINATED;
    return MC4_PANEL_STATES.NONE;
  }, [mc4SelectionMode]);

  // mc4ForwardOnly: for box selection - only advance state, never go back
  const mc4ForwardOnly = useCallback((cur) => {
    if (mc4SelectionMode === 'mc4') {
      // MC4 mode: set to MC4 (blue) if not already
      if (cur == null) return MC4_PANEL_STATES.MC4;
      return cur; // Don't change if already MC4 or TERMINATED
    } else if (mc4SelectionMode === 'termination') {
      // Termination mode: advance to TERMINATED if currently MC4
      if (cur === MC4_PANEL_STATES.MC4) return MC4_PANEL_STATES.TERMINATED;
      if (cur === MC4_PANEL_STATES.TERMINATED) return MC4_PANEL_STATES.TERMINATED;
      // Can't terminate if not MC4 first - leave as is
      return cur;
    }
    // No mode selected - default forward
    if (cur == null) return MC4_PANEL_STATES.MC4;
    if (cur === MC4_PANEL_STATES.MC4) return MC4_PANEL_STATES.TERMINATED;
    return MC4_PANEL_STATES.TERMINATED;
  }, [mc4SelectionMode]);

  const mc4ApplyAction = useCallback((action, direction) => {
    if (!action?.changes?.length) return;
    setMc4PanelStates((prev) => {
      const out = { ...(prev || {}) };
      action.changes.forEach((c) => {
        if (!c?.id) return;
        const v = direction === 'undo' ? c.prev : c.next;
        if (!v || (v.left == null && v.right == null)) delete out[c.id];
        else out[c.id] = { left: v.left ?? null, right: v.right ?? null };
      });
      return out;
    });
  }, []);

  const mc4PushHistory = useCallback((changes) => {
    if (!changes?.length) return;
    const h = mc4HistoryRef.current;
    const nextActions = h.actions.slice(0, h.index + 1);
    nextActions.push({ changes, ts: Date.now() });
    h.actions = nextActions.slice(-80);
    h.index = h.actions.length - 1;
    setMc4HistoryTick((t) => t + 1);
  }, []);

  const mc4CanUndo = isMC4 && mc4HistoryRef.current.index >= 0;
  const mc4CanRedo = isMC4 && mc4HistoryRef.current.index < (mc4HistoryRef.current.actions.length - 1);
  const mc4Undo = useCallback(() => {
    const h = mc4HistoryRef.current;
    if (h.index < 0) return;
    const action = h.actions[h.index];
    mc4ApplyAction(action, 'undo');
    h.index -= 1;
    setMc4HistoryTick((t) => t + 1);
  }, [mc4ApplyAction]);

  const mc4Redo = useCallback(() => {
    const h = mc4HistoryRef.current;
    if (h.index >= h.actions.length - 1) return;
    const action = h.actions[h.index + 1];
    mc4ApplyAction(action, 'redo');
    h.index += 1;
    setMc4HistoryTick((t) => t + 1);
  }, [mc4ApplyAction]);

  // Reset histories on module switch
  useEffect(() => {
    selectionHistoryRef.current = { past: [], future: [] };
    selectionPrevSnapshotRef.current = Array.from(selectedPolygons || []).sort();
    setSelectionHistoryTick((t) => t + 1);

    lvInvHistoryRef.current = { past: [], future: [] };
    lvInvPrevSnapshotRef.current = Array.from(lvCompletedInvIds || []).sort();
    setLvInvHistoryTick((t) => t + 1);

    mvfPartsHistoryRef.current = { past: [], future: [] };
    mvfPartsPrevSnapshotRef.current = cloneMvfParts(mvfSelectedTrenchParts || []);
    setMvfPartsHistoryTick((t) => t + 1);

    lvttTermHistoryRef.current = { actions: [], index: -1 };
    setLvttTermHistoryTick((t) => t + 1);

    mvtTermHistoryRef.current = { actions: [], index: -1 };
    setMvtTermHistoryTick((t) => t + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode?.key]);

  // Track selectedPolygons changes for undo/redo
  useEffect(() => {
    if (selectionHistorySuspendRef.current) return;
    const next = Array.from(selectedPolygons || []).sort();
    const prev = selectionPrevSnapshotRef.current || [];
    if (!arraysEqualShallow(prev, next)) {
      pushSnapshotHistory(selectionHistoryRef, prev, setSelectionHistoryTick);
      selectionPrevSnapshotRef.current = next;
    }
  }, [selectedPolygons]);

  // Track LV inverter completion changes for undo/redo
  useEffect(() => {
    if (!isLV) return;
    if (lvInvHistorySuspendRef.current) return;
    const next = Array.from(lvCompletedInvIds || []).sort();
    const prev = lvInvPrevSnapshotRef.current || [];
    if (!arraysEqualShallow(prev, next)) {
      pushSnapshotHistory(lvInvHistoryRef, prev, setLvInvHistoryTick);
      lvInvPrevSnapshotRef.current = next;
    }
  }, [isLV, lvCompletedInvIds]);

  // Track MVF selected trench parts changes for undo/redo
  useEffect(() => {
    if (!isMVF) return;
    if (mvfPartsHistorySuspendRef.current) return;
    const nextIds = (mvfSelectedTrenchParts || []).map((p) => String(p?.id || '')).filter(Boolean);
    const prevIds = (mvfPartsPrevSnapshotRef.current || []).map((p) => String(p?.id || '')).filter(Boolean);
    if (!arraysEqualShallow(prevIds, nextIds)) {
      pushSnapshotHistory(mvfPartsHistoryRef, cloneMvfParts(mvfPartsPrevSnapshotRef.current || []), setMvfPartsHistoryTick);
      mvfPartsPrevSnapshotRef.current = cloneMvfParts(mvfSelectedTrenchParts || []);
    }
  }, [isMVF, mvfSelectedTrenchParts]);

  const resumeAsync = (ref) => {
    try {
      queueMicrotask(() => { ref.current = false; });
    } catch (_e) {
      void _e;
      setTimeout(() => { ref.current = false; }, 0);
    }
  };

  const selectionCanUndo = selectionHistoryTick >= 0 && selectionHistoryRef.current.past.length > 0;
  const selectionCanRedo = selectionHistoryTick >= 0 && selectionHistoryRef.current.future.length > 0;
  const selectionUndo = useCallback(() => {
    const h = selectionHistoryRef.current;
    if (!h.past.length) return;
    const current = Array.from(selectedPolygonsRef.current || []).sort();
    const previous = h.past[h.past.length - 1] || [];
    h.past = h.past.slice(0, -1);
    h.future = [current, ...h.future].slice(0, HISTORY_LIMIT);
    selectionHistorySuspendRef.current = true;
    selectionPrevSnapshotRef.current = previous;
    setSelectedPolygons(new Set(previous));
    setSelectionHistoryTick((t) => t + 1);
    resumeAsync(selectionHistorySuspendRef);
  }, [setSelectedPolygons]);

  const selectionRedo = useCallback(() => {
    const h = selectionHistoryRef.current;
    if (!h.future.length) return;
    const current = Array.from(selectedPolygonsRef.current || []).sort();
    const next = h.future[0] || [];
    h.future = h.future.slice(1);
    h.past = [...h.past, current].slice(-HISTORY_LIMIT);
    selectionHistorySuspendRef.current = true;
    selectionPrevSnapshotRef.current = next;
    setSelectedPolygons(new Set(next));
    setSelectionHistoryTick((t) => t + 1);
    resumeAsync(selectionHistorySuspendRef);
  }, [setSelectedPolygons]);

  const lvInvCanUndo = lvInvHistoryTick >= 0 && lvInvHistoryRef.current.past.length > 0;
  const lvInvCanRedo = lvInvHistoryTick >= 0 && lvInvHistoryRef.current.future.length > 0;
  const lvInvUndo = useCallback(() => {
    const h = lvInvHistoryRef.current;
    if (!h.past.length) return;
    const current = Array.from(lvCompletedInvIdsRef.current || []).sort();
    const previous = h.past[h.past.length - 1] || [];
    h.past = h.past.slice(0, -1);
    h.future = [current, ...h.future].slice(0, HISTORY_LIMIT);
    lvInvHistorySuspendRef.current = true;
    lvInvPrevSnapshotRef.current = previous;
    setLvCompletedInvIds(new Set(previous));
    setLvInvHistoryTick((t) => t + 1);
    resumeAsync(lvInvHistorySuspendRef);
  }, [setLvCompletedInvIds]);

  const lvInvRedo = useCallback(() => {
    const h = lvInvHistoryRef.current;
    if (!h.future.length) return;
    const current = Array.from(lvCompletedInvIdsRef.current || []).sort();
    const next = h.future[0] || [];
    h.future = h.future.slice(1);
    h.past = [...h.past, current].slice(-HISTORY_LIMIT);
    lvInvHistorySuspendRef.current = true;
    lvInvPrevSnapshotRef.current = next;
    setLvCompletedInvIds(new Set(next));
    setLvInvHistoryTick((t) => t + 1);
    resumeAsync(lvInvHistorySuspendRef);
  }, [setLvCompletedInvIds]);

  const mvfPartsCanUndo = mvfPartsHistoryTick >= 0 && mvfPartsHistoryRef.current.past.length > 0;
  const mvfPartsCanRedo = mvfPartsHistoryTick >= 0 && mvfPartsHistoryRef.current.future.length > 0;
  const mvfPartsUndo = useCallback(() => {
    const h = mvfPartsHistoryRef.current;
    if (!h.past.length) return;
    const current = cloneMvfParts(mvfSelectedTrenchPartsRef.current || []);
    const previous = h.past[h.past.length - 1] || [];
    h.past = h.past.slice(0, -1);
    h.future = [current, ...h.future].slice(0, HISTORY_LIMIT);
    mvfPartsHistorySuspendRef.current = true;
    mvfPartsPrevSnapshotRef.current = cloneMvfParts(previous);
    setMvfSelectedTrenchParts(cloneMvfParts(previous));
    setMvfPartsHistoryTick((t) => t + 1);
    resumeAsync(mvfPartsHistorySuspendRef);
  }, [setMvfSelectedTrenchParts]);

  const mvfPartsRedo = useCallback(() => {
    const h = mvfPartsHistoryRef.current;
    if (!h.future.length) return;
    const current = cloneMvfParts(mvfSelectedTrenchPartsRef.current || []);
    const next = h.future[0] || [];
    h.future = h.future.slice(1);
    h.past = [...h.past, current].slice(-HISTORY_LIMIT);
    mvfPartsHistorySuspendRef.current = true;
    mvfPartsPrevSnapshotRef.current = cloneMvfParts(next);
    setMvfSelectedTrenchParts(cloneMvfParts(next));
    setMvfPartsHistoryTick((t) => t + 1);
    resumeAsync(mvfPartsHistorySuspendRef);
  }, [setMvfSelectedTrenchParts]);

  const lvttCanUndo = isLVTT && lvttTermHistoryRef.current.index >= 0;
  const lvttCanRedo = isLVTT && lvttTermHistoryRef.current.index < (lvttTermHistoryRef.current.actions.length - 1);
  const lvttUndo = useCallback(() => {
    const h = lvttTermHistoryRef.current;
    if (h.index < 0) return;
    const action = h.actions[h.index];
    h.index -= 1;
    setLvttTerminationByInv((prev) => {
      const base = prev && typeof prev === 'object' ? { ...prev } : {};
      base[action.invNorm] = Math.max(0, Math.min(3, Number(action.prev ?? 0)));
      return base;
    });
    setLvttTermHistoryTick((t) => t + 1);
  }, [setLvttTerminationByInv]);

  const lvttRedo = useCallback(() => {
    const h = lvttTermHistoryRef.current;
    if (h.index >= h.actions.length - 1) return;
    const action = h.actions[h.index + 1];
    h.index += 1;
    setLvttTerminationByInv((prev) => {
      const base = prev && typeof prev === 'object' ? { ...prev } : {};
      base[action.invNorm] = Math.max(0, Math.min(3, Number(action.next ?? 0)));
      return base;
    });
    setLvttTermHistoryTick((t) => t + 1);
  }, [setLvttTerminationByInv]);

  const mvtCanUndo = isMVT && mvtTermHistoryRef.current.index >= 0;
  const mvtCanRedo = isMVT && mvtTermHistoryRef.current.index < (mvtTermHistoryRef.current.actions.length - 1);
  const mvtUndo = useCallback(() => {
    const h = mvtTermHistoryRef.current;
    if (h.index < 0) return;
    const action = h.actions[h.index];
    h.index -= 1;
    setMvtTerminationByStation((prev) => {
      const base = prev && typeof prev === 'object' ? { ...prev } : {};
      base[action.stationNorm] = Math.max(0, Math.min(3, Number(action.prev ?? 0)));
      return base;
    });
    setMvtTermHistoryTick((t) => t + 1);
  }, [setMvtTerminationByStation]);

  const mvtRedo = useCallback(() => {
    const h = mvtTermHistoryRef.current;
    if (h.index >= h.actions.length - 1) return;
    const action = h.actions[h.index + 1];
    h.index += 1;
    setMvtTerminationByStation((prev) => {
      const base = prev && typeof prev === 'object' ? { ...prev } : {};
      base[action.stationNorm] = Math.max(0, Math.min(3, Number(action.next ?? 0)));
      return base;
    });
    setMvtTermHistoryTick((t) => t + 1);
  }, [setMvtTerminationByStation]);

  const globalCanUndo = noteMode
    ? canUndoNotes
    : (isMC4 ? mc4CanUndo
      : isLVTT ? lvttCanUndo
        : isMVT ? mvtCanUndo
          : isLV ? lvInvCanUndo
            : isMVF ? mvfPartsCanUndo
              : selectionCanUndo);

  const globalCanRedo = noteMode
    ? canRedoNotes
    : (isMC4 ? mc4CanRedo
      : isLVTT ? lvttCanRedo
        : isMVT ? mvtCanRedo
          : isLV ? lvInvCanRedo
            : isMVF ? mvfPartsCanRedo
              : selectionCanRedo);

  const globalUndo = useCallback(() => {
    if (noteMode) return void undoNotes();
    if (isMC4) return void mc4Undo();
    if (isLVTT) return void lvttUndo();
    if (isMVT) return void mvtUndo();
    if (isLV) return void lvInvUndo();
    if (isMVF) return void mvfPartsUndo();
    return void selectionUndo();
  }, [noteMode, undoNotes, isMC4, mc4Undo, isLVTT, lvttUndo, isMVT, mvtUndo, isLV, lvInvUndo, isMVF, mvfPartsUndo, selectionUndo]);

  const globalRedo = useCallback(() => {
    if (noteMode) return void redoNotes();
    if (isMC4) return void mc4Redo();
    if (isLVTT) return void lvttRedo();
    if (isMVT) return void mvtRedo();
    if (isLV) return void lvInvRedo();
    if (isMVF) return void mvfPartsRedo();
    return void selectionRedo();
  }, [noteMode, redoNotes, isMC4, mc4Redo, isLVTT, lvttRedo, isMVT, mvtRedo, isLV, lvInvRedo, isMVF, mvfPartsRedo, selectionRedo]);

  useEffect(() => {
    if (!isMC4) return;
    try {
      const raw = localStorage.getItem(mc4PanelStatesStorageKey);
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === 'object') setMc4PanelStates(obj);
      else setMc4PanelStates({});
    } catch (_e) {
      void _e;
      setMc4PanelStates({});
    }
    mc4HistoryRef.current = { actions: [], index: -1 };
    setMc4HistoryTick((t) => t + 1);
  }, [isMC4, mc4PanelStatesStorageKey]);

  useEffect(() => {
    if (!isMC4) return;
    try {
      localStorage.setItem(mc4PanelStatesStorageKey, JSON.stringify(mc4PanelStates || {}));
    } catch (_e) {
      void _e;
    }
  }, [isMC4, mc4PanelStatesStorageKey, mc4PanelStates]);

  // MVF: daily completion tracking for segments (click in panel to mark completed)
  const mvfTodayYmd = getTodayYmd();
  const mvfStoragePrefix = `cew:${String(activeMode?.key || 'MVF').toLowerCase()}`;
  const mvfStorageKey = `${mvfStoragePrefix}:segments_completed:${mvfTodayYmd}`;
  const mvfCommittedTrenchStorageKey = `${mvfStoragePrefix}:trench_committed:${mvfTodayYmd}`;
  const mvfCommittedTrenchPartsStorageKey = `${mvfStoragePrefix}:trench_parts_committed:${mvfTodayYmd}`;
  const mvfDoneSegmentsStorageKey = `${mvfStoragePrefix}:segments_done:${mvfTodayYmd}`;
  useEffect(() => {
    mvfCompletedSegmentsRef.current = mvfCompletedSegments;
  }, [mvfCompletedSegments]);

  useEffect(() => {
    mvfSelectedTrenchIdsRef.current = mvfSelectedTrenchIds;
  }, [mvfSelectedTrenchIds]);

  useEffect(() => {
    mvfCommittedTrenchIdsRef.current = mvfCommittedTrenchIds;
  }, [mvfCommittedTrenchIds]);

  useEffect(() => {
    mvfActiveSegmentKeysRef.current = mvfActiveSegmentKeys;
  }, [mvfActiveSegmentKeys]);

  useEffect(() => {
    mvfDoneSegmentKeysRef.current = mvfDoneSegmentKeys;
  }, [mvfDoneSegmentKeys]);

  useEffect(() => {
    mvfCurrentSegmentKeyRef.current = mvfCurrentSegmentKey;
  }, [mvfCurrentSegmentKey]);

  useEffect(() => {
    mvfSelectedTrenchPartsRef.current = mvfSelectedTrenchParts;
  }, [mvfSelectedTrenchParts]);

  useEffect(() => {
    mvfCommittedTrenchPartsRef.current = mvfCommittedTrenchParts;
  }, [mvfCommittedTrenchParts]);

  useEffect(() => {
    if (!isMVF) return;
    try {
      const raw = localStorage.getItem(mvfStorageKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setMvfCompletedSegments(new Set(arr.map(String)));
      else setMvfCompletedSegments(new Set());
    } catch (_e) {
      void _e;
      setMvfCompletedSegments(new Set());
    }
  }, [isMVF, mvfStorageKey]);

  // MVF: load committed trench IDs for today (submitted/locked)
  useEffect(() => {
    if (!isMVF) return;
    try {
      const raw = localStorage.getItem(mvfCommittedTrenchStorageKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setMvfCommittedTrenchIds(new Set(arr.map(String)));
      else setMvfCommittedTrenchIds(new Set());
    } catch (_e) {
      void _e;
      setMvfCommittedTrenchIds(new Set());
    }
  }, [isMVF, mvfCommittedTrenchStorageKey]);

  // MVF: load committed trench PARTS for today (submitted/locked)
  useEffect(() => {
    if (!isMVF) return;
    try {
      const raw = localStorage.getItem(mvfCommittedTrenchPartsStorageKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setMvfCommittedTrenchParts(arr);
      else setMvfCommittedTrenchParts([]);
    } catch (_e) {
      void _e;
      setMvfCommittedTrenchParts([]);
    }
  }, [isMVF, mvfCommittedTrenchPartsStorageKey]);

  // MVF: load done segments for today
  useEffect(() => {
    if (!isMVF) return;
    try {
      const raw = localStorage.getItem(mvfDoneSegmentsStorageKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setMvfDoneSegmentKeys(new Set(arr.map(String)));
      else setMvfDoneSegmentKeys(new Set());
    } catch (_e) {
      void _e;
      setMvfDoneSegmentKeys(new Set());
    }
  }, [isMVF, mvfDoneSegmentsStorageKey]);

  useEffect(() => {
    if (!isMVF) return;
    try {
      localStorage.setItem(mvfStorageKey, JSON.stringify(Array.from(mvfCompletedSegments)));
    } catch (_e) {
      void _e;
    }
  }, [isMVF, mvfStorageKey, mvfCompletedSegments]);

  // MVF: persist committed trench IDs for today
  useEffect(() => {
    if (!isMVF) return;
    try {
      localStorage.setItem(mvfCommittedTrenchStorageKey, JSON.stringify(Array.from(mvfCommittedTrenchIds)));
    } catch (_e) {
      void _e;
    }
  }, [isMVF, mvfCommittedTrenchStorageKey, mvfCommittedTrenchIds]);

  // MVF: persist committed trench PARTS for today
  useEffect(() => {
    if (!isMVF) return;
    try {
      localStorage.setItem(mvfCommittedTrenchPartsStorageKey, JSON.stringify(mvfCommittedTrenchParts || []));
    } catch (_e) {
      void _e;
    }
  }, [isMVF, mvfCommittedTrenchPartsStorageKey, mvfCommittedTrenchParts]);

  // MVF: persist done segments for today
  useEffect(() => {
    if (!isMVF) return;
    try {
      localStorage.setItem(mvfDoneSegmentsStorageKey, JSON.stringify(Array.from(mvfDoneSegmentKeys)));
    } catch (_e) {
      void _e;
    }
  }, [isMVF, mvfDoneSegmentsStorageKey, mvfDoneSegmentKeys]);

  // MVF: keep mv_trench selection style in sync without reloading GeoJSON.
  useEffect(() => {
    if (!isMVF) return;
    const baseStyle = {
      color: 'rgba(255,255,255,0.85)', // white (uncompleted)
      weight: 1.25,
      fill: false,
      fillOpacity: 0,
    };
    // NOTE: MVF "completion" is now tracked via clipped PART overlays.
    // Keep base mv_trench geometry always yellow; only the selected/committed portion is drawn in green overlays.
    const byId = mvfTrenchByIdRef.current || {};
    Object.keys(byId).forEach((id) => {
      const layer = byId[id];
      if (layer && typeof layer.setStyle === 'function') {
        layer.setStyle(baseStyle);
      }
    });
    mvfPrevSelectedTrenchRef.current = new Set();
  }, [isMVF]);

  // MC4: render panel end-status markers (blue=mc4, green=terminated)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!isMC4) {
      if (mc4EndsLayerRef.current) {
        try { mc4EndsLayerRef.current.remove(); } catch (_e) { void _e; }
      }
      mc4EndsLayerRef.current = null;
      return;
    }

    let layer = mc4EndsLayerRef.current;
    if (!layer) {
      // Create a custom pane for MC4 markers that doesn't capture mouse events
      if (!map.getPane('mc4markers')) {
        const pane = map.createPane('mc4markers');
        pane.style.pointerEvents = 'none';
        pane.style.zIndex = '650'; // Above polygons but below popups
      }
      layer = L.layerGroup({ pane: 'mc4markers' });
      mc4EndsLayerRef.current = layer;
      layer.addTo(map);
    }
    layer.clearLayers();

    const states = mc4PanelStatesRef.current || {};
    const panels = polygonById.current || {};
    
    // Zoom-based radius: scale markers based on zoom level (always visible)
    const zoom = map.getZoom();
    const baseRadius = 4;
    // Scale radius based on zoom (smaller when zoomed out, larger when zoomed in)
    const radius = Math.max(1.5, Math.min(8, baseRadius * Math.pow(1.2, zoom - 20)));
    
    const mk = (pos, st) => {
      const isMc4 = st === MC4_PANEL_STATES.MC4;
      const isTerm = st === MC4_PANEL_STATES.TERMINATED;
      if (!isMc4 && !isTerm) return null; // Don't create marker for null state
      const fill = isMc4 ? '#0066cc' : '#00aa00';
      const stroke = isMc4 ? '#004499' : '#007700';
      return L.circleMarker(pos, {
        radius: radius,
        color: stroke,
        weight: 1.5,
        fillColor: fill,
        fillOpacity: 0.9,
        opacity: 1,
        interactive: false,
        pane: 'mc4markers', // Use custom pane that doesn't capture clicks
      });
    };

    let markersAdded = 0;
    Object.keys(panels).forEach((id) => {
      const panel = panels[id];
      // Lazy compute mc4Ends if not yet calculated
      if (!panel.mc4Ends && typeof panel.computeEnds === 'function') {
        try {
          const ends = panel.computeEnds();
          if (ends) panel.mc4Ends = ends;
        } catch (_e) {
          // Map still not ready, skip
        }
      }
      const ends = panel.mc4Ends;
      if (!ends?.leftPos || !ends?.rightPos) return;
      const st = states[id] || { left: null, right: null };
      // Only add marker for ends that have a state (mc4 or terminated)
      if (st.left) {
        const m = mk(ends.leftPos, st.left);
        if (m) { layer.addLayer(m); markersAdded++; }
      }
      if (st.right) {
        const m = mk(ends.rightPos, st.right);
        if (m) { layer.addLayer(m); markersAdded++; }
      }
    });
  }, [isMC4, mc4HistoryTick, mc4PanelStates]);

  // MC4: update markers on zoom change (size/visibility depends on zoom)
  useEffect(() => {
    if (!isMC4) return;
    const map = mapRef.current;
    if (!map) return;
    const onZoom = () => {
      // Force re-render of markers by triggering state update
      setMc4HistoryTick((t) => t + 0.001);
    };
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [isMC4]);

  // LV: keep inv_id label colors in sync with completion state without reloading GeoJSON.
  useEffect(() => {
    if (!isLV) return;
    const labels = lvInvLabelByIdRef.current || {};
    const invStrokeColor = activeMode?.invIdTextStrokeColor || 'rgba(0,0,0,0.88)';
    const invStrokeWidthFactor =
      typeof activeMode?.invIdTextStrokeWidthFactor === 'number' ? activeMode.invIdTextStrokeWidthFactor : 1.45;
    const invBgColor = activeMode?.invIdTextBgColor || null;
    const invBgStrokeColor = activeMode?.invIdTextBgStrokeColor || null;
    const invBgStrokeWidth = typeof activeMode?.invIdTextBgStrokeWidth === 'number' ? activeMode.invIdTextBgStrokeWidth : 0;
    const invDoneTextColor = activeMode?.invIdDoneTextColor || 'rgba(11,18,32,0.98)';
    const invDoneTextColorNoBg = activeMode?.invIdDoneTextColorNoBg || 'rgba(34,197,94,0.98)';
    const invDoneBgColor = activeMode?.invIdDoneBgColor || 'rgba(34,197,94,0.92)';
    const invDoneBgStrokeColor = activeMode?.invIdDoneBgStrokeColor || 'rgba(255,255,255,0.70)';
    const invDoneBgStrokeWidth =
      typeof activeMode?.invIdDoneBgStrokeWidth === 'number' ? activeMode.invIdDoneBgStrokeWidth : 2;
    Object.keys(labels).forEach((invIdNorm) => {
      const lbl = labels[invIdNorm];
      if (!lbl) return;
      const done = lvCompletedInvIds.has(invIdNorm);
      const nextTextColor = done ? invDoneTextColor : 'rgba(255,255,255,0.98)';
      const nextTextColorNoBg = done ? invDoneTextColorNoBg : null;
      const nextBgColor = done ? invDoneBgColor : invBgColor;
      const nextBgStrokeColor = done ? invDoneBgStrokeColor : invBgStrokeColor;
      const nextBgStrokeWidth = done ? invDoneBgStrokeWidth : invBgStrokeWidth;

      let changed = false;
      if (lbl.options.textColor !== nextTextColor) { lbl.options.textColor = nextTextColor; changed = true; }
      if (lbl.options.textColorNoBg !== nextTextColorNoBg) { lbl.options.textColorNoBg = nextTextColorNoBg; changed = true; }
      if (lbl.options.bgColor !== nextBgColor) { lbl.options.bgColor = nextBgColor; changed = true; }
      if (lbl.options.bgStrokeColor !== nextBgStrokeColor) { lbl.options.bgStrokeColor = nextBgStrokeColor; changed = true; }
      if (lbl.options.bgStrokeWidth !== nextBgStrokeWidth) { lbl.options.bgStrokeWidth = nextBgStrokeWidth; changed = true; }
      if (lbl.options.textStrokeColor !== invStrokeColor) { lbl.options.textStrokeColor = invStrokeColor; changed = true; }
      if (lbl.options.textStrokeWidthFactor !== invStrokeWidthFactor) { lbl.options.textStrokeWidthFactor = invStrokeWidthFactor; changed = true; }

      if (changed) lbl.redraw?.();
    });
  }, [
    isLV,
    lvCompletedInvIds,
    activeMode?.invIdTextStrokeColor,
    activeMode?.invIdTextStrokeWidthFactor,
    activeMode?.invIdTextBgColor,
    activeMode?.invIdTextBgStrokeColor,
    activeMode?.invIdTextBgStrokeWidth,
    activeMode?.invIdDoneTextColor,
    activeMode?.invIdDoneTextColorNoBg,
    activeMode?.invIdDoneBgColor,
    activeMode?.invIdDoneBgStrokeColor,
    activeMode?.invIdDoneBgStrokeWidth,
  ]);

  const getNoteYmd = (note) =>
    note?.noteDate ||
    (note?.createdAt ? new Date(note.createdAt).toISOString().split('T')[0] : getTodayYmd());

  // Performance knobs (labels are the #1 cost in this app)
  const STRING_LABEL_MIN_ZOOM = 18; // only render string_text IDs when zoomed in
  const STRING_LABEL_MAX = 2500; // hard cap to avoid blowing up canvas on huge datasets
  const STRING_LABEL_PAD = 0.12; // smaller pad = fewer offscreen labels to build
  const STRING_LABEL_GRID_CELL_DEG = 0.001; // ~111m latitude; good speed/accuracy tradeoff
  const STRING_LABEL_CURSOR_PX = 28; // LV cursor-mode radius (px)
  const STRING_LABEL_CURSOR_MAX = 24; // LV cursor-mode max labels near cursor

  // string_text visibility can be controlled per module (default: always)
  const stringLabelsEnabledRef = useRef(true);
  const cursorLabelBoundsRef = useRef(null); // L.LatLngBounds | null
  const cursorPointRef = useRef(null); // L.Point | null (container point)
  const cursorMoveRafRef = useRef(null);
  useEffect(() => {
    const visibility = effectiveStringTextVisibility;
    // cursor mode starts fully hidden until we have an actual cursor position
    stringLabelsEnabledRef.current = visibility === 'always';
    cursorLabelBoundsRef.current = null;
    cursorPointRef.current = null;
  }, [effectiveStringTextVisibility, stringTextToggleEnabled]);

  // Reuse label instances to avoid GC churn on pan/zoom
  const stringTextLabelPoolRef = useRef([]); // L.TextLabel[]
  const stringTextLabelActiveCountRef = useRef(0);
  const lastStringLabelKeyRef = useRef(''); // bounds+zoom key; skip identical work
  const stringTextGridRef = useRef(null); // Map<cellKey, number[]> indices into stringTextPointsRef.current

  const scheduleStringTextLabelUpdate = useCallback(() => {
    if (!mapRef.current || !stringTextLayerRef.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const map = mapRef.current;
      const layer = stringTextLayerRef.current;
      const zoom = map.getZoom();
      const effVis = effectiveStringTextVisibilityRef.current;
      const toggleEnabled = stringTextToggleEnabledRef.current;

      // Hard kill when effective visibility is OFF
      if (effVis === 'none') {
        const pool = stringTextLabelPoolRef.current;
        const prevActive = stringTextLabelActiveCountRef.current;
        for (let i = 0; i < prevActive; i++) {
          const lbl = pool[i];
          if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
        }
        try {
          stringTextRendererRef.current?._clear?.();
        } catch (_e) {
          void _e;
        }
        stringTextLabelActiveCountRef.current = 0;
        lastStringLabelKeyRef.current = '';
        // Also clear MVT "TESTED" labels if present
        clearMvtTestedLabelsNow();
        clearMvtCounterLabelsNow();
        return;
      }

      // If we're in ALWAYS mode, keep labels enabled regardless of any transient pointer-state flags.
      if (effVis === 'always') {
        stringLabelsEnabledRef.current = true;
      }

      // string_text labels are hidden unless explicitly enabled (hover/cursor modes)
      if (!stringLabelsEnabledRef.current) {
        // remove any active pooled labels from the layer
        const pool = stringTextLabelPoolRef.current;
        const prevActive = stringTextLabelActiveCountRef.current;
        for (let i = 0; i < prevActive; i++) {
          const lbl = pool[i];
          if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
        }
        // Clear only the label canvas (prevents "ghost" text remnants)
        try {
          stringTextRendererRef.current?._clear?.();
        } catch (_e) {
          void _e;
        }
        stringTextLabelActiveCountRef.current = 0;
        lastStringLabelKeyRef.current = '';
        clearMvtTestedLabelsNow();
        clearMvtCounterLabelsNow();
        return;
      }

      // TEXT ON (always) should stay visible even when zooming out (LV/MVF).
      const minZoom = effVis === 'always' && toggleEnabled ? 0 : stringTextMinZoomCfg;
      if (zoom < minZoom) return;

      const visibility = effVis;
      const cursorBounds = visibility === 'cursor' ? cursorLabelBoundsRef.current : null;
      const cursorPoint = visibility === 'cursor' ? cursorPointRef.current : null;
      // In cursor mode, NEVER fall back to full-map bounds (that's what causes lag).
      if (visibility === 'cursor' && (!cursorBounds || !cursorPoint)) {
        const pool = stringTextLabelPoolRef.current;
        const prevActive = stringTextLabelActiveCountRef.current;
        for (let i = 0; i < prevActive; i++) {
          const lbl = pool[i];
          if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
        }
        // Clear the label canvas too (prevents stale glyphs lingering for a frame)
        try {
          stringTextRendererRef.current?._clear?.();
        } catch (_e) {
          void _e;
        }
        stringTextLabelActiveCountRef.current = 0;
        lastStringLabelKeyRef.current = '';
        // TESTED labels are not used in cursor mode; ensure they're hidden.
        clearMvtTestedLabelsNow();
        clearMvtCounterLabelsNow();
        return;
      }

      const bounds = cursorBounds || map.getBounds().pad(STRING_LABEL_PAD);
      // IMPORTANT: in cursor mode, include cursor pixel coords in key so tiny moves still trigger updates
      // (otherwise rounding can make different cursor positions look identical and leave stale labels on screen)
      const key = cursorBounds
        ? `${zoom}|cursor|${Math.round(cursorPoint.x)},${Math.round(cursorPoint.y)}|${bounds
            .getSouth()
            .toFixed(6)},${bounds.getWest().toFixed(6)},${bounds.getNorth().toFixed(6)},${bounds.getEast().toFixed(6)}`
        : `${zoom}|${bounds.getSouth().toFixed(5)},${bounds.getWest().toFixed(5)},${bounds.getNorth().toFixed(5)},${bounds.getEast().toFixed(5)}`;
      if (key === lastStringLabelKeyRef.current) return;
      lastStringLabelKeyRef.current = key;

      // Query candidates using the spatial grid if available; otherwise fall back to scanning.
      const candidates = [];
      const grid = stringTextGridRef.current;
      if (grid && grid.size) {
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const minLat = Math.floor(sw.lat / STRING_LABEL_GRID_CELL_DEG);
        const maxLat = Math.floor(ne.lat / STRING_LABEL_GRID_CELL_DEG);
        const minLng = Math.floor(sw.lng / STRING_LABEL_GRID_CELL_DEG);
        const maxLng = Math.floor(ne.lng / STRING_LABEL_GRID_CELL_DEG);

        for (let a = minLat; a <= maxLat; a++) {
          for (let b = minLng; b <= maxLng; b++) {
            const arr = grid.get(`${a}:${b}`);
            if (arr && arr.length) candidates.push(...arr);
          }
        }

        // Preserve original draw order to avoid visual changes under the MAX cap.
        candidates.sort((i, j) => i - j);
      }

      const points = stringTextPointsRef.current;
      const pool = stringTextLabelPoolRef.current;
      let count = 0;
      const maxCount = cursorBounds ? STRING_LABEL_CURSOR_MAX : STRING_LABEL_MAX;

      // MV Termination Mode: manual termination counters (0/3..3/3), NOT derived from selection.
      const mvtCountsByStation = isMVT ? (mvtTerminationByStationRef.current || {}) : null;

      const mvtTestStatusByStation = (() => {
        if (!isMVT) return null;
        const csv = mvtTestCsvByFromRef.current || {};
        const toCandidateFromKeys = (rawStationLabel) => {
          const raw = String(rawStationLabel || '').trim();
          const norm = normalizeId(raw);
          if (!norm) return [];
          const out = [norm];
          const pad2 = (n) => String(n).padStart(2, '0');
          const mSs = norm.match(/^ss(\d{1,2})$/i);
          const mSub = norm.match(/^sub(\d{1,2})$/i);
          // Support both padded and unpadded IDs, and both SSxx <-> SUBxx aliases
          if (mSs) {
            const nn = pad2(mSs[1]);
            out.push(`ss${nn}`);
            out.push(`sub${nn}`);
          }
          if (mSub) {
            const nn = pad2(mSub[1]);
            out.push(`sub${nn}`);
            out.push(`ss${nn}`);
          }
          return Array.from(new Set(out));
        };
        const statusOf = (rawStationLabel) => {
          const candidates = toCandidateFromKeys(rawStationLabel);
          let fromKey = '';
          let row = null;
          for (const k of candidates) {
            if (csv[k]) { fromKey = k; row = csv[k]; break; }
          }
          const phases = row && typeof row === 'object' ? row : {};
          const normStatus = (s) => {
            const u = String(s || '').trim().toUpperCase();
            return u === 'PASS' ? 'PASS' : (u ? 'FAIL' : 'N/A');
          };
          const l1s = normStatus(phases?.L1?.status || phases?.L1);
          const l2s = normStatus(phases?.L2?.status || phases?.L2);
          const l3s = normStatus(phases?.L3?.status || phases?.L3);
          const l1v = phases?.L1?.value != null ? String(phases.L1.value) : '';
          const l2v = phases?.L2?.value != null ? String(phases.L2.value) : '';
          const l3v = phases?.L3?.value != null ? String(phases.L3.value) : '';
          // Check if actually tested: at least one L1/L2/L3 has a value or non-N/A status
          const hasTested = Boolean(row) && (l1v || l2v || l3v || l1s !== 'N/A' || l2s !== 'N/A' || l3s !== 'N/A');
          const allPass = hasTested && l1s === 'PASS' && l2s === 'PASS' && l3s === 'PASS';
          const anyFail = hasTested && (l1s === 'FAIL' || l2s === 'FAIL' || l3s === 'FAIL');
          return {
            fromKey,
            phases: {
              L1: { value: l1v || '', status: l1s },
              L2: { value: l2v || '', status: l2s },
              L3: { value: l3v || '', status: l3s },
            },
            hasTested,
            allPass,
            anyFail,
          };
        };
        return { statusOf };
      })();

      const iterateIndices = candidates.length ? candidates : null;
      const total = iterateIndices ? iterateIndices.length : points.length;

      // Cursor mode: prioritize closest labels to cursor to keep it ultra-light.
      let cursorCandidates = null;
      if (cursorBounds) {
        const cp = cursorPointRef.current;
        if (cp) {
          const tmp = [];
          const r2 = STRING_LABEL_CURSOR_PX * STRING_LABEL_CURSOR_PX;
          for (let k = 0; k < total; k++) {
            const idx = iterateIndices ? iterateIndices[k] : k;
            const pt = points[idx];
            if (!pt) continue;
            if (!bounds.contains([pt.lat, pt.lng])) continue;
            const pxy = map.latLngToContainerPoint([pt.lat, pt.lng]);
            const dx = pxy.x - cp.x;
            const dy = pxy.y - cp.y;
            const d2 = dx * dx + dy * dy;
            if (d2 <= r2) tmp.push({ idx, d2 });
          }
          tmp.sort((a, b) => a.d2 - b.d2);
          cursorCandidates = tmp.slice(0, maxCount).map((t) => t.idx);
        }
      }

      const runTotal = cursorCandidates ? cursorCandidates.length : total;
      // MVT: slightly larger labels for SS / counter / TESTED only
      const mvtBaseSizeLocal = isMVT ? (Number(stringTextBaseSizeCfg) * 1.25) : Number(stringTextBaseSizeCfg);

      // DCCT: Get test data and filter state for coloring
      const dcctTestResults = isDCCT ? (dcctTestDataRef.current || {}) : null;
      const dcctActiveFilter = isDCCT ? dcctFilterRef.current : null;
      const dcctMapIdsSet = isDCCT ? (dcctMapIdsRef.current || new Set()) : null;

      for (let k = 0; k < runTotal; k++) {
        if (count >= maxCount) break;
        const idx = cursorCandidates ? cursorCandidates[k] : (iterateIndices ? iterateIndices[k] : k);
        const pt = points[idx];
        if (!pt) continue;
        if (!bounds.contains([pt.lat, pt.lng])) continue;

        // MVT: SS label color depends on manual counter; the counter itself is a separate clickable label.
        let nextText = pt.text;
        let nextTextColor = stringTextColorCfg;
        let nextOpacity = 1.0;

        if (isMVT && mvtCountsByStation) {
          const raw = String(pt.text || '').trim();
          const norm = normalizeId(raw);
          if (norm && /^ss\d{1,2}$/i.test(norm)) {
            const terminated = Math.max(0, Math.min(3, Number(mvtCountsByStation[norm] ?? 0)));
            // MVT rule: 3/3 => GREEN, otherwise WHITE (not red)
            nextTextColor = terminated === 3 ? 'rgba(34,197,94,0.98)' : 'rgba(255,255,255,0.98)';
          }
        }

        // DCCT: Color labels based on test results (passed=green, failed=red, not_tested=gray)
        if (isDCCT && dcctTestResults) {
          const norm = pt.stringId || normalizeId(pt.text);
          const testResult = dcctTestResults[norm];

          // Determine status: passed, failed, or not_tested
          // NOTE: If there's no CSV row for this ID, testResult is undefined => not_tested.
          const status = testResult === 'passed' ? 'passed' : testResult === 'failed' ? 'failed' : 'not_tested';
          
          // Color based on status
          if (status === 'passed') {
            nextTextColor = 'rgba(5,150,105,0.96)'; // Softer green
          } else if (status === 'failed') {
            nextTextColor = 'rgba(239,68,68,0.98)'; // Red
          } else {
            nextTextColor = 'rgba(148,163,184,0.98)'; // Gray (not tested)
          }
          
          // Apply filter: dim labels that don't match the active filter
          // NOTE: In DCCT we keep other labels stable; counter click only highlights the counter itself.
        }

        // Create once, then reuse
        let label = pool[count];
        if (!label) {
          label = L.textLabel([pt.lat, pt.lng], {
            text: nextText,
            renderer: stringTextRendererRef.current || canvasRenderer,
            textBaseSize: stringTextBaseSizeCfg,
            refZoom: stringTextRefZoomCfg,
            textStyle: stringTextStyleCfg,
            textColor: nextTextColor,
            textStrokeColor: stringTextStrokeColorCfg,
            textStrokeWidthFactor: stringTextStrokeWidthFactorCfg,
            minFontSize: stringTextMinFontSizeCfg,
            maxFontSize: stringTextMaxFontSizeCfg,
            rotation: pt.angle || 0,
            // MVT: make SS labels clickable too (same action as counter click)
            interactive: isMVT,
            radius: isMVT ? 22 : 0,
            bubblingMouseEvents: false,
          });
          pool[count] = label;
          // Attach click handler once; uses per-draw mutable fields.
          if (isMVT) {
            label.on('click', (evt) => {
              try {
                if (evt?.originalEvent) {
                  evt.originalEvent.stopImmediatePropagation?.();
                  L.DomEvent.stopPropagation(evt.originalEvent);
                  L.DomEvent.preventDefault(evt.originalEvent);
                }
              } catch (_e) { void _e; }
              const stationNorm = String(label._mvtStationNorm || '');
              const lockedNow = Boolean(label._mvtLocked);
              if (!stationNorm || lockedNow) return;
              const oe = evt?.originalEvent;
              const x = oe?.clientX ?? 0;
              const y = oe?.clientY ?? 0;
              const cur = Math.max(0, Math.min(3, Number(mvtTerminationByStationRef.current?.[stationNorm] ?? 0)));
              setMvtTermPopup({
                stationLabel: String(label._mvtStationLabel || '').trim() || stationNorm,
                stationNorm,
                draft: cur,
                x,
                y,
              });
            });
          }
        }

        // Update position + text/rotation then ensure it's on the layer
        const prevLatLng = typeof label.getLatLng === 'function' ? label.getLatLng() : null;
        const nextLatLng = [pt.lat, pt.lng];
        label.setLatLng(nextLatLng);
        let needsRedraw =
          !!cursorBounds ||
          (prevLatLng && (prevLatLng.lat !== pt.lat || prevLatLng.lng !== pt.lng));
        if (label.options.text !== nextText) {
          label.options.text = nextText;
          needsRedraw = true;
        }
        if (label.options.textColor !== nextTextColor) {
          label.options.textColor = nextTextColor;
          needsRedraw = true;
        }
        // Update per-draw MVT metadata for click handling on SS labels (+ readability background in MVT)
        if (isMVT) {
          const raw = String(pt.text || '').trim();
          const norm = normalizeId(raw);
          if (norm && /^ss\d{1,2}$/i.test(norm)) {
            const terminated = Math.max(0, Math.min(3, Number(mvtTerminationByStationRef.current?.[norm] ?? 0)));
            label._mvtStationNorm = norm;
            label._mvtStationLabel = raw;
            label._mvtLocked = terminated === 3;
            if (label.options.radius !== 22) { label.options.radius = 22; needsRedraw = true; }
            if (label.options.interactive !== true) { label.options.interactive = true; needsRedraw = true; }
            if (label.options.textBaseSize !== mvtBaseSizeLocal) { label.options.textBaseSize = mvtBaseSizeLocal; needsRedraw = true; }
            // Background pill for visibility
            if (label.options.bgColor !== 'rgba(10,15,25,0.75)') { label.options.bgColor = 'rgba(10,15,25,0.75)'; needsRedraw = true; }
            if (label.options.bgPaddingX !== 4) { label.options.bgPaddingX = 4; needsRedraw = true; }
            if (label.options.bgPaddingY !== 2) { label.options.bgPaddingY = 2; needsRedraw = true; }
            if (label.options.bgCornerRadius !== 3) { label.options.bgCornerRadius = 3; needsRedraw = true; }
          } else {
            label._mvtStationNorm = '';
            label._mvtStationLabel = '';
            label._mvtLocked = false;
            if (label.options.radius !== 0) { label.options.radius = 0; needsRedraw = true; }
            if (label.options.interactive !== false) { label.options.interactive = false; needsRedraw = true; }
            if (label.options.textBaseSize !== stringTextBaseSizeCfg) { label.options.textBaseSize = stringTextBaseSizeCfg; needsRedraw = true; }
            // Clear background when pooled label is reused for non-SS text
            if (label.options.bgColor != null) { label.options.bgColor = null; needsRedraw = true; }
            if (label.options.bgPaddingX !== 0) { label.options.bgPaddingX = 0; needsRedraw = true; }
            if (label.options.bgPaddingY !== 0) { label.options.bgPaddingY = 0; needsRedraw = true; }
            if (label.options.bgCornerRadius !== 0) { label.options.bgCornerRadius = 0; needsRedraw = true; }
          }
        }
        const nextRot = pt.angle || 0;
        if (label.options.rotation !== nextRot) {
          label.options.rotation = nextRot;
          needsRedraw = true;
        }
        if (!layer.hasLayer(label)) layer.addLayer(label);
        // In cursor mode, ALWAYS redraw after moving a label to prevent "ghost" canvas text.
        if (needsRedraw) label.redraw?.();

        count++;
      }

      // MVT: draw clickable termination counters next to each substation label.
      // Helper: compute the effective font size in pixels (must match L.TextLabel._updatePath)
      const computeFontSizePx = (baseSize) => {
        const scale = Math.pow(2, zoom - stringTextRefZoomCfg);
        let fs = (typeof baseSize === 'number' ? baseSize : stringTextBaseSizeCfg) * scale;
        const minFs = typeof stringTextMinFontSizeCfg === 'number' ? stringTextMinFontSizeCfg : null;
        const maxFs = typeof stringTextMaxFontSizeCfg === 'number' ? stringTextMaxFontSizeCfg : null;
        if (minFs != null) fs = Math.max(minFs, fs);
        if (maxFs != null) fs = Math.min(maxFs, fs);
        return fs;
      };

      // MVT: draw clickable termination counters next to each substation label.
      if (isMVT && mvtCounterLayerRef.current && mvtCountsByStation && !cursorBounds) {
        const counterLayer = mvtCounterLayerRef.current;
        const counterPool = mvtCounterLabelPoolRef.current;
        let counterCount = 0;

        const counterOffsetXFactorFor = (rawStation) => {
          const s = String(rawStation || '').trim();
          const n = Math.max(2, Math.min(10, s.length));
          // approx half text width in "em": n*0.6/2, plus gap ~1.1em
          return (n * 0.6) / 2 + 1.1;
        };

        for (let k = 0; k < runTotal; k++) {
          const idx = cursorCandidates ? cursorCandidates[k] : (iterateIndices ? iterateIndices[k] : k);
          const pt = points[idx];
          if (!pt) continue;
          if (!bounds.contains([pt.lat, pt.lng])) continue;

          const rawStation = String(pt.text || '').trim();
          const norm = normalizeId(rawStation);
          if (!(norm && /^ss\d{1,2}$/i.test(norm))) continue;

          // Place the label at the actual on-screen text location (important for click hit-testing).
          const fs = computeFontSizePx(mvtBaseSizeLocal);
          const rot = (pt.angle || 0) * Math.PI / 180;
          const baseP = map.latLngToContainerPoint([pt.lat, pt.lng]);
          const offX = counterOffsetXFactorFor(rawStation) * fs;
          const dx = Math.cos(rot) * offX;
          const dy = Math.sin(rot) * offX;
          const ll = map.containerPointToLatLng([baseP.x + dx, baseP.y + dy]);

          const terminated = Math.max(0, Math.min(3, Number(mvtCountsByStation[norm] ?? 0)));
          const locked = terminated === 3;
          const counterText = `${terminated}/3`;
          // MVT rule: 3/3 => GREEN, otherwise WHITE (not red)
          const counterColor = locked ? 'rgba(34,197,94,0.98)' : 'rgba(255,255,255,0.98)';

          let lbl = counterPool[counterCount];
          if (!lbl) {
            lbl = L.textLabel(ll, {
              text: counterText,
              renderer: canvasRenderer,
              textBaseSize: mvtBaseSizeLocal,
              refZoom: stringTextRefZoomCfg,
              textStyle: stringTextStyleCfg,
              textColor: counterColor,
              textStrokeColor: stringTextStrokeColorCfg,
              textStrokeWidthFactor: stringTextStrokeWidthFactorCfg,
              minFontSize: stringTextMinFontSizeCfg,
              maxFontSize: stringTextMaxFontSizeCfg,
              rotation: pt.angle || 0,
              underline: true,
              underlineColor: counterColor,
              bgColor: 'rgba(10,15,25,0.75)',
              bgPaddingX: 4,
              bgPaddingY: 2,
              bgCornerRadius: 3,
              offsetXFactor: 0,
              offsetYFactor: 0,
              radius: 18, // hitbox for canvas event detection
              interactive: true,
              pane: 'overlayPane',
              bubblingMouseEvents: false,
            });

            lbl.on('click', (evt) => {
              try {
                if (evt?.originalEvent) {
                  evt.originalEvent.stopImmediatePropagation?.();
                  L.DomEvent.stopPropagation(evt.originalEvent);
                  L.DomEvent.preventDefault(evt.originalEvent);
                }
              } catch (_e) { void _e; }
              const stationNorm = String(lbl._mvtStationNorm || '');
              const lockedNow = Boolean(lbl._mvtLocked);
              if (!stationNorm || lockedNow) return;
              const oe = evt?.originalEvent;
              const x = oe?.clientX ?? 0;
              const y = oe?.clientY ?? 0;
              const cur = Math.max(0, Math.min(3, Number(mvtTerminationByStationRef.current?.[stationNorm] ?? 0)));
              setMvtTermPopup({
                stationLabel: String(lbl._mvtStationLabel || '').trim() || stationNorm,
                stationNorm,
                draft: cur,
                x,
                y,
              });
            });

            lbl.on('mouseover', () => {
              try { if (!lbl._mvtLocked) map.getContainer().style.cursor = 'pointer'; } catch (_e) { void _e; }
            });
            lbl.on('mouseout', () => {
              try { map.getContainer().style.cursor = ''; } catch (_e) { void _e; }
            });

            counterPool[counterCount] = lbl;
          }

          lbl._mvtStationNorm = norm;
          lbl._mvtLocked = locked;
          lbl._mvtStationLabel = rawStation;

          lbl.setLatLng(ll);
          let redraw = false;
          if (lbl.options.text !== counterText) { lbl.options.text = counterText; redraw = true; }
          if (lbl.options.textColor !== counterColor) { lbl.options.textColor = counterColor; redraw = true; }
          if (lbl.options.rotation !== (pt.angle || 0)) { lbl.options.rotation = pt.angle || 0; redraw = true; }
          if (lbl.options.radius !== 18) { lbl.options.radius = 18; redraw = true; }
          if (lbl.options.textBaseSize !== mvtBaseSizeLocal) { lbl.options.textBaseSize = mvtBaseSizeLocal; redraw = true; }
          if (lbl.options.underline !== true) { lbl.options.underline = true; redraw = true; }
          if (lbl.options.underlineColor !== counterColor) { lbl.options.underlineColor = counterColor; redraw = true; }
          if (lbl.options.bgColor !== 'rgba(10,15,25,0.75)') { lbl.options.bgColor = 'rgba(10,15,25,0.75)'; redraw = true; }
          if (lbl.options.bgPaddingX !== 4) { lbl.options.bgPaddingX = 4; redraw = true; }
          if (lbl.options.bgPaddingY !== 2) { lbl.options.bgPaddingY = 2; redraw = true; }
          if (lbl.options.bgCornerRadius !== 3) { lbl.options.bgCornerRadius = 3; redraw = true; }

          if (!counterLayer.hasLayer(lbl)) counterLayer.addLayer(lbl);
          if (redraw) lbl.redraw?.();
          counterCount++;
        }

        const prevActive = mvtCounterLabelActiveCountRef.current;
        for (let i = counterCount; i < prevActive; i++) {
          const old = counterPool[i];
          if (old && counterLayer.hasLayer(old)) counterLayer.removeLayer(old);
        }
        mvtCounterLabelActiveCountRef.current = counterCount;
      } else {
        clearMvtCounterLabelsNow();
      }

      // MVT: draw clickable "TESTED" labels under each substation label (always visible when text is visible).
      if (isMVT && mvtTestedLayerRef.current && mvtTestStatusByStation && !cursorBounds) {
        const testedLayer = mvtTestedLayerRef.current;
        const testedPool = mvtTestedLabelPoolRef.current;
        let testedCount = 0;

        for (let k = 0; k < runTotal; k++) {
          const idx = cursorCandidates ? cursorCandidates[k] : (iterateIndices ? iterateIndices[k] : k);
          const pt = points[idx];
          if (!pt) continue;
          if (!bounds.contains([pt.lat, pt.lng])) continue;

          const rawStation = String(pt.text || '').trim();
          const normStation = normalizeId(rawStation);
          // Only render under Substation IDs (SSxx or SUBxx)
          if (!(normStation && (/^ss\d{1,2}$/i.test(normStation) || /^sub\d{1,2}$/i.test(normStation)))) continue;

          // Place the label at the actual on-screen "below" location.
          const fs = computeFontSizePx(mvtBaseSizeLocal);
          const rot = (pt.angle || 0) * Math.PI / 180;
          const baseP = map.latLngToContainerPoint([pt.lat, pt.lng]);
          const offY = 1.25 * fs;
          const dx = -Math.sin(rot) * offY;
          const dy = Math.cos(rot) * offY;
          const ll = map.containerPointToLatLng([baseP.x + dx, baseP.y + dy]);

          const st = mvtTestStatusByStation.statusOf(rawStation);
          // NOT TESTED = white, PASSED = green, FAILED = red
          let testedText = 'NOT TESTED';
          let testedColor = 'rgba(255,255,255,0.98)'; // white for NOT TESTED
          if (st.hasTested) {
            if (st.allPass) {
              testedText = 'PASSED';
              testedColor = 'rgba(34,197,94,0.98)'; // green
            } else {
              testedText = 'FAILED';
              testedColor = 'rgba(220,38,38,0.98)'; // red
            }
          }

          let lbl = testedPool[testedCount];
          if (!lbl) {
            lbl = L.textLabel(ll, {
              text: testedText,
              renderer: canvasRenderer,
              textBaseSize: mvtBaseSizeLocal,
              refZoom: stringTextRefZoomCfg,
              textStyle: stringTextStyleCfg,
              textColor: testedColor,
              textStrokeColor: stringTextStrokeColorCfg,
              textStrokeWidthFactor: stringTextStrokeWidthFactorCfg,
              minFontSize: stringTextMinFontSizeCfg,
              maxFontSize: stringTextMaxFontSizeCfg,
              rotation: pt.angle || 0,
              bgColor: 'rgba(10,15,25,0.75)',
              bgPaddingX: 4,
              bgPaddingY: 2,
              bgCornerRadius: 3,
              underline: true,
              underlineColor: testedColor,
              offsetYFactor: 0,
              offsetXFactor: 0,
              radius: 18, // hitbox for canvas event detection
              interactive: true,
              pane: 'overlayPane',
              bubblingMouseEvents: false,
            });
            // Attach click handlers once; use mutable fields on the label for latest station key.
            // IMPORTANT: Read phases directly from CSV ref at click time to avoid stale cache.
            lbl.on('click', (evt) => {
              try {
                if (evt?.originalEvent) {
                  evt.originalEvent.stopImmediatePropagation?.();
                  L.DomEvent.stopPropagation(evt.originalEvent);
                  L.DomEvent.preventDefault(evt.originalEvent);
                }
              } catch (_e) { void _e; }
              const stationLabel = String(lbl._mvtStationLabel || '').trim();
              // Directly lookup from CSV ref to get fresh data
              const csv = mvtTestCsvByFromRef.current || {};
              const normSt = normalizeId(stationLabel);
              // Generate candidate keys (ss05 -> sub05, sub05 -> ss05)
              const candKeys = [normSt];
              const pad2 = (n) => String(n).padStart(2, '0');
              const mSs = normSt.match(/^ss(\d{1,2})$/i);
              const mSub = normSt.match(/^sub(\d{1,2})$/i);
              if (mSs) {
                const nn = pad2(mSs[1]);
                candKeys.push(`ss${nn}`);
                candKeys.push(`sub${nn}`);
              }
              if (mSub) {
                const nn = pad2(mSub[1]);
                candKeys.push(`sub${nn}`);
                candKeys.push(`ss${nn}`);
              }
              let fromKey = '';
              let row = null;
              for (const k of candKeys) {
                if (csv[k]) { fromKey = k; row = csv[k]; break; }
              }
              const phases = row ? {
                L1: row.L1 || { value: '', status: 'N/A' },
                L2: row.L2 || { value: '', status: 'N/A' },
                L3: row.L3 || { value: '', status: 'N/A' },
              } : { L1: { value: '', status: 'N/A' }, L2: { value: '', status: 'N/A' }, L3: { value: '', status: 'N/A' } };
              // Debug log
              // eslint-disable-next-line no-console
              console.log('[TESTED click]', { stationLabel, normSt, candKeys, fromKey, row, phases, csvKeys: Object.keys(csv) });
              const oe = evt?.originalEvent;
              const x = oe?.clientX ?? 0;
              const y = oe?.clientY ?? 0;
              setMvtTestPopup({ stationLabel, fromKey, phases, x, y });
            });
            lbl.on('mouseover', () => {
              try { map.getContainer().style.cursor = 'pointer'; } catch (_e) { void _e; }
            });
            lbl.on('mouseout', () => {
              try { map.getContainer().style.cursor = ''; } catch (_e) { void _e; }
            });
            testedPool[testedCount] = lbl;
          }

          // Update mutable per-station fields for click
          lbl._mvtStationLabel = rawStation;
          lbl._mvtFromKey = st.fromKey;
          lbl._mvtPhases = st.phases;

          // Update position + style
          lbl.setLatLng(ll);
          let redraw = false;
          if (lbl.options.text !== testedText) { lbl.options.text = testedText; redraw = true; }
          if (lbl.options.rotation !== (pt.angle || 0)) { lbl.options.rotation = pt.angle || 0; redraw = true; }
          if (lbl.options.textColor !== testedColor) { lbl.options.textColor = testedColor; redraw = true; }
          if (lbl.options.underlineColor !== testedColor) { lbl.options.underlineColor = testedColor; redraw = true; }
          if (lbl.options.radius !== 18) { lbl.options.radius = 18; redraw = true; }
          if (lbl.options.textBaseSize !== mvtBaseSizeLocal) { lbl.options.textBaseSize = mvtBaseSizeLocal; redraw = true; }
          if (lbl.options.bgColor !== 'rgba(10,15,25,0.75)') { lbl.options.bgColor = 'rgba(10,15,25,0.75)'; redraw = true; }
          if (lbl.options.bgPaddingX !== 4) { lbl.options.bgPaddingX = 4; redraw = true; }
          if (lbl.options.bgPaddingY !== 2) { lbl.options.bgPaddingY = 2; redraw = true; }
          if (lbl.options.bgCornerRadius !== 3) { lbl.options.bgCornerRadius = 3; redraw = true; }
          if (!testedLayer.hasLayer(lbl)) testedLayer.addLayer(lbl);
          if (redraw) lbl.redraw?.();

          testedCount++;
        }

        const prevActive = mvtTestedLabelActiveCountRef.current;
        for (let i = testedCount; i < prevActive; i++) {
          const old = testedPool[i];
          if (old && testedLayer.hasLayer(old)) testedLayer.removeLayer(old);
        }
        mvtTestedLabelActiveCountRef.current = testedCount;
      } else {
        clearMvtTestedLabelsNow();
      }

      // Remove unused pooled labels from the layer (but keep them for reuse)
      const prevActive = stringTextLabelActiveCountRef.current;
      for (let i = count; i < prevActive; i++) {
        const lbl = pool[i];
        if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
      }
      stringTextLabelActiveCountRef.current = count;
    });
  }, [
    isMVT,
    stringTextBaseSizeCfg,
    stringTextColorCfg,
    stringTextStyleCfg,
    stringTextStrokeColorCfg,
    stringTextStrokeWidthFactorCfg,
    stringTextMinZoomCfg,
    stringTextMinFontSizeCfg,
    stringTextMaxFontSizeCfg,
    stringTextRefZoomCfg,
  ]);

  // MVT: when selection changes (especially box selection with no click event), refresh SS label counters/colors.
  useEffect(() => {
    if (!isMVT) return;
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isMVT, selectedPolygons, scheduleStringTextLabelUpdate]);

  // MVT: when counters change, refresh labels immediately.
  useEffect(() => {
    if (!isMVT) return;
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isMVT, mvtTerminationByStation, scheduleStringTextLabelUpdate]);

  // MVT: when CSV loads/changes, force label recompute so TESTED uses latest L1/L2/L3 values.
  useEffect(() => {
    if (!isMVT) return;
    // Wait until map + string layer exist
    if (!mapRef.current || !stringTextLayerRef.current) return;
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isMVT, mvtCsvVersion, scheduleStringTextLabelUpdate]);

  // DCCT: refresh labels when filter or test data changes
  useEffect(() => {
    if (!isDCCT) return;
    if (!mapRef.current || !stringTextLayerRef.current) return;
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isDCCT, dcctFilter, dcctTestData, dcctMapIds, scheduleStringTextLabelUpdate]);

  // MVT: close popups when leaving the mode.
  useEffect(() => {
    if (isMVT) return;
    setMvtTermPopup(null);
    setMvtTestPopup(null);
  }, [isMVT]);

  // Instant clear (no RAF delay) for cursor-leave / polygon-gate disable.
  const clearStringTextLabelsNow = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const layer = stringTextLayerRef.current;
    if (!layer) return;
    const pool = stringTextLabelPoolRef.current;
    const prevActive = stringTextLabelActiveCountRef.current;
    for (let i = 0; i < prevActive; i++) {
      const lbl = pool[i];
      if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
    }
    try {
      stringTextRendererRef.current?._clear?.();
    } catch (_e) {
      void _e;
    }
    stringTextLabelActiveCountRef.current = 0;
    lastStringLabelKeyRef.current = '';
  }, []);

  const clearMvtTestedLabelsNow = useCallback(() => {
    const layer = mvtTestedLayerRef.current;
    if (!layer) return;
    const pool = mvtTestedLabelPoolRef.current;
    const prevActive = mvtTestedLabelActiveCountRef.current;
    for (let i = 0; i < prevActive; i++) {
      const lbl = pool[i];
      if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
    }
    mvtTestedLabelActiveCountRef.current = 0;
  }, []);

  const clearMvtCounterLabelsNow = useCallback(() => {
    const layer = mvtCounterLayerRef.current;
    if (!layer) return;
    const pool = mvtCounterLabelPoolRef.current;
    const prevActive = mvtCounterLabelActiveCountRef.current;
    for (let i = 0; i < prevActive; i++) {
      const lbl = pool[i];
      if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
    }
    mvtCounterLabelActiveCountRef.current = 0;
  }, []);

  const clearLvttTermCounterLabelsNow = useCallback(() => {
    const layer = lvttTermCounterLayerRef.current;
    if (!layer) return;
    const pool = lvttTermCounterLabelPoolRef.current;
    const prevActive = lvttTermCounterLabelActiveCountRef.current;
    for (let i = 0; i < prevActive; i++) {
      const lbl = pool[i];
      if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
    }
    lvttTermCounterLabelActiveCountRef.current = 0;
    try {
      lvttTermCounterRendererRef.current?._clear?.();
    } catch (_e) {
      void _e;
    }
  }, []);

  // MVT: load/save manual termination counters (independent from TESTED).
  useEffect(() => {
    if (!isMVT) {
      setMvtTerminationByStation({});
      return;
    }
    try {
      const raw = localStorage.getItem('cew:mvt:termination_counts');
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === 'object') setMvtTerminationByStation(obj);
      else setMvtTerminationByStation({});
    } catch (_e) {
      void _e;
      setMvtTerminationByStation({});
    }
  }, [isMVT]);

  useEffect(() => {
    if (!isMVT) return;
    try {
      localStorage.setItem('cew:mvt:termination_counts', JSON.stringify(mvtTerminationByStation || {}));
    } catch (_e) {
      void _e;
    }
  }, [isMVT, mvtTerminationByStation]);

  // LVTT: load/save manual termination counters (persistent across sessions).
  useEffect(() => {
    if (!isLVTT) {
      setLvttTerminationByInv({});
      return;
    }
    try {
      const raw = localStorage.getItem('cew:lvtt:termination_counts');
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === 'object') setLvttTerminationByInv(obj);
      else setLvttTerminationByInv({});
    } catch (_e) {
      void _e;
      setLvttTerminationByInv({});
    }
  }, [isLVTT]);

  useEffect(() => {
    if (!isLVTT) return;
    try {
      localStorage.setItem('cew:lvtt:termination_counts', JSON.stringify(lvttTerminationByInv || {}));
    } catch (_e) {
      void _e;
    }
  }, [isLVTT, lvttTerminationByInv]);

  // MVT: load circuit test status CSV (grouped by `from`, phase L1/L2/L3 taken ONLY from that row group).
  useEffect(() => {
    if (!isMVT) {
      mvtTestCsvByFromRef.current = {};
      setMvtTestPanel(null);
      setMvtTestPopup(null);
      setMvtCsvTotals({ total: 0, fromRows: 0, toRows: 0 });
      clearMvtTestedLabelsNow();
      return;
    }

    let cancelled = false;
    const paths = [
      '/MV_TERMINATION_PROGRESS_TRACKING/mv_circuits_test.csv',
      '/MV_TERMINATION_PROGRESS_TRACKING/mv_circuit_test.csv',
      '/MV_TERMINATION_PROGRESS_TRACKING/mv_circuit_tests.csv',
    ];

      const parse = (text) => {
      const rawText = String(text || '');
      const rawLinesArr = rawText.split(/\r?\n/);
      const lines = rawLinesArr.map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) return { byFrom: {}, fromRows: 0, toRows: 0 };
      const first = String(lines[0] || '');
      const sep = (first.includes(';') && first.split(';').length > first.split(',').length) ? ';' : ',';
      const headerRaw = first
        .split(sep)
        .map((h) => h.replace(/^\uFEFF/, '').trim());
      const header = headerRaw.map((h) => h.toLowerCase());
      const fromIdx = header.findIndex((h) => h === 'from');
      const phaseIdx = header.findIndex((h) => h === 'phase');
      const remarksIdx = header.findIndex((h) => h === 'remarks' || h === 'result' || h === 'status');
      // value column (e.g. "L1 (GΩ)" or "value")
      const valueIdx =
        header.findIndex((h) => h.includes('gω') || h.includes('gohm') || h.includes('value') || h === 'l1' || h === 'l2' || h === 'l3');
      const toIdx = header.findIndex((h) => h === 'to');

      const out = {};
      let fromRows = 0;
      let toRows = 0;
      // Case A: row-per-phase format (has "phase" column)
      if (phaseIdx >= 0) {
        const normStatus = (s) => {
          const raw = String(s || '').trim();
          const u = raw.toUpperCase();
          if (!u) return 'N/A';
          if (u === 'PASS') return 'PASS';
          // Preserve user expectation: show "failed" when not PASS
          if (u.startsWith('FAIL')) return 'failed';
          return 'failed';
        };
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(sep).map((p) => p.trim());
          const rawFrom = fromIdx >= 0 ? parts[fromIdx] : parts[0];
          const rawTo = toIdx >= 0 ? parts[toIdx] : parts[1];
          const rawPhase = phaseIdx >= 0 ? parts[phaseIdx] : parts[2];
          const rawRemarks = remarksIdx >= 0 ? parts[remarksIdx] : (parts.length ? parts[parts.length - 1] : '');
          const rawVal = valueIdx >= 0 ? parts[valueIdx] : '';

          const fromKey = normalizeId(rawFrom);
          const toKey = normalizeId(rawTo);
          const phaseKey = String(rawPhase || '').trim().toUpperCase();
          const status = normStatus(rawRemarks);
          if (!fromKey) continue;
          if (phaseKey !== 'L1' && phaseKey !== 'L2' && phaseKey !== 'L3') continue;
          fromRows += 1;
          if (toKey) toRows += 1;
          if (!out[fromKey]) out[fromKey] = {};
          out[fromKey][phaseKey] = {
            // Show only the numeric test value (no unit like GΩ / G?)
            value: rawVal ? `${rawVal}` : '',
            status,
          };
        }
        return { byFrom: out, fromRows, toRows };
      }

      // Case B: wide format: from, L1, L2, L3 values on the same row
      // Support headers like "L1 (GΩ)" / "L1 (G?)" etc.
      const l1Idx = header.findIndex((h) => h === 'l1' || h.startsWith('l1'));
      const l2Idx = header.findIndex((h) => h === 'l2' || h.startsWith('l2'));
      const l3Idx = header.findIndex((h) => h === 'l3' || h.startsWith('l3'));
      const normStatus = (s) => {
        const raw = String(s || '').trim();
        const u = raw.toUpperCase();
        if (!u) return 'N/A';
        if (u === 'PASS') return 'PASS';
        if (u.startsWith('FAIL')) return 'failed';
        return 'failed';
      };
      const findPhaseStatusIdx = (phase) => {
        // Try columns like "L1 remarks", "L1 status", "L1 result"
        const p = phase.toLowerCase();
        return header.findIndex((h) =>
          (h.startsWith(p) && (h.includes('remark') || h.includes('status') || h.includes('result')))
        );
      };
      const l1StatusIdx = findPhaseStatusIdx('L1');
      const l2StatusIdx = findPhaseStatusIdx('L2');
      const l3StatusIdx = findPhaseStatusIdx('L3');

      const extractStatusesFromRemarks = (remarks) => {
        const r = String(remarks || '').trim();
        if (!r) return { L1: 'N/A', L2: 'N/A', L3: 'N/A' };
        // Pattern A: "L1 PASS, L2 FAILED, L3 PASS"
        const byLabel = {};
        const re = /(L[123])\s*[:=\-]?\s*(PASS|FAIL(?:ED)?|FAILED)/gi;
        let m;
        while ((m = re.exec(r)) != null) {
          byLabel[m[1].toUpperCase()] = normStatus(m[2]);
        }
        if (byLabel.L1 || byLabel.L2 || byLabel.L3) {
          return { L1: byLabel.L1 || 'N/A', L2: byLabel.L2 || 'N/A', L3: byLabel.L3 || 'N/A' };
        }
        // Pattern B: three tokens "PASS, FAILED, PASS" (assume order L1,L2,L3)
        const toks = r
          .split(/[\s,;/|]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => t.toUpperCase())
          .filter((t) => t === 'PASS' || t === 'FAIL' || t === 'FAILED' || t === 'FAILURE');
        if (toks.length >= 3) {
          return { L1: normStatus(toks[0]), L2: normStatus(toks[1]), L3: normStatus(toks[2]) };
        }
        // Fallback: single overall remark
        const overall = normStatus(r);
        return { L1: overall, L2: overall, L3: overall };
      };
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(sep).map((p) => p.trim());
        const rawFrom = fromIdx >= 0 ? parts[fromIdx] : parts[0];
        const rawTo = toIdx >= 0 ? parts[toIdx] : parts[1];
        const fromKey = normalizeId(rawFrom);
        const toKey = normalizeId(rawTo);
        if (!fromKey) continue;
        fromRows += 1;
        if (toKey) toRows += 1;
        if (!out[fromKey]) out[fromKey] = {};
        const overallRaw = remarksIdx >= 0 ? parts[remarksIdx] : '';
        const fromRemarks = extractStatusesFromRemarks(overallRaw);

        const mkVal = (idx) => {
          const v = idx >= 0 ? parts[idx] : '';
          const s = String(v || '').trim();
          // Show only the numeric test value (no unit like GΩ / G?)
          return s ? `${s}` : '';
        };
        const s1 = l1StatusIdx >= 0 ? normStatus(parts[l1StatusIdx]) : fromRemarks.L1;
        const s2 = l2StatusIdx >= 0 ? normStatus(parts[l2StatusIdx]) : fromRemarks.L2;
        const s3 = l3StatusIdx >= 0 ? normStatus(parts[l3StatusIdx]) : fromRemarks.L3;
        out[fromKey].L1 = { value: mkVal(l1Idx), status: s1 };
        out[fromKey].L2 = { value: mkVal(l2Idx), status: s2 };
        out[fromKey].L3 = { value: mkVal(l3Idx), status: s3 };
      }
      return { byFrom: out, fromRows, toRows, _meta: { textLen: rawText.length, rawLines: rawLinesArr.length, filteredLines: lines.length, keys: Object.keys(out).length } };
    };

    (async () => {
      let text = '';
      let usedUrl = '';
      for (const p of paths) {
        try {
          // Cache-bust to avoid stale/truncated CSV from browser cache
          const url = `${p}?v=${Date.now()}`;
          const r = await fetch(url, { cache: 'no-store' });
          if (r && r.ok) {
            text = await r.text();
            usedUrl = url;
            break;
          }
        } catch (_e) {
          void _e;
        }
      }
      if (cancelled) return;
      const parsed = parse(text);
      mvtTestCsvByFromRef.current = parsed.byFrom || {};
      try {
        const m = parsed?._meta || {};
        setMvtCsvDebug({
          url: usedUrl || '',
          textLen: Number(m.textLen || 0),
          rawLines: Number(m.rawLines || 0),
          filteredLines: Number(m.filteredLines || 0),
          keys: Number(m.keys || 0),
        });
      } catch (_e) { void _e; }
      const total = (Number(parsed.fromRows) + Number(parsed.toRows)) * 3;
      setMvtCsvTotals({ total: Number.isFinite(total) ? total : 0, fromRows: parsed.fromRows || 0, toRows: parsed.toRows || 0 });
      setMvtCsvVersion((v) => v + 1);
      // Debug: verify that key rows exist (helps diagnose mapping issues quickly)
      try {
        const keys = Object.keys(mvtTestCsvByFromRef.current || {});
        // eslint-disable-next-line no-console
        console.log('[MVT CSV] loaded', { rows: keys.length, hasSub05: Boolean(mvtTestCsvByFromRef.current?.sub05), fromRows: parsed.fromRows || 0, toRows: parsed.toRows || 0 });
        // eslint-disable-next-line no-console
        if (mvtTestCsvByFromRef.current?.sub05) console.log('[MVT CSV] sub05', mvtTestCsvByFromRef.current.sub05);
      } catch (_e) {
        void _e;
      }
      // Force a redraw so TESTED colors reflect the loaded CSV immediately.
      lastStringLabelKeyRef.current = '';
      scheduleStringTextLabelUpdate();
    })();

    return () => {
      cancelled = true;
    };
  }, [isMVT, scheduleStringTextLabelUpdate, clearMvtTestedLabelsNow]);

  // LVTT: load inverter test status CSV (grouped by `ind_id`, phase L1/L2/L3 rows per inverter).
  useEffect(() => {
    if (!isLVTT) {
      lvttTestCsvByInvRef.current = {};
      lvttInvMetaByNormRef.current = {};
      setLvttPopup(null);
      setLvttCsvTotals({ total: 0, passed: 0, failed: 0 });
      clearLvttTermCounterLabelsNow();
      return;
    }

    let cancelled = false;
    const paths = [
      '/LV_TERMINATION_and_TESTING PROGRESS/lv_testing.csv',
      '/LV_TERMINATION_and_TESTING PROGRESS/lv_test.csv',
    ];

    const parse = (text) => {
      const rawText = String(text || '');
      const rawLinesArr = rawText.split(/\r?\n/);
      const lines = rawLinesArr.map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) return { byInv: {}, total: 0, passed: 0, failed: 0 };
      const first = String(lines[0] || '');
      const sep = (first.includes(';') && first.split(';').length > first.split(',').length) ? ';' : ',';
      const headerRaw = first
        .split(sep)
        .map((h) => h.replace(/^\uFEFF/, '').trim());
      const header = headerRaw.map((h) => h.toLowerCase());
      // ind_id,phase,value,test voltage V,period min,remarks
      const invIdIdx = header.findIndex((h) => h === 'ind_id' || h === 'inv_id' || h === 'id');
      const phaseIdx = header.findIndex((h) => h === 'phase');
      const valueIdx = header.findIndex((h) => h === 'value' || h.includes('gω') || h.includes('gohm'));
      const remarksIdx = header.findIndex((h) => h === 'remarks' || h === 'result' || h === 'status');

      const normStatus = (s) => {
        const raw = String(s || '').trim();
        const u = raw.toUpperCase();
        if (!u) return 'N/A';
        if (u === 'PASS') return 'PASS';
        if (u.startsWith('FAIL')) return 'FAILED';
        return 'FAILED';
      };

      const out = {};
      let totalRows = 0;
      let passedRows = 0;
      let failedRows = 0;
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(sep).map((p) => p.trim());
        const rawInvId = invIdIdx >= 0 ? parts[invIdIdx] : parts[0];
        const rawPhase = phaseIdx >= 0 ? parts[phaseIdx] : parts[1];
        const rawValue = valueIdx >= 0 ? parts[valueIdx] : parts[2];
        const rawRemarks = remarksIdx >= 0 ? parts[remarksIdx] : (parts.length > 5 ? parts[5] : '');

        const invKey = normalizeId(rawInvId);
        const phaseKey = String(rawPhase || '').trim().toUpperCase();
        if (!invKey) continue;
        if (phaseKey !== 'L1' && phaseKey !== 'L2' && phaseKey !== 'L3') continue;

        totalRows++;
        const st = normStatus(rawRemarks);
        if (st === 'PASS') passedRows++;
        else failedRows++;

        if (!out[invKey]) out[invKey] = {};
        out[invKey][phaseKey] = {
          value: rawValue || '',
          status: st,
        };
      }

      // LV_TESTING counters are row-based; TOTAL should match CSV rows (excluding header).
      // Expectation: passedRows + failedRows === totalRows.
      return { byInv: out, total: totalRows, passed: passedRows, failed: failedRows };
    };

    (async () => {
      let text = '';
      for (const p of paths) {
        try {
          const url = `${p}?v=${Date.now()}`;
          const r = await fetch(url, { cache: 'no-store' });
          if (r && r.ok) {
            text = await r.text();
            break;
          }
        } catch (_e) {
          void _e;
        }
      }
      if (cancelled) return;
      const parsed = parse(text);
      lvttTestCsvByInvRef.current = parsed.byInv || {};
      setLvttCsvTotals({ total: parsed.total || 0, passed: parsed.passed || 0, failed: parsed.failed || 0 });
      // eslint-disable-next-line no-console
      console.log('[LVTT CSV] loaded', { inverters: Object.keys(lvttTestCsvByInvRef.current).length, passed: parsed.passed, failed: parsed.failed });
    })();

    return () => {
      cancelled = true;
    };
  }, [isLVTT]);

  // LVTT: refresh inv_id label colors when sub-mode, CSV, or manual counts change.
  useEffect(() => {
    if (!isLVTT) return;
    const labels = lvInvLabelByIdRef.current || {};
    // Fix for LVTT mode switching: Canvas renderer draws incrementally; clear before repaint to prevent text/color overlap.
    try {
      lvttInvIdRendererRef.current?._clear?.();
    } catch (_e) {
      void _e;
    }
    const updateOne = (invNorm, lbl) => {
      if (!lbl || !invNorm) return;
      const displayId = String(lbl._lvttDisplayId || '').trim() || String(lbl._lvttRaw || '').trim() || String(invNorm);
      const mode = String(lvttSubModeRef.current || 'termination');
      const nextText = displayId;
      let nextColor = 'rgba(255,255,255,0.98)';

      if (mode === 'termination') {
        const terminated = Math.max(0, Math.min(3, Number(lvttTerminationByInvRef.current?.[invNorm] ?? 0)));
        const locked = terminated === 3;
        nextColor = locked ? 'rgba(34,197,94,0.98)' : 'rgba(239,68,68,0.98)';
      } else {
        const testData = lvttTestCsvByInvRef.current?.[invNorm];
        if (testData) {
          const l1 = testData.L1?.status || 'N/A';
          const l2 = testData.L2?.status || 'N/A';
          const l3 = testData.L3?.status || 'N/A';
          const anyFail = l1 === 'FAILED' || l2 === 'FAILED' || l3 === 'FAILED';
          const allPass = l1 === 'PASS' && l2 === 'PASS' && l3 === 'PASS';
          if (anyFail) nextColor = 'rgba(239,68,68,0.98)';
          else if (allPass) nextColor = 'rgba(34,197,94,0.98)';
        }
      }

      let redraw = false;
      if (lbl.options.text !== nextText) { lbl.options.text = nextText; redraw = true; }
      if (lbl.options.textColor !== nextColor) { lbl.options.textColor = nextColor; redraw = true; }
      lbl._lvttLocked = mode === 'termination' && nextColor === 'rgba(34,197,94,0.98)';
      if (redraw) lbl.redraw?.();
    };

    Object.keys(labels).forEach((k) => updateOne(k, labels[k]));
  }, [isLVTT, lvttSubMode, lvttTerminationByInv, lvttCsvTotals]);

  // LVTT: draw clickable termination counters (0/3..3/3) under each inv_id, MV-termination-style.
  useEffect(() => {
    if (!isLVTT || !mapReady || !mapRef.current) return;

    if (String(lvttSubMode || 'termination') !== 'termination') {
      clearLvttTermCounterLabelsNow();
      return;
    }

    const map = mapRef.current;
    const layer = lvttTermCounterLayerRef.current;
    if (!layer) return;

    if (!lvttTermCounterRendererRef.current) lvttTermCounterRendererRef.current = L.canvas({ padding: 0.1 });

    const invScale = typeof activeMode?.invIdTextScale === 'number' ? activeMode.invIdTextScale : 1;
    const invBase = typeof activeMode?.invIdTextBaseSize === 'number' ? activeMode.invIdTextBaseSize : 19;
    const invRefZoom = typeof activeMode?.invIdTextRefZoom === 'number' ? activeMode.invIdTextRefZoom : 20;
    const invTextStyle = activeMode?.invIdTextStyle || '600';
    const invMinFs = typeof activeMode?.invIdTextMinFontSize === 'number' ? activeMode.invIdTextMinFontSize : null;
    const invMaxFs = typeof activeMode?.invIdTextMaxFontSize === 'number' ? activeMode.invIdTextMaxFontSize : null;
    const invStrokeColor = activeMode?.invIdTextStrokeColor || 'rgba(0,0,0,0.88)';
    const invStrokeWidthFactor =
      typeof activeMode?.invIdTextStrokeWidthFactor === 'number' ? activeMode.invIdTextStrokeWidthFactor : 1.45;

    const computeFontSizePx = () => {
      const zoom = map.getZoom();
      const scale = Math.pow(2, zoom - invRefZoom);
      let fs = (invBase * invScale) * scale;
      if (invMinFs != null) fs = Math.max(invMinFs, fs);
      if (invMaxFs != null) fs = Math.min(invMaxFs, fs);
      return fs;
    };

    const render = () => {
      try {
        lvttTermCounterRendererRef.current?._clear?.();
      } catch (_e) {
        void _e;
      }

      const fs = computeFontSizePx();
      const offY = 1.25 * fs;
      const metaByNorm = lvttInvMetaByNormRef.current || {};
      const pool = lvttTermCounterLabelPoolRef.current;
      let activeCount = 0;

      Object.keys(metaByNorm).forEach((invNorm) => {
        const meta = metaByNorm[invNorm];
        if (!meta) return;
        const lat = Number(meta.lat);
        const lng = Number(meta.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const terminated = Math.max(0, Math.min(3, Number(lvttTerminationByInvRef.current?.[invNorm] ?? 0)));
        const locked = terminated === 3;
        const color = locked ? 'rgba(34,197,94,0.98)' : 'rgba(239,68,68,0.98)';

        const rot = (Number(meta.angle) || 0) * Math.PI / 180;
        const baseP = map.latLngToContainerPoint([lat, lng]);
        const dx = -Math.sin(rot) * offY;
        const dy = Math.cos(rot) * offY;
        const ll = map.containerPointToLatLng([baseP.x + dx, baseP.y + dy]);

        let lbl = pool[activeCount];
        if (!lbl) {
          lbl = L.textLabel(ll, {
            text: `${terminated}/3`,
            renderer: lvttTermCounterRendererRef.current,
            textBaseSize: (invBase * invScale) * 0.95,
            refZoom: invRefZoom,
            textStyle: invTextStyle,
            textColor: color,
            textStrokeColor: invStrokeColor,
            textStrokeWidthFactor: invStrokeWidthFactor,
            minFontSize: invMinFs,
            maxFontSize: invMaxFs,
            rotation: Number(meta.angle) || 0,
            underline: true,
            underlineColor: color,
            underlineWidthFactor: 1,
            bgColor: 'rgba(10,15,25,0.75)',
            bgPaddingX: 4,
            bgPaddingY: 2,
            bgCornerRadius: 3,
            radius: 28, // big hitbox at all zoom levels
            interactive: true,
            pane: 'overlayPane',
            bubblingMouseEvents: false,
          });

          lbl.on('click', (evt) => {
            try {
              if (evt?.originalEvent) {
                evt.originalEvent.stopImmediatePropagation?.();
                L.DomEvent.stopPropagation(evt.originalEvent);
                L.DomEvent.preventDefault(evt.originalEvent);
              }
            } catch (_e) { void _e; }
            const invN = String(lbl._lvttInvNorm || '');
            if (!invN) return;
            const cur = Math.max(0, Math.min(3, Number(lvttTerminationByInvRef.current?.[invN] ?? 0)));
            if (cur === 3) return;
            const oe = evt?.originalEvent;
            const x = oe?.clientX ?? 0;
            const y = oe?.clientY ?? 0;
            setLvttPopup({
              mode: 'termination',
              invId: String(lbl._lvttDisplayId || ''),
              invIdNorm: invN,
              draft: cur,
              x,
              y,
            });
          });

          lbl.on('mouseover', () => {
            try { map.getContainer().style.cursor = 'pointer'; } catch (_e) { void _e; }
          });
          lbl.on('mouseout', () => {
            try { map.getContainer().style.cursor = ''; } catch (_e) { void _e; }
          });

          pool[activeCount] = lbl;
        }

        lbl._lvttInvNorm = invNorm;
        lbl._lvttDisplayId = String(meta.displayId || '').trim() || String(meta.raw || '').trim() || invNorm;

        lbl.setLatLng(ll);
        let redraw = false;
        const txt = `${terminated}/3`;
        if (lbl.options.text !== txt) { lbl.options.text = txt; redraw = true; }
        if (lbl.options.textColor !== color) { lbl.options.textColor = color; redraw = true; }
        if (lbl.options.underline !== true) { lbl.options.underline = true; redraw = true; }
        if (lbl.options.underlineColor !== color) { lbl.options.underlineColor = color; redraw = true; }
        if (lbl.options.rotation !== (Number(meta.angle) || 0)) { lbl.options.rotation = Number(meta.angle) || 0; redraw = true; }
        if (lbl.options.radius !== 28) { lbl.options.radius = 28; redraw = true; }
        if (!layer.hasLayer(lbl)) layer.addLayer(lbl);
        if (redraw) lbl.redraw?.();

        activeCount++;
      });

      const prevActive = lvttTermCounterLabelActiveCountRef.current;
      for (let i = activeCount; i < prevActive; i++) {
        const old = pool[i];
        if (old && layer.hasLayer(old)) layer.removeLayer(old);
      }
      lvttTermCounterLabelActiveCountRef.current = activeCount;
    };

    render();
    map.on('zoomend', render);
    map.on('moveend', render);
    return () => {
      map.off('zoomend', render);
      map.off('moveend', render);
    };
  }, [
    isLVTT,
    mapReady,
    lvttSubMode,
    lvttTerminationByInv,
    activeMode?.invIdTextScale,
    activeMode?.invIdTextBaseSize,
    activeMode?.invIdTextRefZoom,
    activeMode?.invIdTextStyle,
    activeMode?.invIdTextMinFontSize,
    activeMode?.invIdTextMaxFontSize,
    activeMode?.invIdTextStrokeColor,
    activeMode?.invIdTextStrokeWidthFactor,
    clearLvttTermCounterLabelsNow,
  ]);

  // When the effective visibility changes (TEXT ON/OFF or module config), immediately refresh labels.
  useEffect(() => {
    // Keep the internal gate consistent for "always" mode.
    stringLabelsEnabledRef.current = effectiveStringTextVisibility === 'always';
    if (effectiveStringTextVisibility === 'none') {
      cursorLabelBoundsRef.current = null;
      cursorPointRef.current = null;
    }
    scheduleStringTextLabelUpdate();
  }, [effectiveStringTextVisibility, scheduleStringTextLabelUpdate]);

  // TEXT ON must stay visible even when clicking/selecting; force a refresh on any click within the map container.
  useEffect(() => {
    if (!mapRef.current) return;
    if (effectiveStringTextVisibility !== 'always') return;
    const el = mapRef.current.getContainer();
    if (!el) return;

    const onAnyClickCapture = () => {
      // Bust key cache and redraw so canvas never "drops" labels after interactions.
      lastStringLabelKeyRef.current = '';
      scheduleStringTextLabelUpdate();
    };

    el.addEventListener('click', onAnyClickCapture, true);
    return () => el.removeEventListener('click', onAnyClickCapture, true);
  }, [effectiveStringTextVisibility, scheduleStringTextLabelUpdate]);
  
  // Hooks for daily log and export
  const { dailyLog, addRecord } = useDailyLog(activeMode?.key || 'DC');
  const { exportToExcel } = useChartExport();
  
  // Save notes to localStorage
  useEffect(() => {
    localStorage.setItem('cew_notes', JSON.stringify(notes));
  }, [notes]);

  // Keep selection/editing consistent when notes change (undo/redo or deletions)
  useEffect(() => {
    const ids = new Set(notes.map((n) => n.id));
    setSelectedNotes((prev) => new Set([...prev].filter((id) => ids.has(id))));

    if (editingNote && !ids.has(editingNote.id)) {
      setEditingNote(null);
      setNoteText('');
      setNoteDate('');
      setNotePhotoDataUrl(null);
      setNotePhotoName('');
    }
  }, [notes, editingNote]);
  
  // Render note markers on map
  useEffect(() => {
    if (!mapRef.current) return;

    const escapeHtml = (s) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    
    // Clear existing markers
    Object.values(noteMarkersRef.current).forEach(marker => marker.remove());
    noteMarkersRef.current = {};
    
    // Create markers for all notes (red dot)
    notes.forEach(note => {
      const isSelected = selectedNotes.has(note.id);
      
      const dotIcon = L.divIcon({
        className: 'custom-note-pin',
        html: `
          <div class="note-dot-hit ${isSelected ? 'selected' : ''}">
            <div class="note-dot-core"></div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
      });
      
      const marker = L.marker([note.lat, note.lng], { 
        icon: dotIcon,
        interactive: true,
        riseOnHover: true
      });

      // Tooltip: show instantly on hover if note has content (text and/or photo)
      const rawText = (note.text || '').trim();
      const hasPhoto = Boolean(note.photoDataUrl);
      if (rawText || hasPhoto) {
        const compact = rawText.replace(/\s+/g, ' ');
        const snippet = compact.length > 80 ? `${compact.slice(0, 80)}…` : compact;
        const tooltipText = snippet || (hasPhoto ? 'Photo attached' : '');
        marker.bindTooltip(escapeHtml(tooltipText), {
          direction: 'top',
          opacity: 0.98,
          className: 'note-tooltip',
          offset: [0, -12],
          sticky: false
        });

        marker.on('mouseover', () => marker.openTooltip());
        marker.on('mouseout', () => marker.closeTooltip());
      }
      
      marker.on('click', (e) => {
        e.originalEvent?.stopPropagation();
        L.DomEvent.stopPropagation(e);
        markerClickedRef.current = true;
        
        // Open popup immediately when marker is clicked
        setEditingNote(note);
        setNoteText(note.text || '');
        setNoteDate(getNoteYmd(note));
        setNotePhotoDataUrl(note.photoDataUrl || null);
        setNotePhotoName(note.photoName || '');
        marker.closeTooltip?.();
        
        // Reset flag after event propagation
        setTimeout(() => {
          markerClickedRef.current = false;
        }, 200);
      });
      
      marker.on('mousedown', (e) => {
        e.originalEvent?.stopPropagation();
        L.DomEvent.stopPropagation(e);
      });
      
      marker.addTo(mapRef.current);
      noteMarkersRef.current[note.id] = marker;
    });
  }, [notes, selectedNotes, noteMode]);
  
  // Handle Delete key for selected notes, Escape to close popup, and Ctrl+Z / Ctrl+Y for undo/redo (notes)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const active = document.activeElement;
      const isTyping =
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable);

      // Undo/Redo (only when not typing in an input/textarea)
      if (!isTyping && (e.ctrlKey || e.metaKey)) {
        const key = (e.key || '').toLowerCase();
        const isUndo = key === 'z' && !e.shiftKey;
        const isRedo = key === 'y' || (key === 'z' && e.shiftKey);

        if (isUndo) {
          e.preventDefault();
          globalUndo();
          return;
        }
        if (isRedo) {
          e.preventDefault();
          globalRedo();
          return;
        }
      }

      if (e.key === 'Escape') {
        setEditingNote(null);
        setNoteText('');
        setNoteDate('');
        setNotePhotoDataUrl(null);
        setNotePhotoName('');
      }
      if (e.key === 'Delete' && noteMode && selectedNotes.size > 0) {
        const toDelete = new Set(selectedNotes);
        setNotes(prev => prev.filter(n => !toDelete.has(n.id)));
        setSelectedNotes(new Set());
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [noteMode, selectedNotes, globalUndo, globalRedo, setNotes]);
  
  // Create new note at click position (no popup on create)
  const createNote = (latlng) => {
    const newNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      lat: latlng.lat,
      lng: latlng.lng,
      text: '',
      noteDate: getTodayYmd(),
      photoDataUrl: null,
      photoName: '',
      createdAt: new Date().toISOString()
    };
    setNotes(prev => [...prev, newNote]);
    // Don't open popup on create - user clicks the marker to edit
  };

  const handleNotePhotoSelected = (file) => {
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }
    // Keep localStorage safe-ish: reject very large images (Data URL can explode in size)
    const maxBytes = 1.5 * 1024 * 1024; // 1.5MB
    if (file.size > maxBytes) {
      alert('Image is too large. Please select an image under 1.5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!dataUrl) return;
      setNotePhotoDataUrl(dataUrl);
      setNotePhotoName(file.name || '');
    };
    reader.readAsDataURL(file);
  };
  
  // Save note text
  const saveNote = () => {
    if (!editingNote) return;
    setNotes(prev => prev.map(n => 
      n.id === editingNote.id
        ? { ...n, text: noteText, noteDate: noteDate || getNoteYmd(n), photoDataUrl: notePhotoDataUrl, photoName: notePhotoName }
        : n
    ));
    setEditingNote(null);
    setNoteText('');
    setNoteDate('');
    setNotePhotoDataUrl(null);
    setNotePhotoName('');
  };
  
  // Delete single note
  const deleteNote = (noteId) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
    setSelectedNotes(prev => {
      const next = new Set(prev);
      next.delete(noteId);
      return next;
    });
    setEditingNote(null);
    setNoteText('');
    setNoteDate('');
    setNotePhotoDataUrl(null);
    setNotePhotoName('');
  };
  
  // Delete all selected notes
  const deleteSelectedNotes = () => {
    if (selectedNotes.size === 0) return;
    const toDelete = new Set(selectedNotes);
    setNotes(prev => prev.filter(n => !toDelete.has(n.id)));
    setSelectedNotes(new Set());
  };

  // CSV load (module-aware)
  useEffect(() => {
    const csvPath = activeMode?.csvPath;
    const csvFormat = activeMode?.csvFormat || 'dc'; // 'dc' | 'lv' | 'mvf'
    if (!csvPath) return;

    fetch(csvPath)
      .then((res) => res.text())
      .then((text) => {
        // MC4 strings CSV: count unique IDs, used for totals (strings * 2 ends)
        if (csvFormat === 'mc4_strings') {
          try {
            const lines = text.split(/\r?\n/).filter((l) => l && l.trim());
            if (lines.length <= 1) {
              setMc4TotalStringsCsv(0);
            } else {
              const header = (lines[0] || '').toLowerCase();
              const hasHeader = header.includes('id') && header.includes('length');
              const start = hasHeader ? 1 : 0;
              // IMPORTANT: spec says "CSV contains 9056 strings" => count rows (not unique IDs).
              // (In the uploaded file each ID appears twice, so unique IDs would be 4528.)
              const rowCount = Math.max(0, lines.length - start);
              setMc4TotalStringsCsv(rowCount);
            }
          } catch (_e) {
            void _e;
            setMc4TotalStringsCsv(null);
          }
          // This mode doesn't use lengthData totals.
          setLengthData({});
          setTotalPlus(0);
          setTotalMinus(0);
          setMvfSegments([]);
          mvfSegmentLenByKeyRef.current = {};
          // Reset selection when switching modules (avoids mismatched IDs)
          setSelectedPolygons(new Set());
          setCompletedPlus(0);
          setCompletedMinus(0);
          return;
        }

        const dict = {}; // id -> {plus: number[], minus: number[]}

        if (csvFormat === 'dc') {
          const rows = text.split(/\r?\n/).slice(1);
          rows.forEach((r) => {
            const parts = r.split(',');
            if (parts.length >= 2) {
              const id = normalizeId(parts[0]);
              const valStr = parts[1].trim();
              const length = parseFloat(valStr);

              if (id && !isNaN(length)) {
                if (!dict[id]) dict[id] = { plus: [], minus: [] };
                if (valStr.startsWith('-') || length < 0) dict[id].minus.push(Math.abs(length));
                else dict[id].plus.push(length);
              }
            }
          });
        } else if (csvFormat === 'lv') {
          // LV CSV: usually tab-separated with columns: ID, Length (sometimes more cols)
          const lines = text.split(/\r?\n/).filter(Boolean);
          const header = (lines[0] || '').split(/\t|,/).map((h) => h.trim().toLowerCase());
          const idIdx = header.findIndex((h) => h === 'id' || h === 'inv_id' || h === 'inv');
          const lenIdx = header.findIndex((h) => h === 'length' || h === 'len' || h === 'meter' || h === 'm');

          const start = 1; // data rows
          for (let i = start; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;
            const parts = line.split(/\t|,/);

            const rawId = idIdx >= 0 ? parts[idIdx] : parts[0];
            const rawLen =
              lenIdx >= 0 ? parts[lenIdx] : (parts.length >= 2 ? parts[1] : parts[2]);

            const id = normalizeId(rawId);
            const len = parseFloat(String(rawLen ?? '').trim());
            if (!id || isNaN(len)) continue;
            if (!dict[id]) dict[id] = { plus: [], minus: [] };
            // LV has no +/- separation; treat as "+" (single length)
            dict[id].plus.push(len);
          }
        } else if (csvFormat === 'mvf') {
          // MV+FIBER CSV: from,to,length
          const toDisplayNode = (token) => {
            const t = String(token || '').trim();
            if (!t) return '';
            const low = t.toLowerCase();
            if (low === 'css') return 'CSS';
            const m = low.match(/^sub(\d{1,2})$/);
            if (m) return `SS${m[1].padStart(2, '0')}`;
            // Already SSxx?
            const m2 = t.match(/^ss(\d{1,2})$/i);
            if (m2) return `SS${String(m2[1]).padStart(2, '0')}`;
            return t.toUpperCase();
          };

          const lines = text.split(/\r?\n/).filter(Boolean);
          if (lines.length <= 1) {
            setLengthData({});
            setTotalPlus(0);
            setTotalMinus(0);
            setMvfSegments([]);
            mvfSegmentLenByKeyRef.current = {};
            return;
          }
          const header = (lines[0] || '').split(',').map((h) => h.trim().toLowerCase());
          const fromIdx = header.findIndex((h) => h === 'from');
          const toIdx = header.findIndex((h) => h === 'to');
          const lenIdx = header.findIndex((h) => h === 'length' || h === 'len' || h === 'm');

          const segs = [];
          const lenByKey = {};
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;
            const parts = line.split(',');
            const from = fromIdx >= 0 ? parts[fromIdx] : parts[0];
            const to = toIdx >= 0 ? parts[toIdx] : parts[1];
            const rawLen = lenIdx >= 0 ? parts[lenIdx] : parts[2];
            const len = parseFloat(String(rawLen ?? '').trim());
            if (isNaN(len)) continue;
            const dispFrom = toDisplayNode(from);
            const dispTo = toDisplayNode(to);
            const dispKey = `${dispFrom}-${dispTo}`;
            const key = normalizeId(dispKey);
            if (!key) continue;
            if (!dict[key]) dict[key] = { plus: [], minus: [] };
            dict[key].plus.push(len);
            lenByKey[key] = (lenByKey[key] || 0) + len;
            segs.push({ key, label: dispKey, length: len });
          }

          // Store segment list for the MVF right-side panel (dedupe by key)
          const uniq = new Map();
          segs.forEach((s) => {
            const prev = uniq.get(s.key);
            if (!prev) uniq.set(s.key, { ...s });
            else uniq.set(s.key, { ...prev, length: (prev.length || 0) + (s.length || 0) });
          });
          // Order: CSS legs first (SSxx-CSS), then the rest (SSxx-SSyy)
          const list = Array.from(uniq.values()).sort((a, b) => {
            const aCss = String(a.label || '').toUpperCase().includes('CSS');
            const bCss = String(b.label || '').toUpperCase().includes('CSS');
            if (aCss !== bCss) return aCss ? -1 : 1;
            return String(a.label || '').localeCompare(String(b.label || ''));
          });
          setMvfSegments(list);
          mvfSegmentLenByKeyRef.current = lenByKey;
        } else if (csvFormat === 'dcct_riso') {
          // DCCT: DC Cable Testing Progress CSV format
          // Columns: ID, Insulation Resistance (-), Insulation Resistance (+), remark
          // remark can be PASSED or FAILED
          const lines = text.split(/\r?\n/).filter((l) => l && l.trim());
          if (lines.length <= 1) {
            setDcctTestData({});
            setDcctCsvTotals({ total: 0, passed: 0, failed: 0 });
            dcctRisoByIdRef.current = {};
            return;
          }

          const header = (lines[0] || '').split(',').map((h) => h.trim().toLowerCase());
          const idIdx = header.findIndex((h) => h === 'id');
          const remarkIdx = header.findIndex((h) => h === 'remark');
          const minusIdx = header.findIndex((h) => h.includes('insulation') && h.includes('(-'));
          const plusIdx = header.findIndex((h) => h.includes('insulation') && h.includes('(+)'));

          const testResults = {}; // normalizedId -> 'passed' | 'failed'
          const risoById = {}; // normalizedId -> { plus, minus, status, remarkRaw }
          let passedCount = 0;
          let failedCount = 0;
          const uniqueIds = new Set();

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;
            const parts = line.split(',');
            const rawId = idIdx >= 0 ? parts[idIdx] : parts[0];
            const rawRemark = remarkIdx >= 0 ? parts[remarkIdx] : parts[parts.length - 1];
            const rawMinus = minusIdx >= 0 ? parts[minusIdx] : (parts.length >= 2 ? parts[1] : '');
            const rawPlus = plusIdx >= 0 ? parts[plusIdx] : (parts.length >= 3 ? parts[2] : '');

            const id = normalizeId(rawId);
            const remarkRaw = String(rawRemark || '').trim();
            const remark = remarkRaw.toLowerCase();

            if (!id) continue;

            // Only count unique IDs for totals
            if (!uniqueIds.has(id)) {
              uniqueIds.add(id);
              // Determine test result (use first occurrence if duplicate rows exist)
              let status = null;
              if (remark === 'passed' || remark === 'pass') {
                status = 'passed';
                testResults[id] = 'passed';
                passedCount++;
              } else if (remark === 'failed' || remark === 'fail') {
                status = 'failed';
                testResults[id] = 'failed';
                failedCount++;
              }

              risoById[id] = {
                plus: String(rawPlus ?? '').trim(),
                minus: String(rawMinus ?? '').trim(),
                status,
                remarkRaw,
              };
            }
          }

          setDcctTestData(testResults);
          dcctRisoByIdRef.current = risoById;
          setDcctCsvTotals({
            total: uniqueIds.size,
            passed: passedCount,
            failed: failedCount,
          });

          // DCCT doesn't use lengthData
          setLengthData({});
          setTotalPlus(0);
          setTotalMinus(0);
          setMvfSegments([]);
          mvfSegmentLenByKeyRef.current = {};
          setSelectedPolygons(new Set());
          setCompletedPlus(0);
          setCompletedMinus(0);
          return;
        } else {
          // Unknown format; keep empty
        }

        setLengthData(dict);

        // Calculate total +/- from all CSV data
        let allPlus = 0,
          allMinus = 0;
        Object.values(dict).forEach((data) => {
          if (data.plus) allPlus += data.plus.reduce((a, b) => a + b, 0);
          if (data.minus) allMinus += data.minus.reduce((a, b) => a + b, 0);
        });
        setTotalPlus(allPlus);
        setTotalMinus(allMinus);

        // Reset selection when switching modules (avoids mismatched IDs)
        setSelectedPolygons(new Set());
        setCompletedPlus(0);
        setCompletedMinus(0);
      })
      .catch((err) => console.error('CSV yüklenemedi:', err));
  }, [activeMode]);

  // Calculate counters when selection changes
  useEffect(() => {
    if (isLV) {
      // LV uses inv_id click tracking, not polygon selection.
      setCompletedPlus(0);
      setCompletedMinus(0);
      return;
    }
    let plus = 0;
    let minus = 0;
    
    // Collect unique string IDs from selected polygons
    const stringIds = new Set();
    selectedPolygons.forEach(polygonId => {
      const polygonInfo = polygonById.current[polygonId];
      if (polygonInfo && polygonInfo.stringId) {
        stringIds.add(normalizeId(polygonInfo.stringId));
      }
    });
    
    // Sum data for each unique string ID
    stringIds.forEach(stringId => {
      const data = lengthData[stringId];
      if (data) {
        if (data.plus && data.plus.length > 0) {
          plus += data.plus.reduce((a, b) => a + b, 0);
        }
        if (data.minus && data.minus.length > 0) {
          minus += data.minus.reduce((a, b) => a + b, 0);
        }
      }
    });
    
    setCompletedPlus(plus);
    setCompletedMinus(minus);
  }, [isLV, selectedPolygons, lengthData, stringMatchVersion]);

  // Store previous selection to compare changes
  const prevSelectedRef = useRef(new Set());

  // Update ONLY changed polygon colors (performance optimization)
  useEffect(() => {
    // DCCT: polygon colors are controlled by pass/fail status, not selection.
    if (isDCCT) return;
    const prevSelected = prevSelectedRef.current;
    const currentSelected = selectedPolygons;
    
    // Find polygons that need to be updated (added or removed from selection)
    const toUpdate = new Set();
    
    // Newly selected
    currentSelected.forEach(id => {
      if (!prevSelected.has(id)) toUpdate.add(id);
    });
    
    // Newly unselected
    prevSelected.forEach(id => {
      if (!currentSelected.has(id)) toUpdate.add(id);
    });
    
    // Update only changed polygons
    toUpdate.forEach(polygonId => {
      const polygonInfo = polygonById.current[polygonId];
      if (polygonInfo && polygonInfo.layer && polygonInfo.layer.setStyle) {
        const isSelected = currentSelected.has(polygonId);
        // IMPORTANT: when unselecting, restore the exact base style used by the layer
        // so it doesn't appear "whiter" after toggling.
        polygonInfo.layer.setStyle(
          isSelected
            ? {
                color: '#22c55e',
                weight: 2,
                fill: false,
                fillOpacity: 0
              }
            : {
                color: 'rgba(255,255,255,0.35)',
                weight: 1.05,
                fill: false,
                fillOpacity: 0
              }
        );
      }
    });
    
    // Save current selection for next comparison
    prevSelectedRef.current = new Set(currentSelected);
  }, [isDCCT, selectedPolygons]);

  // DCCT: color full-table polygon outlines based on CSV test result (same tone as ID labels).
  useEffect(() => {
    if (!isDCCT) return;

    const results = dcctTestDataRef.current || {};
    const panels = polygonById.current || {};

    // DCCT stroke tuning: keep outlines readable but not overly thick.
    const DCCT_STROKE = {
      baseWeight: 0.75,
      statusWeight: 1.25,
      highlightWeight: 1.85,
      dimWeight: 0.5,
    };

    const defaultStyle = {
      color: 'rgba(255,255,255,0.35)',
      weight: DCCT_STROKE.baseWeight,
      fill: false,
      fillOpacity: 0,
    };

    const activeFilter = dcctFilterRef.current;

    try {
      Object.keys(panels).forEach((pid) => {
        const info = panels[pid];
        const layer = info?.layer;
        if (!layer || typeof layer.setStyle !== 'function') return;
        const sid = normalizeId(info?.stringId);
        const r = sid ? results[sid] : null;

        // Determine status
        const status = r === 'passed' ? 'passed' : r === 'failed' ? 'failed' : 'not_tested';

        // Base colors
        let color = defaultStyle.color;
        let weight = defaultStyle.weight;
        if (status === 'passed') {
          color = 'rgba(5,150,105,0.96)';
          weight = DCCT_STROKE.statusWeight;
        } else if (status === 'failed') {
          color = 'rgba(239,68,68,0.98)';
          weight = DCCT_STROKE.statusWeight;
        }

        // Apply filter highlight/dim
        let opacity = 1.0;
        if (activeFilter) {
          const matches = activeFilter === status;
          if (matches) {
            // Highlight matching tables
            weight = DCCT_STROKE.highlightWeight;
            opacity = 1.0;
          } else {
            // Dim non-matching tables
            opacity = 0.12;
            weight = DCCT_STROKE.dimWeight;
          }
        }

        layer.setStyle({
          ...defaultStyle,
          color,
          weight,
          opacity,
        });
      });
    } catch (_e) {
      void _e;
    }
  }, [isDCCT, dcctTestData, dcctFilter, stringMatchVersion]);

  const fetchAllGeoJson = async () => {
    if (!mapRef.current) return;
    setStatus('Loading data...');

    layersRef.current.forEach(l => l.remove());
    layersRef.current = [];
    polygonById.current = {};
    polygonIdCounter.current = 0;
    stringTextPointsRef.current = [];
    stringTextGridRef.current = null;
    stringTextLabelPoolRef.current = [];
    stringTextLabelActiveCountRef.current = 0;
    lastStringLabelKeyRef.current = '';
    lvInvLabelByIdRef.current = {};
    if (stringTextLayerRef.current) {
      try { stringTextLayerRef.current.remove(); } catch (_e) { void _e; }
      stringTextLayerRef.current = null;
    }
    if (mvtTestedLayerRef.current) {
      try { mvtTestedLayerRef.current.remove(); } catch (_e) { void _e; }
      mvtTestedLayerRef.current = null;
    }
    if (mvtCounterLayerRef.current) {
      try { mvtCounterLayerRef.current.remove(); } catch (_e) { void _e; }
      mvtCounterLayerRef.current = null;
    }
    mvtTestedLabelPoolRef.current = [];
    mvtTestedLabelActiveCountRef.current = 0;
    mvtCounterLabelPoolRef.current = [];
    mvtCounterLabelActiveCountRef.current = 0;

    // LVTT: clear termination counter layer + cached inverter metadata on reload
    lvttInvMetaByNormRef.current = {};
    if (lvttTermCounterLayerRef.current) {
      try { lvttTermCounterLayerRef.current.remove(); } catch (_e) { void _e; }
      lvttTermCounterLayerRef.current = null;
    }
    lvttTermCounterLabelPoolRef.current = [];
    lvttTermCounterLabelActiveCountRef.current = 0;
    // MVF: clear highlight + trench graph on reload
    try {
      mvfHighlightLayerRef.current?.clearLayers?.();
    } catch (_e) {
      void _e;
    }
    mvfTrenchGraphRef.current = null;
    mvfTrenchByIdRef.current = {};
    mvfTrenchIdCounterRef.current = 0;
    mvfTrenchLenByIdRef.current = {};
    mvfTrenchEdgeIndexRef.current = new Map();
    setMvfTrenchTotalMeters(0);
    mvfPrevSelectedTrenchRef.current = new Set();
    setMvfSelectedTrenchIds(new Set());
    setMvfSelectedTrenchParts([]);
    
    const allBounds = L.latLngBounds();
    let totalFeatures = 0;
    let textCount = 0;
    const collectedPoints = [];
    
    // String text'leri topla (text konumları için)
    const stringTextMap = {}; // stringId -> {lat, lng, angle, text}

    for (const file of activeMode.geojsonFiles) {
      try {
        const response = await fetch(file.url, { cache: 'no-store' });
        if (!response.ok) {
          console.error('Error loading GeoJSON:', { url: file.url, name: file.name, status: response.status });
          continue;
        }
        const contentType = response.headers?.get?.('content-type') || '';
        const raw = await response.text();
        let data = null;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          console.error('Error loading GeoJSON:', {
            url: file.url,
            name: file.name,
            status: response.status,
            contentType,
            preview: String(raw || '').slice(0, 120),
          });
          continue;
        }
        totalFeatures += data.features?.length || 0;

        // MVF: build a graph from mv_trench for shortest-path highlighting
        if (isMVF && file.name === 'mv_trench' && data?.features?.length) {
          try {
            const nodes = new Map(); // key -> {lat,lng}
            const adj = new Map(); // key -> [{to,w}]
            const grid = new Map(); // cellKey -> [nodeKey]
            const GRID = 0.001;
            const keyOf = (lat, lng) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
            const addNode = (lat, lng) => {
              const k = keyOf(lat, lng);
              if (!nodes.has(k)) {
                nodes.set(k, { lat, lng });
                const a = Math.floor(lat / GRID);
                const b = Math.floor(lng / GRID);
                const cell = `${a}:${b}`;
                if (!grid.has(cell)) grid.set(cell, []);
                grid.get(cell).push(k);
              }
              if (!adj.has(k)) adj.set(k, []);
              return k;
            };
            const addEdge = (aK, bK) => {
              const a = nodes.get(aK);
              const b = nodes.get(bK);
              if (!a || !b) return;
              const w = L.latLng(a.lat, a.lng).distanceTo(L.latLng(b.lat, b.lng));
              adj.get(aK).push({ to: bK, w });
              adj.get(bK).push({ to: aK, w });
            };

            for (const f of data.features) {
              const geom = f?.geometry;
              if (!geom) continue;
              const type = geom.type;
              const addLine = (coords) => {
                if (!Array.isArray(coords) || coords.length < 2) return;
                let prevK = null;
                for (const c of coords) {
                  const lng = c?.[0];
                  const lat = c?.[1];
                  if (typeof lat !== 'number' || typeof lng !== 'number') continue;
                  const k = addNode(lat, lng);
                  if (prevK && prevK !== k) addEdge(prevK, k);
                  prevK = k;
                }
              };
              if (type === 'LineString') addLine(geom.coordinates);
              else if (type === 'MultiLineString') geom.coordinates?.forEach(addLine);
            }

            mvfTrenchGraphRef.current = { nodes, adj, grid, gridSize: GRID };
          } catch (_e) {
            void _e;
            mvfTrenchGraphRef.current = null;
          }
        }

        // Special handling for string_text - store points and render lazily for performance
        if (file.name === 'string_text') {
          const stringLayer = L.layerGroup();
          stringTextLayerRef.current = stringLayer;
          
          (data.features || []).forEach(feature => {
            if (feature.geometry?.type === 'Point' && feature.properties?.text) {
              const coords = feature.geometry.coordinates;
              if (!coords || coords.length < 2) return;
              
              const lat = coords[1];
              const lng = coords[0];
              const stringId = normalizeId(feature.properties.text);
              
              // Save point info
              collectedPoints.push({ id: stringId, lat, lng });
              stringTextMap[stringId] = { lat, lng, angle: feature.properties.angle || 0, text: feature.properties.text };
              
              // Store for lazy rendering
              stringTextPointsRef.current.push({
                lat,
                lng,
                stringId,
                text: feature.properties.text,
                angle: feature.properties.angle || 0
              });
              
              allBounds.extend([lat, lng]);
            }
          });

          // DCCT: Collect all map IDs from string_text for Not Tested calculation
          if (isDCCT) {
            const mapIds = new Set();
            stringTextPointsRef.current.forEach((pt) => {
              if (pt.stringId) mapIds.add(pt.stringId);
            });
            setDcctMapIds(mapIds);
          }
          
          stringLayer.addTo(mapRef.current);
          layersRef.current.push(stringLayer);

          // MVT: create a separate interactive layer for "TESTED" labels (clickable).
          if (isMVT) {
            const testedLayer = L.layerGroup();
            mvtTestedLayerRef.current = testedLayer;
            testedLayer.addTo(mapRef.current);
            layersRef.current.push(testedLayer);

            const counterLayer = L.layerGroup();
            mvtCounterLayerRef.current = counterLayer;
            counterLayer.addTo(mapRef.current);
            layersRef.current.push(counterLayer);
          } else {
            mvtTestedLayerRef.current = null;
            mvtCounterLayerRef.current = null;
          }

          // LVTT: create a separate interactive layer for clickable termination counters.
          if (isLVTT) {
            const counterLayer = L.layerGroup();
            lvttTermCounterLayerRef.current = counterLayer;
            counterLayer.addTo(mapRef.current);
            layersRef.current.push(counterLayer);
          } else {
            lvttTermCounterLayerRef.current = null;
          }
          continue;
        }
        
        // Special handling for full.geojson - tables will be selectable (MultiPolygon)
        if (file.name === 'full') {
          // LVTT: tables must NOT be selectable; draw only.
          if (isLVTT) {
            const fullLayer = L.geoJSON(data, {
              renderer: canvasRenderer,
              interactive: false,
              style: () => ({
                color: 'rgba(255,255,255,0.35)',
                weight: 1.05,
                fill: false,
                fillOpacity: 0,
              }),
            });
            fullLayer.addTo(mapRef.current);
            layersRef.current.push(fullLayer);
            if (fullLayer.getBounds().isValid()) {
              allBounds.extend(fullLayer.getBounds());
            }
            continue;
          }

          const fullLayer = L.geoJSON(data, {
            renderer: canvasRenderer,
            interactive: true,
            
            style: () => ({
              color: 'rgba(255,255,255,0.35)',
              weight: 1.05,
              fill: false,
              fillOpacity: 0,
            }),
            
            onEachFeature: (feature, featureLayer) => {
              const gType = feature?.geometry?.type;
              const isPoly = gType === 'Polygon' || gType === 'MultiPolygon';
              const isLine = gType === 'LineString';
              // MC4 panel logic only applies to polygons (panels). DC selection can include other shapes.
              if (!gType || (!isPoly && !(isLine && !isMC4))) return;

              // Assign unique ID to this panel/polygon
              const uniqueId = `polygon_${polygonIdCounter.current++}`;
              featureLayer._uniquePolygonId = uniqueId;

              // Store reference (will be updated with stringId and size later)
              polygonById.current[uniqueId] = {
                layer: featureLayer,
                stringId: null,
                isSmallTable: false,
              };

              // MC4 MODE: click/dblclick change left/right end states
              if (isMC4 && isPoly) {
                const safeStop = (evt) => {
                  try {
                    const oe = evt?.originalEvent || evt;
                    if (oe) {
                      L.DomEvent.stopPropagation(oe);
                      L.DomEvent.preventDefault(oe);
                    }
                  } catch (_e) {
                    void _e;
                  }
                };

                const computeEnds = () => {
                  const map = mapRef.current;
                  if (!map || typeof featureLayer.getLatLngs !== 'function') return null;
                  let ll = featureLayer.getLatLngs();
                  // Drill down until we have an array of LatLngs
                  while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
                  while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
                  const ring = Array.isArray(ll) ? ll : null;
                  if (!ring || ring.length < 4) return null;
                  const pts = ring.map((p) => map.latLngToLayerPoint(p));
                  
                  // Calculate centroid (center of polygon)
                  let cx = 0, cy = 0;
                  pts.forEach((p) => { cx += p.x; cy += p.y; });
                  cx /= pts.length;
                  cy /= pts.length;
                  
                  const edges = [];
                  const n = pts.length;
                  for (let i = 0; i < n; i++) {
                    const p1 = pts[i];
                    const p2 = pts[(i + 1) % n];
                    if (!p1 || !p2) continue;
                    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                    edges.push({ p1, p2, len, center: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } });
                  }
                  if (edges.length < 2) return null;
                  edges.sort((a, b) => a.len - b.len);
                  const shortEdges = edges.slice(0, 2);
                  shortEdges.sort((a, b) => (a.center.x - b.center.x) || (a.center.y - b.center.y));
                  
                  // Pull points inward toward centroid (30% of distance to center)
                  const inwardRatio = 0.3;
                  const pullInward = (edgeCenter) => {
                    const dx = cx - edgeCenter.x;
                    const dy = cy - edgeCenter.y;
                    return {
                      x: edgeCenter.x + dx * inwardRatio,
                      y: edgeCenter.y + dy * inwardRatio
                    };
                  };
                  
                  const leftPt = pullInward(shortEdges[0].center);
                  const rightPt = pullInward(shortEdges[1].center);
                  
                  const leftPos = map.layerPointToLatLng(L.point(leftPt.x, leftPt.y));
                  const rightPos = map.layerPointToLatLng(L.point(rightPt.x, rightPt.y));
                  return { leftPos, rightPos };
                };

                // Store computeEnds function for lazy evaluation (map may not be ready yet)
                polygonById.current[uniqueId].computeEnds = computeEnds;

                const sideFromClick = (evt) => {
                  const map = mapRef.current;
                  const info = polygonById.current?.[uniqueId];
                  // Lazy compute ends if needed
                  if (!info.mc4Ends && typeof info.computeEnds === 'function') {
                    try { info.mc4Ends = info.computeEnds(); } catch (_e) { /* ignore */ }
                  }
                  const ends = info?.mc4Ends;
                  if (!map || !ends?.leftPos || !ends?.rightPos) return 'left';
                  const clickPt = map.latLngToLayerPoint(evt.latlng);
                  const lp = map.latLngToLayerPoint(ends.leftPos);
                  const rp = map.latLngToLayerPoint(ends.rightPos);
                  const dl = Math.hypot(clickPt.x - lp.x, clickPt.y - lp.y);
                  const dr = Math.hypot(clickPt.x - rp.x, clickPt.y - rp.y);
                  return dl <= dr ? 'left' : 'right';
                };

                featureLayer.on('click', (evt) => {
                  safeStop(evt);
                  if (noteMode) return;
                  // Require selection mode to be set
                  const currentMode = mc4SelectionModeRef.current; // null | 'mc4' | 'termination'
                  if (!currentMode) {
                    showMc4Toast('Please select a mode above.');
                    return;
                  }
                  const side = sideFromClick(evt);
                  const prev = mc4GetPanelState(uniqueId);
                  // Calculate next state based on current mode (using ref to get latest value)
                  let nextState = prev[side];
                  if (currentMode === 'mc4') {
                    // MC4 mode: set to MC4 (blue), but never downgrade TERMINATED (green)
                    if (nextState !== 'terminated') nextState = 'mc4';
                  } else if (currentMode === 'termination') {
                    // Termination mode: ONLY MC4 (blue) -> TERMINATED (green)
                    // If not already MC4, do nothing (can't terminate without MC4).
                    if (nextState === 'mc4') nextState = 'terminated';
                    else if (nextState === 'terminated') nextState = 'terminated';
                    else {
                      showMc4Toast('You must complete MC4 installation first.');
                      return;
                    }
                  } else {
                    // No mode: should not happen due to guard above
                    showMc4Toast('Please select a mode above.');
                    return;
                  }
                  const next = { ...prev, [side]: nextState };
                  setMc4PanelStates((s) => ({ ...(s || {}), [uniqueId]: next }));
                  mc4PushHistory([{ id: uniqueId, prev, next }]);
                });

                featureLayer.on('dblclick', (evt) => {
                  safeStop(evt);
                  if (noteMode) return;
                  const side = sideFromClick(evt);
                  const prev = mc4GetPanelState(uniqueId);
                  const next = { ...prev, [side]: MC4_PANEL_STATES.TERMINATED };
                  setMc4PanelStates((s) => ({ ...(s || {}), [uniqueId]: next }));
                  mc4PushHistory([{ id: uniqueId, prev, next }]);
                });

                featureLayer.on('contextmenu', (evt) => {
                  safeStop(evt);
                  if (noteMode) return;
                  const prev = mc4GetPanelState(uniqueId);
                  const next = { left: null, right: null };
                  setMc4PanelStates((s) => {
                    const out = { ...(s || {}) };
                    delete out[uniqueId];
                    return out;
                  });
                  mc4PushHistory([{ id: uniqueId, prev, next }]);
                });

                return;
              }

              // DC/LV DEFAULT: Add click events - left click to select
              if (isDCCT && isPoly) {
                featureLayer.on('click', (e) => {
                  // Stop all propagation to prevent double-firing
                  L.DomEvent.stop(e);
                  try {
                    if (e?.originalEvent) {
                      e.originalEvent.stopPropagation();
                      e.originalEvent.stopImmediatePropagation();
                      e.originalEvent.preventDefault();
                    }
                  } catch (_e) {
                    void _e;
                  }
                  if (noteMode) return;

                  const polygonId = featureLayer._uniquePolygonId;
                  const polygonInfo = polygonId ? polygonById.current?.[polygonId] : null;
                  const sidRaw = polygonInfo?.stringId || '';
                  const sid = normalizeId(sidRaw);
                  if (!sid) return;
                  let center = null;
                  try {
                    if (typeof featureLayer.getBounds === 'function') center = featureLayer.getBounds().getCenter();
                  } catch (_e) {
                    void _e;
                    center = null;
                  }
                  const pos = center || e?.latlng;
                  if (!pos) return;
                  dcctToggleTestOverlay(sid, pos);
                });
                return;
              }

              featureLayer.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (noteMode) return;
                const polygonId = featureLayer._uniquePolygonId;
                if (polygonId) {
                  // For small tables: select all polygons with same string ID
                  const polygonInfo = polygonById.current[polygonId];
                  if (polygonInfo && polygonInfo.stringId && polygonInfo.isSmallTable) {
                    setSelectedPolygons(prev => {
                      const next = new Set(prev);
                      const groupIds = [];
                      // Find all polygons with same string ID
                      Object.keys(polygonById.current).forEach(pid => {
                        const info = polygonById.current[pid];
                        if (info && info.stringId === polygonInfo.stringId && info.isSmallTable) {
                          groupIds.push(pid);
                        }
                      });

                      const allSelected = groupIds.length > 0 && groupIds.every(id => next.has(id));
                      if (allSelected) {
                        groupIds.forEach(id => next.delete(id));
                      } else {
                        groupIds.forEach(id => next.add(id));
                      }
                      return next;
                    });
                  } else {
                    // For large tables: toggle only this polygon
                    setSelectedPolygons(prev => {
                      const next = new Set(prev);
                      if (next.has(polygonId)) next.delete(polygonId);
                      else next.add(polygonId);
                      return next;
                    });
                  }
                }
              });
              
              featureLayer.on('contextmenu', (e) => {
                L.DomEvent.stopPropagation(e);
                if (noteMode) return;
                const polygonId = featureLayer._uniquePolygonId;
                if (polygonId) {
                  // For small tables: unselect all polygons with same string ID
                  const polygonInfo = polygonById.current[polygonId];
                  if (polygonInfo && polygonInfo.stringId && polygonInfo.isSmallTable) {
                    setSelectedPolygons(prev => {
                      const next = new Set(prev);
                      // Find all polygons with same string ID
                      Object.keys(polygonById.current).forEach(pid => {
                        const info = polygonById.current[pid];
                        if (info && info.stringId === polygonInfo.stringId && info.isSmallTable) {
                          next.delete(pid);
                        }
                      });
                      return next;
                    });
                  } else {
                    // For large tables: unselect only this polygon
                    setSelectedPolygons(prev => {
                      const next = new Set(prev);
                      next.delete(polygonId);
                      return next;
                    });
                  }
                }
              });
            }
          });
          
          fullLayer.addTo(mapRef.current);
          layersRef.current.push(fullLayer);
          
          if (fullLayer.getBounds().isValid()) {
            allBounds.extend(fullLayer.getBounds());
          }
          continue;
        }

        // Standard processing for other GeoJSON files
        // LV: inv_id labels are clickable (daily completion). Other modules can opt into LV-style label appearance.
        const invLabelMode = file.name === 'inv_id' && (isLV || isLVTT || activeMode?.invIdLabelMode);
        const invInteractive = (isLV || isLVTT) && file.name === 'inv_id';
        const mvfTrenchInteractive = isMVF && file.name === 'mv_trench';
        // MVT: we don't want table selection interactions in this mode.
        const disableInteractions = (isMVT || isLVTT) && (file.name === 'full' || file.name === 'subs');
        const layer = L.geoJSON(data, {
          renderer: canvasRenderer,
          interactive: !disableInteractions && (invInteractive || mvfTrenchInteractive),
          
          style: () => {
            // Restore the "dim white" look for all layers, with a stronger LV box outline.
            if (file.name === 'lv_box') {
              return {
                color: 'rgba(255,255,255,0.95)',
                weight: 3.2,
                fill: false,
                fillOpacity: 0
              };
            }
            // MVF: default mv_trench should be WHITE (uncompleted)
            if (mvfTrenchInteractive) {
              return {
                color: 'rgba(255,255,255,0.85)',
                weight: 1.25,
                fill: false,
                fillOpacity: 0,
              };
            }
            // MV+FIBER: make subs more prominent (pink + thicker + dashed)
            if (isMVF && file.name === 'subs') {
              return {
                color: 'rgba(236,72,153,0.95)', // pink
                weight: 2.0,
                dashArray: '8 8',
                fill: false,
                fillOpacity: 0
              };
            }
            if (invLabelMode) {
              // inv_id: make more prominent than general drawings
              return {
                color: 'rgba(255,255,255,0.85)',
                weight: 1.6,
                fill: false,
                fillOpacity: 0
              };
            }
            return {
              color: 'rgba(255,255,255,0.26)',
              weight: 0.78,
              fill: false,
              fillOpacity: 0
            };
          },
          
          pointToLayer: (feature, latlng) => {
            if (invLabelMode && feature.properties?.text) {
              const raw = feature.properties.text;
              const invIdNorm = normalizeId(raw);
              const isDone = isLV && lvCompletedInvIdsRef.current?.has(invIdNorm);
              const displayId = String(raw).replace(/\s+/g, ''); // keep consistent with CSV style
              
              const invScale = typeof activeMode?.invIdTextScale === 'number' ? activeMode.invIdTextScale : 1;
              const invBase = typeof activeMode?.invIdTextBaseSize === 'number' ? activeMode.invIdTextBaseSize : 19;
              const invRefZoom = typeof activeMode?.invIdTextRefZoom === 'number' ? activeMode.invIdTextRefZoom : 20;
              const invTextStyle = activeMode?.invIdTextStyle || '600';
              const invMinFs = typeof activeMode?.invIdTextMinFontSize === 'number' ? activeMode.invIdTextMinFontSize : null;
              const invMaxFs = typeof activeMode?.invIdTextMaxFontSize === 'number' ? activeMode.invIdTextMaxFontSize : null;
              const invStrokeColor = activeMode?.invIdTextStrokeColor || 'rgba(0,0,0,0.88)';
              const invStrokeWidthFactor =
                typeof activeMode?.invIdTextStrokeWidthFactor === 'number' ? activeMode.invIdTextStrokeWidthFactor : 1.45;
              const invBgColor = activeMode?.invIdTextBgColor || null;
              const invBgPaddingX = typeof activeMode?.invIdTextBgPaddingX === 'number' ? activeMode.invIdTextBgPaddingX : 0;
              const invBgPaddingY = typeof activeMode?.invIdTextBgPaddingY === 'number' ? activeMode.invIdTextBgPaddingY : 0;
              const invBgStrokeColor = activeMode?.invIdTextBgStrokeColor || null;
              const invBgStrokeWidth = typeof activeMode?.invIdTextBgStrokeWidth === 'number' ? activeMode.invIdTextBgStrokeWidth : 0;
              const invBgCornerRadius =
                typeof activeMode?.invIdTextBgCornerRadius === 'number' ? activeMode.invIdTextBgCornerRadius : 0;
              const invMinTextZoom =
                typeof activeMode?.invIdTextMinTextZoom === 'number' ? activeMode.invIdTextMinTextZoom : null;
              const invMinBgZoom =
                typeof activeMode?.invIdTextMinBgZoom === 'number' ? activeMode.invIdTextMinBgZoom : null;
              const invDoneTextColor = activeMode?.invIdDoneTextColor || 'rgba(11,18,32,0.98)'; // when badge is visible
              const invDoneTextColorNoBg = activeMode?.invIdDoneTextColorNoBg || 'rgba(34,197,94,0.98)'; // when badge hidden
              const invDoneBgColor = activeMode?.invIdDoneBgColor || 'rgba(34,197,94,0.92)';
              const invDoneBgStrokeColor = activeMode?.invIdDoneBgStrokeColor || 'rgba(255,255,255,0.70)';
              const invDoneBgStrokeWidth =
                typeof activeMode?.invIdDoneBgStrokeWidth === 'number' ? activeMode.invIdDoneBgStrokeWidth : 2;
              
              // LVTT colors based on test status
              let textColor = 'rgba(255,255,255,0.98)'; // default white (not tested)
              let bgColor = invBgColor;
              let bgStrokeColor = invBgStrokeColor;
              let bgStrokeWidth = invBgStrokeWidth;
              
              if (isLVTT) {
                const mode = String(lvttSubModeRef.current || 'termination');
                if (mode === 'termination') {
                  const terminated = Math.max(0, Math.min(3, Number(lvttTerminationByInvRef.current?.[invIdNorm] ?? 0)));
                  textColor = terminated === 3 ? 'rgba(34,197,94,0.98)' : 'rgba(239,68,68,0.98)';
                } else {
                  const testData = lvttTestCsvByInvRef.current?.[invIdNorm];
                  if (testData) {
                    const l1 = testData.L1?.status || 'N/A';
                    const l2 = testData.L2?.status || 'N/A';
                    const l3 = testData.L3?.status || 'N/A';
                    const anyFail = l1 === 'FAILED' || l2 === 'FAILED' || l3 === 'FAILED';
                    const allPass = l1 === 'PASS' && l2 === 'PASS' && l3 === 'PASS';
                    if (anyFail) textColor = 'rgba(239,68,68,0.98)';
                    else if (allPass) textColor = 'rgba(34,197,94,0.98)';
                  }
                }
              } else if (isDone) {
                textColor = invDoneTextColor;
                bgColor = invDoneBgColor;
                bgStrokeColor = invDoneBgStrokeColor;
                bgStrokeWidth = invDoneBgStrokeWidth;
              }
              
              const baseSize = invBase * invScale;
              const radius = 22 * invScale;
              const lvttModeNow = String(lvttSubModeRef.current || 'termination');
              const lvttTerminatedNow = isLVTT
                ? Math.max(0, Math.min(3, Number(lvttTerminationByInvRef.current?.[invIdNorm] ?? 0)))
                : 0;

              // LVTT: use a dedicated renderer so toggling modes doesn't leave stale text/colors behind.
              let invRenderer = canvasRenderer;
              if (isLVTT) {
                if (!lvttInvIdRendererRef.current) lvttInvIdRendererRef.current = L.canvas({ padding: 0.1 });
                invRenderer = lvttInvIdRendererRef.current;
              }
              const label = L.textLabel(latlng, {
                text: displayId,
                renderer: invRenderer,
                textBaseSize: baseSize,
                refZoom: invRefZoom,
                textStyle: invTextStyle,
                textColor: textColor,
                textColorNoBg: isDone ? invDoneTextColorNoBg : null,
                textStrokeColor: invStrokeColor,
                textStrokeWidthFactor: invStrokeWidthFactor,
                minFontSize: invMinFs,
                maxFontSize: invMaxFs,
                bgColor: bgColor,
                bgPaddingX: invBgPaddingX,
                bgPaddingY: invBgPaddingY,
                bgStrokeColor: bgStrokeColor,
                bgStrokeWidth: bgStrokeWidth,
                bgCornerRadius: invBgCornerRadius,
                minTextZoom: invMinTextZoom,
                minBgZoom: invMinBgZoom,
                rotation: feature.properties.angle || 0,
                interactive: isLV || isLVTT,
                radius
              });

              // Toggle completed on click (LV only)
              if (isLV) {
                label.on('click', (e) => {
                  try {
                    if (e?.originalEvent) {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      L.DomEvent.preventDefault(e.originalEvent);
                    }
                  } catch (_e) {
                    void _e;
                  }
                  setLvCompletedInvIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(invIdNorm)) next.delete(invIdNorm);
                    else next.add(invIdNorm);
                    return next;
                  });
                });
              }

              // LVTT: show popup with test details on click
              if (isLVTT) {
                label.on('click', (e) => {
                  try {
                    if (e?.originalEvent) {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      L.DomEvent.preventDefault(e.originalEvent);
                    }
                  } catch (_e) {
                    void _e;
                  }
                  const mode = String(lvttSubModeRef.current || 'termination');
                  if (mode === 'termination') {
                    const cur = Math.max(0, Math.min(3, Number(lvttTerminationByInvRef.current?.[invIdNorm] ?? 0)));
                    if (cur === 3) return;
                    const oe = e?.originalEvent;
                    const x = oe?.clientX ?? 0;
                    const y = oe?.clientY ?? 0;
                    setLvttPopup({
                      mode: 'termination',
                      invId: displayId,
                      invIdNorm,
                      draft: cur,
                      x,
                      y,
                    });
                  } else {
                    const oe = e?.originalEvent;
                    const x = oe?.clientX ?? 0;
                    const y = oe?.clientY ?? 0;
                    const testData = lvttTestCsvByInvRef.current?.[invIdNorm] || null;
                    setLvttPopup({
                      mode: 'testing',
                      invId: displayId,
                      invIdNorm,
                      testData,
                      x,
                      y,
                    });
                  }
                });
              }

              // LVTT metadata for refresh + lock behavior
              if (isLVTT) {
                label._lvttInvNorm = invIdNorm;
                label._lvttDisplayId = displayId;
                label._lvttRaw = raw;
                label._lvttLocked = lvttModeNow === 'termination' && lvttTerminatedNow === 3;
                // store meta so we can draw a separate clickable 0/3 counter under the inv_id
                lvttInvMetaByNormRef.current[invIdNorm] = {
                  lat: latlng.lat,
                  lng: latlng.lng,
                  angle: feature.properties.angle || 0,
                  raw,
                  displayId,
                };
              }

              lvInvLabelByIdRef.current[invIdNorm] = label;
              return label;
            }

            if (feature.properties?.text) {
              textCount++;
              return L.textLabel(latlng, {
                text: feature.properties.text,
                renderer: canvasRenderer,
                textBaseSize: 12,
                refZoom: 20,
                textStyle: '400',
                textColor: 'rgba(255,255,255,0.85)',
                rotation: feature.properties.angle || 0
              });
            }
            return L.circleMarker(latlng, {
              renderer: canvasRenderer,
              radius: 2,
              color: 'rgba(255,255,255,0.26)',
              weight: 1,
              fillColor: 'rgba(255,255,255,0.26)',
              fillOpacity: 0.65
            });
          },
          
          onEachFeature: (feature, featureLayer) => {
            // MVF: allow selecting mv_trench segments (click toggles green)
            if (mvfTrenchInteractive && featureLayer && typeof featureLayer.on === 'function') {
              const fidRaw = feature?.properties?.fid;
              const fid = fidRaw != null ? String(fidRaw) : `t_${mvfTrenchIdCounterRef.current++}`;
              featureLayer._mvfTrenchId = fid;
              mvfTrenchByIdRef.current[fid] = featureLayer;

              // Compute per-feature length (meters) from geometry and accumulate total.
              try {
                const geom = feature?.geometry;
                let meters = 0;
                const round = (v) => Number(v).toFixed(6);
                const addLineMeters = (coords, lineIndex) => {
                  if (!Array.isArray(coords) || coords.length < 2) return;
                  let prev = null;
                  let cum = 0;
                  for (const c of coords) {
                    const lng = c?.[0];
                    const lat = c?.[1];
                    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
                    const ll = L.latLng(lat, lng);
                    if (prev) {
                      const segM = prev.distanceTo(ll);
                      meters += segM;
                      // Build edge index for mapping segment-route highlights onto trench intervals.
                      // Key by rounded coordinates (6dp) to match mvf graph nodes.
                      try {
                        const aK = `${round(prev.lat)},${round(prev.lng)}`;
                        const bK = `${round(ll.lat)},${round(ll.lng)}`;
                        const keyAB = `${aK}|${bK}`;
                        const keyBA = `${bK}|${aK}`;
                        const startM = cum;
                        const endM = cum + segM;
                        cum = endM;
                        const rec = { fid: String(fid), lineIndex: Number(lineIndex) || 0, startM, endM };
                        mvfTrenchEdgeIndexRef.current.set(keyAB, rec);
                        mvfTrenchEdgeIndexRef.current.set(keyBA, rec);
                      } catch (_e) {
                        void _e;
                      }
                    }
                    prev = ll;
                  }
                };
                if (geom?.type === 'LineString') addLineMeters(geom.coordinates, 0);
                else if (geom?.type === 'MultiLineString') (geom.coordinates || []).forEach((c, idx) => addLineMeters(c, idx));
                mvfTrenchLenByIdRef.current[fid] = meters;
                setMvfTrenchTotalMeters((prev) => prev + meters);
              } catch (_e) {
                void _e;
              }

              featureLayer.on('click', (e) => {
                try {
                  if (e?.originalEvent) {
                    L.DomEvent.stopPropagation(e.originalEvent);
                    L.DomEvent.preventDefault(e.originalEvent);
                  }
                } catch (_e) {
                  void _e;
                }
                if (noteMode) return;
                // MVF trench selection is handled via selection box -> clipped PARTs
                // (clicking the base trench line does nothing to avoid "whole feature turns green")
              });
            }

            if (feature.properties?.text && feature.geometry.type !== 'Point') {
              
              let center;
              if (typeof featureLayer.getBounds === 'function') {
                center = featureLayer.getBounds().getCenter();
              } else if (typeof featureLayer.getLatLng === 'function') {
                center = featureLayer.getLatLng();
              }
              
              let rotation = 0;
              if (feature.geometry.type === 'LineString') {
                rotation = calculateLineAngle(feature.geometry.coordinates);
              }

              if (center) {
                textCount++;
                const textMarker = L.textLabel(center, {
                  text: feature.properties.text,
                  renderer: canvasRenderer,
                  textBaseSize: 20,
                  refZoom: 22,
                  textStyle: '300',
                  textColor: 'rgba(255,255,255,0.9)',
                  rotation: rotation
                });
                textMarker.addTo(mapRef.current);
                layersRef.current.push(textMarker);
              }
            }
          }
        }).addTo(mapRef.current);
        
        layersRef.current.push(layer);
        if (layer.getBounds().isValid()) {
          allBounds.extend(layer.getBounds());
        }

      } catch (err) { 
        console.error('Error loading GeoJSON:', err); 
      }
    }

    // Set bounds first
    if (allBounds.isValid()) {
      mapRef.current.fitBounds(allBounds, { padding: [20, 20] });
    }

    // MC4: Now that map has bounds, compute mc4Ends for all panels
    if (isMC4) {
      const panels = polygonById.current || {};
      let computed = 0;
      Object.keys(panels).forEach((id) => {
        const panel = panels[id];
        if (!panel.mc4Ends && typeof panel.computeEnds === 'function') {
          try {
            const ends = panel.computeEnds();
            if (ends) {
              panel.mc4Ends = ends;
              computed++;
            }
          } catch (_e) {
            // Still not ready, will be computed lazily
          }
        }
      });
    }

    // Initial label draw + update on view changes (lazy string_text rendering)
    scheduleStringTextLabelUpdate();
    mapRef.current.off('zoomend moveend', scheduleStringTextLabelUpdate);
    mapRef.current.on('zoomend moveend', scheduleStringTextLabelUpdate);

    // Build a tiny spatial grid for string_text points to speed up polygon matching
    // and label rendering (avoid scanning all points on every pan/zoom).
    // This avoids O(polygons * allStringPoints) scans.
    const GRID_CELL_DEG = 0.001; // keep consistent with STRING_LABEL_GRID_CELL_DEG
    const stringGrid = (() => {
      const grid = new Map(); // key -> [{stringId, latLng}]
      const seen = new Set();
      for (const p of stringTextPointsRef.current) {
        if (!p?.stringId) continue;
        // In DCCT, keep duplicate points (same stringId can appear twice in source)
        // so each overlapping/compound table polygon can still find a good candidate.
        if (!isDCCT && seen.has(p.stringId)) continue;
        seen.add(p.stringId);
        const iLat = Math.floor(p.lat / GRID_CELL_DEG);
        const iLng = Math.floor(p.lng / GRID_CELL_DEG);
        const key = `${iLat}:${iLng}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push({ stringId: p.stringId, latLng: L.latLng(p.lat, p.lng) });
      }
      return grid;
    })();

    // Label grid: key -> [pointIndex] (preserves stable ordering via index sort)
    stringTextGridRef.current = (() => {
      const grid = new Map();
      for (let idx = 0; idx < stringTextPointsRef.current.length; idx++) {
        const p = stringTextPointsRef.current[idx];
        if (!p) continue;
        const iLat = Math.floor(p.lat / GRID_CELL_DEG);
        const iLng = Math.floor(p.lng / GRID_CELL_DEG);
        const key = `${iLat}:${iLng}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(idx);
      }
      return grid;
    })();

    const queryStringCandidates = (bounds, center, includeLooseMargin) => {
      let queryBounds = bounds;
      if (includeLooseMargin) {
        const latRad = (center.lat * Math.PI) / 180;
        const cos = Math.max(0.2, Math.cos(latRad));
        const latDeg = LOOSE_DISTANCE_METERS / 111320;
        const lngDeg = latDeg / cos;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        queryBounds = L.latLngBounds(
          [sw.lat - latDeg, sw.lng - lngDeg],
          [ne.lat + latDeg, ne.lng + lngDeg]
        );
      }

      const sw = queryBounds.getSouthWest();
      const ne = queryBounds.getNorthEast();
      const minLat = Math.floor(sw.lat / GRID_CELL_DEG);
      const maxLat = Math.floor(ne.lat / GRID_CELL_DEG);
      const minLng = Math.floor(sw.lng / GRID_CELL_DEG);
      const maxLng = Math.floor(ne.lng / GRID_CELL_DEG);

      const out = [];
      for (let a = minLat; a <= maxLat; a++) {
        for (let b = minLng; b <= maxLng; b++) {
          const key = `${a}:${b}`;
          const arr = stringGrid.get(key);
          if (arr && arr.length) out.push(...arr);
        }
      }
      return out;
    };

    // Match string text locations with full.geojson polygons (chunked to avoid long blocking)
    setTimeout(() => {
      const assignedToLargeTable = new Set();
      const polygonInfos = [];
      layersRef.current.forEach(layer => {
        if (layer.eachLayer) {
          layer.eachLayer(featureLayer => {
            if (featureLayer.feature && featureLayer.getBounds) {
              try {
                // IMPORTANT: only match string IDs to selectable table polygons from full.geojson.
                // Other layers (lv_box, subs, etc.) can be huge and would steal assignments,
                // leaving tables unmatched (and thus different stroke tones in DCCT).
                const uid = featureLayer._uniquePolygonId;
                if (!uid || !polygonById.current?.[uid]) return;

                const bounds = featureLayer.getBounds();
                const center = bounds.getCenter();
                const geometry = featureLayer.feature?.geometry;
                const boundsWidth = bounds.getNorthWest().distanceTo(bounds.getNorthEast());
                const boundsHeight = bounds.getNorthWest().distanceTo(bounds.getSouthWest());
                const diag = Math.sqrt(boundsWidth * boundsWidth + boundsHeight * boundsHeight);
                const isSmallTable = diag < 25;
                
                polygonInfos.push({
                  featureLayer,
                  bounds,
                  center,
                  geometry,
                  diag,
                  isSmallTable
                });
              } catch (_e) { void _e; }
            }
          });
        }
      });
      
      polygonInfos.sort((a, b) => b.diag - a.diag);

      const total = polygonInfos.length;
      const chunkSize = 80; // smaller chunks to keep first render responsive
      let index = 0;

      const processBatch = () => {
        const end = Math.min(index + chunkSize, total);

        for (let i = index; i < end; i++) {
          const { featureLayer, bounds, center, isSmallTable } = polygonInfos[i];
          const matchesInside = [];
          const matchesNearby = [];

          const candidates = queryStringCandidates(bounds, center, isSmallTable);
          for (const c of candidates) {
            // Only enforce unique assignment in non-DCCT modes.
            // In DCCT we want all overlapping table outlines to share the same status color
            // (otherwise you see a lighter mixed tone from green+default overlays).
            if (!isDCCT && !isSmallTable && assignedToLargeTable.has(c.stringId)) continue;
            const distToCenter = center.distanceTo(c.latLng);
            const insideBounds = bounds.contains(c.latLng);
            if (insideBounds) {
              matchesInside.push({ stringId: c.stringId, dist: distToCenter });
            } else if (isSmallTable && distToCenter < NEAR_DISTANCE_METERS) {
              matchesNearby.push({ stringId: c.stringId, dist: distToCenter });
            }
          }
          
          let finalId = null;
          if (matchesInside.length === 1) {
            finalId = matchesInside[0].stringId;
          } else if (matchesInside.length > 1) {
            matchesInside.sort((a, b) => a.dist - b.dist);
            finalId = matchesInside[0].stringId;
          } else if (isSmallTable && matchesNearby.length > 0) {
            matchesNearby.sort((a, b) => a.dist - b.dist);
            finalId = matchesNearby[0].stringId;
          } else if (isSmallTable) {
            let bestLoose = null;
            for (const c of candidates) {
              const distToCenter = center.distanceTo(c.latLng);
              if (distToCenter < LOOSE_DISTANCE_METERS) {
                if (!bestLoose || distToCenter < bestLoose.dist) {
                  bestLoose = { stringId: c.stringId, dist: distToCenter };
                }
              }
            }
            if (bestLoose) {
              finalId = bestLoose.stringId;
            }
          }
          
          if (finalId) {
            const uniqueId = featureLayer._uniquePolygonId;
            if (uniqueId && polygonById.current[uniqueId]) {
              polygonById.current[uniqueId].stringId = finalId;
              polygonById.current[uniqueId].isSmallTable = isSmallTable;
            }
            if (!isDCCT && !isSmallTable) {
              assignedToLargeTable.add(finalId);
            }
          }
        }

        index = end;
        if (index < total) {
          setStatus(`Matching strings... ${Math.round((index / total) * 100)}%`);
          requestAnimationFrame(processBatch);
        } else {
          const totalPolygons = Object.keys(polygonById.current).length;
          const uniqueStringIds = new Set(Object.values(polygonById.current).map(p => p.stringId).filter(Boolean)).size;
          console.log('Matched:', totalPolygons, 'polygons to', uniqueStringIds, 'unique string IDs');
          setStringPoints(collectedPoints);
          // Force immediate counter recompute for already-selected polygons (removes "wait then click again" feeling)
          setStringMatchVersion((v) => v + 1);
          setStatus(`Ready: ${totalFeatures} objects, ${textCount} labels, ${collectedPoints.length} selectable strings`);
        }
      };

      processBatch();
    }, 50);
  };

  // MVF: render segment ROUTES on the map:
  // - each segment has its own (non-green) color
  // - if Done, render in green
  // Also compute per-segment scale (CSV meters per trench meter) for selection box meters.
  useEffect(() => {
    if (!isMVF) return;
    const map = mapRef.current;
    const hl = mvfHighlightLayerRef.current;
    if (!map || !hl) return;

    const graph = mvfTrenchGraphRef.current;
    if (!graph?.adj) return;

    const clear = () => {
      try { hl.clearLayers(); } catch (_e) { void _e; }
    };
    clear();

    const pts = stringTextPointsRef.current || [];
    const findPoint = (id) => pts.find((p) => p?.stringId === id) || null;

    const nearestNodeKey = (ll) => {
      if (!graph?.nodes?.size) return null;
      const { nodes, grid, gridSize } = graph;
      const a = Math.floor(ll.lat / gridSize);
      const b = Math.floor(ll.lng / gridSize);
      let best = null;
      let bestD = Infinity;
      const scanCells = (r) => {
        for (let da = -r; da <= r; da++) {
          for (let db = -r; db <= r; db++) {
            const cell = `${a + da}:${b + db}`;
            const arr = grid.get(cell);
            if (!arr) continue;
            for (const k of arr) {
              const n = nodes.get(k);
              if (!n) continue;
              const d = ll.distanceTo(L.latLng(n.lat, n.lng));
              if (d < bestD) {
                bestD = d;
                best = k;
              }
            }
          }
        }
      };
      for (let r = 0; r <= 6; r++) {
        scanCells(r);
        if (best && bestD < 250) break;
      }
      return best;
    };

    const buildPathCoords = (segKey) => {
      const seg = mvfSegments.find((s) => s.key === segKey);
      if (!seg?.label) return null;
      const [aLabelRaw, bLabelRaw] = seg.label.split('-');
      const aId = normalizeId(aLabelRaw);
      const bId = normalizeId(bLabelRaw);
      const aPt = findPoint(aId);
      const bPt = findPoint(bId);
      if (!aPt || !bPt) return null;

      const aLL = L.latLng(aPt.lat, aPt.lng);
      const bLL = L.latLng(bPt.lat, bPt.lng);
      const startK = nearestNodeKey(aLL);
      const endK = nearestNodeKey(bLL);
      if (!startK || !endK) return null;

      const dist = new Map([[startK, 0]]);
      const prev = new Map();
      const visited = new Set();
      const pickMin = () => {
        let bestK = null;
        let bestV = Infinity;
        for (const [k, v] of dist.entries()) {
          if (visited.has(k)) continue;
          if (v < bestV) { bestV = v; bestK = k; }
        }
        return bestK;
      };
      for (let iter = 0; iter < 20000; iter++) {
        const u = pickMin();
        if (!u) break;
        if (u === endK) break;
        visited.add(u);
        const edges = graph.adj.get(u) || [];
        const du = dist.get(u) || 0;
        for (const e of edges) {
          const alt = du + (e.w || 0);
          const dv = dist.get(e.to);
          if (dv == null || alt < dv) {
            dist.set(e.to, alt);
            prev.set(e.to, u);
          }
        }
      }

      const path = [];
      let cur = endK;
      if (!prev.has(cur) && cur !== startK) return null;
      while (cur) {
        const n = graph.nodes.get(cur);
        if (n) path.push([n.lat, n.lng]);
        if (cur === startK) break;
        cur = prev.get(cur);
      }
      path.reverse();
      return path.length >= 2 ? path : null;
    };

    const keysToRender = Array.from(
      new Set([
        ...Array.from(mvfActiveSegmentKeys || []).map(String),
        ...Array.from(mvfDoneSegmentKeysRef.current || []).map(String),
      ])
    );
    keysToRender.forEach((k) => {
      const coords = buildPathCoords(k);
      if (!coords || coords.length < 2) return;

      // Save route intervals (for "select only on this route" behavior)
      try {
        const edgeIndex = mvfTrenchEdgeIndexRef.current;
        const round = (v) => Number(v).toFixed(6);
        const mapByKey = new Map();
        for (let i = 0; i < coords.length - 1; i++) {
          const a = coords[i];
          const b = coords[i + 1];
          if (!a || !b) continue;
          const aK = `${round(a[0])},${round(a[1])}`;
          const bK = `${round(b[0])},${round(b[1])}`;
          const rec = edgeIndex.get(`${aK}|${bK}`);
          if (!rec) continue;
          const fid = String(rec.fid || '');
          const lineIndex = Number(rec.lineIndex) || 0;
          const lo = Math.min(Number(rec.startM) || 0, Number(rec.endM) || 0);
          const hi = Math.max(Number(rec.startM) || 0, Number(rec.endM) || 0);
          if (!(hi > lo)) continue;
          const kk = `${fid}:${lineIndex}`;
          if (!mapByKey.has(kk)) mapByKey.set(kk, []);
          mapByKey.get(kk).push([lo, hi]);
        }
        // merge per line
        for (const [kk, arr] of mapByKey.entries()) mapByKey.set(kk, mergeIntervals(arr));
        mvfRouteIntervalsBySegmentKeyRef.current[k] = mapByKey;
      } catch (_e) {
        void _e;
      }

      // trench meters along the displayed route
      let trenchM = 0;
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i];
        const b = coords[i + 1];
        if (!a || !b) continue;
        trenchM += L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
      }
      const csvLen = Number(mvfSegmentLenByKeyRef.current?.[k]) || 0;
      const segScale = trenchM > 0 ? (csvLen / trenchM) : 1;
      mvfSegmentScaleByKeyRef.current[k] = segScale;
      try { mvfColorOfSegment(k); } catch (_e) { void _e; }

      const done = mvfDoneSegmentKeysRef.current?.has?.(k);
      const color = done ? '#16a34a' : mvfColorOfSegment(k);
      const line = L.polyline(coords, { color, weight: 4.6, opacity: 0.98, interactive: true });
      line._mvfSegmentKey = k;
      // Right-click on route removes segment highlight (does not erase completed parts).
      line.on('contextmenu', (evt) => {
        try {
          if (evt?.originalEvent) {
            L.DomEvent.stopPropagation(evt.originalEvent);
            L.DomEvent.preventDefault(evt.originalEvent);
          }
        } catch (_e) {
          void _e;
        }
        setMvfActiveSegmentKeys((prev) => {
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
      });
      hl.addLayer(line);
    });
  }, [isMVF, mvfActiveSegmentKeys, mvfSegments, mvfColorOfSegment, mvfDoneSegmentKeys]);

  // Box Selection event handlers - left click to select, right click to unselect
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    // MVT: no table work in this mode; disable box selection / global mouse capture so labels are clickable.
    if (isMVT || isLVTT) return;
    
    const map = mapRef.current;
    const container = map.getContainer();

    const isNoteMarkerDomTarget = (evt) => {
      const t = evt?.target;
      if (!t) return false;
      return Boolean(
        t.closest?.('.custom-note-pin') ||
          t.closest?.('.note-dot-hit') ||
          t.closest?.('.note-dot-core')
      );
    };
    
    // Prevent default context menu only on map container
    const preventContextMenu = (e) => {
      e.preventDefault();
    };
    container.addEventListener('contextmenu', preventContextMenu);
    
    const onMouseDown = (e) => {
      if (e.button !== 0 && e.button !== 2) return; // Left or right click

      // Prevent "clicking a note marker creates a new note" bug
      if (noteMode && isNoteMarkerDomTarget(e)) {
        return;
      }
      
      // Reset marker click flag at start of new interaction
      markerClickedRef.current = false;

      // Leaflet can throw here if the map pane isn't fully initialized (or was just torn down during a mode switch).
      let startLatLng = null;
      try {
        if (!map || !map._loaded || !map._mapPane) return;
        startLatLng = map.mouseEventToLatLng(e);
      } catch (_e) {
        void _e;
        return;
      }
      
      draggingRef.current = {
        start: startLatLng,
        startPoint: { x: e.clientX, y: e.clientY },
        isRightClick: e.button === 2,
        isDrag: false
      };
      try { map.dragging?.disable?.(); } catch (_e) { void _e; }
    };
    
    const onMouseMove = (e) => {
      if (!draggingRef.current) return;
      
      // Check if moved enough to be a drag
      const dx = e.clientX - draggingRef.current.startPoint.x;
      const dy = e.clientY - draggingRef.current.startPoint.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        draggingRef.current.isDrag = true;
      }
      
      let current = null;
      try {
        if (!map || !map._loaded || !map._mapPane) return;
        current = map.mouseEventToLatLng(e);
      } catch (_e) {
        void _e;
        return;
      }
      const bounds = L.latLngBounds(draggingRef.current.start, current);
      
      if (boxRectRef.current) {
        boxRectRef.current.setBounds(bounds);
      } else if (draggingRef.current.isDrag) {
        const isRightClick = draggingRef.current.isRightClick;
        // Note mode uses orange selection box
        const boxColor = noteMode ? '#f97316' : (isRightClick ? '#ef4444' : '#3b82f6');
        boxRectRef.current = L.rectangle(bounds, {
          color: boxColor,
          weight: 2,
          fillColor: boxColor,
          fillOpacity: 0.2,
          dashArray: '5, 5'
        }).addTo(map);
      }
    };
    
    const onMouseUp = () => {
      if (!draggingRef.current) return;
      
      map.dragging.enable();
      
      const wasDrag = draggingRef.current.isDrag;
      const isRightClick = draggingRef.current.isRightClick;
      const clickLatLng = draggingRef.current.start;
      
      // Handle box selection (drag)
      if (boxRectRef.current && wasDrag) {
        const bounds = boxRectRef.current.getBounds();
        
        if (noteMode) {
          // NOTE MODE: Select only notes within bounds
          const notesInBounds = notes.filter(note => 
            bounds.contains(L.latLng(note.lat, note.lng))
          );
          
          if (notesInBounds.length > 0) {
            setSelectedNotes(prev => {
              const next = new Set(prev);
              if (isRightClick) {
                notesInBounds.forEach(n => next.delete(n.id));
              } else {
                notesInBounds.forEach(n => next.add(n.id));
              }
              return next;
            });
          }
        } else {
          // MVF MODE: Box select ONLY mv_trench (avoid selecting tables/other layers)
          if (isMVF) {
            const byId = mvfTrenchByIdRef.current || {};
            const isFibreMode = String(activeMode?.key || '').toUpperCase() === 'FIB';

            if (isRightClick) {
              // Unselect PARTS within the box (do not touch committed).
              // This is partial erase: only the portion inside the box is removed; outside stays selected.
              setMvfSelectedTrenchParts((prev) => {
                const parts = prev || [];
                if (parts.length === 0) return parts;

                // Group by fid/lineIndex (only parts created from mv_trench box selection have these fields)
                const groups = new Map(); // key -> parts[]
                parts.forEach((p) => {
                  const fid = String(p?.fid || '');
                  const lineIndex = Number(p?.lineIndex);
                  if (!fid || !Number.isFinite(lineIndex) || !Number.isFinite(Number(p?.startM)) || !Number.isFinite(Number(p?.endM))) {
                    // unknown shape; keep as-is (should be rare)
                    const k = `__raw__:${Math.random()}`;
                    groups.set(k, [p]);
                    return;
                  }
                  const k = `${fid}:${lineIndex}`;
                  if (!groups.has(k)) groups.set(k, []);
                  groups.get(k).push(p);
                });

                const out = [];
                for (const [k, arr] of groups.entries()) {
                  if (k.startsWith('__raw__')) {
                    out.push(...arr);
                    continue;
                  }
                  const [fid, lineIndexStr] = k.split(':');
                  const lineIndex = Number(lineIndexStr);
                  const layer = byId[fid];
                  if (!layer || typeof layer.getLatLngs !== 'function') {
                    out.push(...arr);
                    continue;
                  }
                  const lines = asLineStrings(layer.getLatLngs());
                  const lineLL = lines[lineIndex];
                  if (!lineLL || lineLL.length < 2) {
                    out.push(...arr);
                    continue;
                  }

                  const eraseIntervals = computeIntervalsInBox({ L, map, bounds, lineLatLngs: lineLL, minMeters: 0.5 });
                  if (!eraseIntervals.length) {
                    out.push(...arr);
                    continue;
                  }
                  const eraseMerged = mergeIntervals(eraseIntervals);
                  const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });

                  arr.forEach((p) => {
                    const startM = Number(p.startM);
                    const endM = Number(p.endM);
                    const lo = Math.min(startM, endM);
                    const hi = Math.max(startM, endM);
                    const remainIntervals = subtractInterval([lo, hi], eraseMerged, 0.2);
                    remainIntervals.forEach(([a, b]) => {
                      const coords = sliceLineByMeters({ lineLatLngs: lineLL, cumData, startM: a, endM: b });
                      if (!coords || coords.length < 2) return;
                      const suffix = p?.segmentKey ? `:seg:${String(p.segmentKey)}` : '';
                      out.push({
                        ...p,
                        id: `${fid}:${lineIndex}:${a.toFixed(2)}-${b.toFixed(2)}${suffix}`,
                        lineIndex,
                        startM: a,
                        endM: b,
                        coords,
                        meters: Math.max(0, b - a),
                        metersMultiplier: typeof p?.metersMultiplier === 'number' ? p.metersMultiplier : (p?.source === 'segment' ? 1 : mvfCircuitsMultiplier),
                      });
                    });
                  });
                }
                return out;
              });
            } else {
              // Require an active "current segment" to be chosen before selecting trench parts.
              // IMPORTANT: never return early (we must still clean up the selection rectangle + drag state).
              const rawSegKey = String(mvfCurrentSegmentKeyRef.current || '');
              const segKey = isFibreMode ? rawSegKey : (rawSegKey || '__FREE__');
              const doneSet = mvfDoneSegmentKeysRef.current || new Set();
              if (!isFibreMode || (isFibreMode && segKey && segKey !== '__FREE__')) {
                // If segment is DONE, ignore further box selection for that segment.
                if (segKey && segKey !== '__FREE__' && doneSet.has(segKey)) {
                  // no-op
                } else {
                // Select ONLY the part of trench lines inside the box
                const toAdd = [];

                const segScale =
                  segKey && segKey !== '__FREE__' && typeof mvfSegmentScaleByKeyRef.current?.[segKey] === 'number'
                    ? mvfSegmentScaleByKeyRef.current[segKey]
                    : mvfCircuitsMultiplier;

                const committedPartIds = new Set(
                  (mvfCommittedTrenchPartsRef.current || [])
                    .filter((p) => String(p?.segmentKey || '') === String(segKey))
                    .map((p) => String(p?.id || ''))
                );

                // Allowed intervals: if a real segment is selected, box selection only applies on that segment route.
                // MV mode can still select without picking a segment (segKey === '__FREE__' => unrestricted).
                const allowedMap =
                  segKey && segKey !== '__FREE__'
                    ? (mvfRouteIntervalsBySegmentKeyRef.current?.[segKey] || null)
                    : null;

                // MV mode: when selecting freely, do NOT add selection over DONE segment routes (green is "completed").
                const blockedMap = (() => {
                  if (isFibreMode) return null;
                  if (segKey !== '__FREE__') return null;
                  const doneKeys = Array.from(mvfDoneSegmentKeysRef.current || []);
                  if (doneKeys.length === 0) return null;
                  const out = new Map(); // fid:lineIndex -> merged [[a,b]]
                  doneKeys.forEach((dk) => {
                    const m = mvfRouteIntervalsBySegmentKeyRef.current?.[String(dk)];
                    if (!m) return;
                    for (const [lk, arr] of m.entries()) {
                      if (!out.has(lk)) out.set(lk, []);
                      out.get(lk).push(...arr);
                    }
                  });
                  for (const [lk, arr] of out.entries()) out.set(lk, mergeIntervals(arr));
                  return out;
                })();

                const intersectIntervals = (aList, bList) => {
                  const out = [];
                  let i = 0, j = 0;
                  while (i < aList.length && j < bList.length) {
                    const a = aList[i];
                    const b = bList[j];
                    const lo = Math.max(a[0], b[0]);
                    const hi = Math.min(a[1], b[1]);
                    if (hi > lo) out.push([lo, hi]);
                    if (a[1] < b[1]) i++;
                    else j++;
                  }
                  return out;
                };

                // Coverage (idempotent) only within this segment key
                const coveredIntervalsByKey = new Map(); // fid:lineIndex -> merged intervals
                const addCovered = (p) => {
                  if (String(p?.segmentKey || '') !== String(segKey)) return;
                  const fid = String(p?.fid || '');
                  const lineIndex = Number(p?.lineIndex);
                  const a = Number(p?.startM);
                  const b = Number(p?.endM);
                  if (!fid || !Number.isFinite(lineIndex) || !Number.isFinite(a) || !Number.isFinite(b)) return;
                  const lo = Math.min(a, b);
                  const hi = Math.max(a, b);
                  if (!(hi > lo)) return;
                  const key = `${fid}:${lineIndex}`;
                  if (!coveredIntervalsByKey.has(key)) coveredIntervalsByKey.set(key, []);
                  coveredIntervalsByKey.get(key).push([lo, hi]);
                };
                (mvfSelectedTrenchPartsRef.current || []).forEach(addCovered);
                (mvfCommittedTrenchPartsRef.current || []).forEach(addCovered);
                for (const [k, arr] of coveredIntervalsByKey.entries()) coveredIntervalsByKey.set(k, mergeIntervals(arr));

                Object.keys(byId).forEach((fid) => {
                  const layer = byId[fid];
                  if (!layer || typeof layer.getBounds !== 'function' || typeof layer.getLatLngs !== 'function') return;
                  try {
                    const lb = layer.getBounds();
                    if (!lb || !bounds.intersects(lb)) return;
                  } catch (_e) {
                    void _e;
                    return;
                  }
                  const lines = asLineStrings(layer.getLatLngs());
                  lines.forEach((lineLL, lineIndex) => {
                    if (!lineLL || lineLL.length < 2) return;
                    const key = `${fid}:${lineIndex}`;
                    let candidates = computeIntervalsInBox({ L, map, bounds, lineLatLngs: lineLL, minMeters: 0.5 });
                    if (!candidates.length) return;
                    if (allowedMap) {
                      const allowed = allowedMap.get(key) || [];
                      if (!allowed.length) return;
                      candidates = intersectIntervals(candidates, allowed);
                      if (!candidates.length) return;
                    }
                    if (blockedMap) {
                      const blocked = blockedMap.get(key) || [];
                      if (blocked.length) {
                        // subtract blocked from each candidate interval
                        const remaining = [];
                        candidates.forEach((c) => {
                          const pieces = subtractInterval(c, blocked, 0.2);
                          remaining.push(...pieces);
                        });
                        candidates = mergeIntervals(remaining);
                        if (!candidates.length) return;
                      }
                    }
                    let covered = coveredIntervalsByKey.get(key) || [];
                    const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                    candidates.forEach(([a, b]) => {
                      const newInts = subtractInterval([a, b], covered, 0.2);
                      if (!newInts.length) return;
                      covered = mergeIntervals([...covered, ...newInts]);
                      coveredIntervalsByKey.set(key, covered);
                      newInts.forEach(([x, y]) => {
                        const id = `${fid}:${lineIndex}:${x.toFixed(2)}-${y.toFixed(2)}:seg:${segKey}`;
                        if (committedPartIds.has(id)) return;
                        const coords = sliceLineByMeters({ lineLatLngs: lineLL, cumData, startM: x, endM: y });
                        if (!coords || coords.length < 2) return;
                        toAdd.push({
                          id,
                          fid: String(fid),
                          lineIndex,
                          startM: x,
                          endM: y,
                          coords,
                          meters: Math.max(0, y - x),
                          metersMultiplier: segScale,
                          segmentKey: segKey,
                          source: 'box',
                        });
                      });
                    });
                  });
                });

                if (toAdd.length > 0) {
                  setMvfSelectedTrenchParts((prev) => [...(prev || []), ...toAdd]);
                }
                }
              }
            }

            // MVF segment selections are mapped into trench PARTs now,
            // so partial erase/select via box works automatically (no separate segment-route unselect needed).
          } else if (isMC4) {
            // MC4 MODE: Box advance/reset panel-end states (both ends)
            const ids = [];
            const panels = polygonById.current || {};
            const map = mapRef.current;

            const latLngsToLayerPoints = (layer) => {
              if (!map || !layer || typeof layer.getLatLngs !== 'function') return null;
              let ll = layer.getLatLngs();
              // Drill down until we have a ring (array of LatLng)
              while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
              while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
              const ring = Array.isArray(ll) ? ll : null;
              if (!ring || ring.length < 3) return null;
              const pts = ring.map((p) => map.latLngToLayerPoint(p)).filter(Boolean);
              if (pts.length < 3) return null;
              // drop duplicate last point if it equals first
              const a = pts[0];
              const z = pts[pts.length - 1];
              if (a && z && a.x === z.x && a.y === z.y) pts.pop();
              return pts;
            };

            const rectPts = (() => {
              if (!map) return null;
              const sw = bounds.getSouthWest();
              const ne = bounds.getNorthEast();
              const nw = L.latLng(ne.lat, sw.lng);
              const se = L.latLng(sw.lat, ne.lng);
              return [
                map.latLngToLayerPoint(nw),
                map.latLngToLayerPoint(ne),
                map.latLngToLayerPoint(se),
                map.latLngToLayerPoint(sw),
              ];
            })();

            const isPointInBox = (p, minX, maxX, minY, maxY) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;

            const isPointInPoly = (pt, poly) => {
              // Ray casting
              let inside = false;
              for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const xi = poly[i].x, yi = poly[i].y;
                const xj = poly[j].x, yj = poly[j].y;
                const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
                  (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi);
                if (intersect) inside = !inside;
              }
              return inside;
            };

            const segIntersects = (p1, p2, q1, q2) => {
              const orient = (a, b, c) => (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
              const onSeg = (a, b, c) =>
                Math.min(a.x, c.x) <= b.x && b.x <= Math.max(a.x, c.x) &&
                Math.min(a.y, c.y) <= b.y && b.y <= Math.max(a.y, c.y);
              const o1 = orient(p1, p2, q1);
              const o2 = orient(p1, p2, q2);
              const o3 = orient(q1, q2, p1);
              const o4 = orient(q1, q2, p2);
              if ((o1 > 0 && o2 < 0 || o1 < 0 && o2 > 0) && (o3 > 0 && o4 < 0 || o3 < 0 && o4 > 0)) return true;
              if (Math.abs(o1) < 1e-9 && onSeg(p1, q1, p2)) return true;
              if (Math.abs(o2) < 1e-9 && onSeg(p1, q2, p2)) return true;
              if (Math.abs(o3) < 1e-9 && onSeg(q1, p1, q2)) return true;
              if (Math.abs(o4) < 1e-9 && onSeg(q1, p2, q2)) return true;
              return false;
            };

            const panelIntersectsSelection = (layer) => {
              if (!map || !rectPts) return false;
              const poly = latLngsToLayerPoints(layer);
              if (!poly) return false;

              const xs = rectPts.map((p) => p.x);
              const ys = rectPts.map((p) => p.y);
              const minX = Math.min(...xs), maxX = Math.max(...xs);
              const minY = Math.min(...ys), maxY = Math.max(...ys);

              // 1) Any panel vertex in selection box
              if (poly.some((p) => isPointInBox(p, minX, maxX, minY, maxY))) return true;
              // 2) Any selection corner inside polygon
              if (rectPts.some((c) => isPointInPoly(c, poly))) return true;
              // 3) Any edge intersection
              const rectEdges = [
                [rectPts[0], rectPts[1]],
                [rectPts[1], rectPts[2]],
                [rectPts[2], rectPts[3]],
                [rectPts[3], rectPts[0]],
              ];
              for (let i = 0; i < poly.length; i++) {
                const a = poly[i];
                const b = poly[(i + 1) % poly.length];
                for (let k = 0; k < rectEdges.length; k++) {
                  const [c, d] = rectEdges[k];
                  if (segIntersects(a, b, c, d)) return true;
                }
              }
              return false;
            };

            Object.keys(panels).forEach((pid) => {
              const info = panels[pid];
              const layer = info?.layer;
              if (!layer || typeof layer.getBounds !== 'function') return;
              try {
                // Use robust polygon-vs-rect intersection (matches MC4 spec) instead of bounds-only.
                if (panelIntersectsSelection(layer)) ids.push(pid);
              } catch (_e) {
                void _e;
              }
            });
            if (ids.length > 0) {
              // Calculate next state based on current mode (using ref to get latest value)
              const currentMode = mc4SelectionModeRef.current; // null | 'mc4' | 'termination'
              if (!currentMode) {
                // Show warning, but DO NOT return early; onMouseUp must continue so the selection box closes.
                showMc4Toast('Please select a mode above.');
              } else {
                const advanceState = (cur) => {
                  if (currentMode === 'mc4') {
                    // MC4 mode: set to MC4 (blue), but never downgrade TERMINATED (green)
                    if (cur === 'terminated') return 'terminated';
                    return 'mc4';
                  } else if (currentMode === 'termination') {
                    // Termination mode: ONLY MC4 (blue) -> TERMINATED (green)
                    if (cur === 'mc4') return 'terminated';
                    if (cur === 'terminated') return 'terminated';
                    return cur;
                  }
                  return cur;
                };
                const changes = ids.map((pid) => {
                  const prev = mc4GetPanelState(pid);
                  const next = isRightClick
                    ? { left: null, right: null }
                    : { left: advanceState(prev.left), right: advanceState(prev.right) };
                  return { id: pid, prev, next };
                });

                // Warn if user is trying to terminate panels that are not MC4-installed (not blue)
                if (!isRightClick && currentMode === 'termination') {
                  let advanced = 0;
                  let blocked = 0;
                  changes.forEach((c) => {
                    const prev = c?.prev || { left: null, right: null };
                    const next = c?.next || { left: null, right: null };
                    if (prev.left === 'mc4' && next.left === 'terminated') advanced += 1;
                    if (prev.right === 'mc4' && next.right === 'terminated') advanced += 1;
                    if (prev.left == null && next.left == null) blocked += 1;
                    if (prev.right == null && next.right == null) blocked += 1;
                  });
                  if (advanced === 0 && blocked > 0) showMc4Toast('You must complete MC4 installation first.');
                  else if (blocked > 0) showMc4Toast('Some tables were not MC4-installed yet.');
                }

                setMc4PanelStates((s) => {
                  const out = { ...(s || {}) };
                  changes.forEach((c) => {
                    if (!c?.id) return;
                    if (isRightClick) delete out[c.id];
                    else out[c.id] = { left: c.next.left ?? null, right: c.next.right ?? null };
                  });
                  return out;
                });
                mc4PushHistory(changes);
              }
            }
          } else if (isLV) {
          // LV MODE: Box select inv_id labels (daily completion)
            const labels = lvInvLabelByIdRef.current || {};
            const invIdsInBounds = [];
            Object.keys(labels).forEach((invIdNorm) => {
              const lbl = labels[invIdNorm];
              if (!lbl || typeof lbl.getLatLng !== 'function') return;
              const ll = lbl.getLatLng();
              if (ll && bounds.contains(ll)) invIdsInBounds.push(invIdNorm);
            });

            if (invIdsInBounds.length > 0) {
              setLvCompletedInvIds((prev) => {
                const next = new Set(prev);
                if (isRightClick) invIdsInBounds.forEach((id) => next.delete(id));
                else invIdsInBounds.forEach((id) => next.add(id));
                return next;
              });
            }
          } else {
            // NORMAL MODE: Select polygons (DC)
          const directlySelectedIds = [];
          
          Object.keys(polygonById.current).forEach(polygonId => {
            const polygonInfo = polygonById.current[polygonId];
            if (polygonInfo && polygonInfo.layer && polygonInfo.layer.getBounds) {
              const polygonBounds = polygonInfo.layer.getBounds();
              if (bounds.intersects(polygonBounds)) {
                directlySelectedIds.push(polygonId);
              }
            }
          });
          
          const finalSelectedIds = new Set();
          directlySelectedIds.forEach(polygonId => {
            const polygonInfo = polygonById.current[polygonId];
            if (polygonInfo && polygonInfo.isSmallTable && polygonInfo.stringId) {
              Object.keys(polygonById.current).forEach(pid => {
                const info = polygonById.current[pid];
                if (info && info.stringId === polygonInfo.stringId && info.isSmallTable) {
                  finalSelectedIds.add(pid);
                }
              });
            } else {
              finalSelectedIds.add(polygonId);
            }
          });
          
          if (finalSelectedIds.size > 0) {
            setSelectedPolygons(prev => {
              const next = new Set(prev);
              if (isRightClick) {
                finalSelectedIds.forEach(id => next.delete(id));
              } else {
                finalSelectedIds.forEach(id => next.add(id));
              }
              return next;
            });
          }
          }
        }
        
        boxRectRef.current.remove();
        boxRectRef.current = null;
      } else if (!wasDrag && isRightClick) {
        // Right-click without dragging: always allow MVF "unselect"
        // - Clear current, unsubmitted mv_trench selections
        // - Clear current, unsubmitted mv_trench PART selections
        // - Clear MVF segment highlights selected from the segment list
        if (isMVF) {
          if ((mvfSelectedTrenchIdsRef.current?.size || 0) > 0) {
            setMvfSelectedTrenchIds(new Set());
          }
          if ((mvfSelectedTrenchPartsRef.current?.length || 0) > 0) {
            setMvfSelectedTrenchParts([]);
          }
          if ((mvfActiveSegmentKeysRef.current?.size || 0) > 0) {
            setMvfActiveSegmentKeys(new Set());
          }
        }
      } else if (!wasDrag && !isRightClick && noteMode) {
        // NOTE MODE: Create note on simple click (unless a marker click just happened)
        if (!markerClickedRef.current) {
          createNote(clickLatLng);
        }
      } else if (!wasDrag && !isRightClick && !noteMode) {
        // SINGLE CLICK SELECTION MODE: Select individual items by clicking
        const clickPoint = map.latLngToLayerPoint(clickLatLng);
        const clickTolerance = 10; // pixels

        // MVT: intercept clicks on our custom labels (counter + TESTED) before any other selection logic.
        if (isMVT) {
          const distToLabelPx = (lbl) => {
            try {
              if (!lbl || typeof lbl.getLatLng !== 'function') return Infinity;
              const ll = lbl.getLatLng();
              const pt = map.latLngToLayerPoint(ll);
              return Math.sqrt((pt.x - clickPoint.x) ** 2 + (pt.y - clickPoint.y) ** 2);
            } catch (_e) {
              void _e;
              return Infinity;
            }
          };

          const hitRadius = 22; // px

          // 1) TESTED click (always clickable)
          try {
            const pool = mvtTestedLabelPoolRef.current || [];
            const active = mvtTestedLabelActiveCountRef.current || 0;
            let best = null;
            let bestD = Infinity;
            for (let i = 0; i < active; i++) {
              const lbl = pool[i];
              const d = distToLabelPx(lbl);
              if (d < hitRadius && d < bestD) { bestD = d; best = lbl; }
            }
            if (best) {
              const stationLabel = String(best._mvtStationLabel || '').trim();
              // IMPORTANT: read directly from latest CSV ref to avoid stale pooled label fields
              const csv = mvtTestCsvByFromRef.current || {};
              const normSt = normalizeId(stationLabel);
              const candKeys = [normSt];
              const pad2 = (n) => String(n).padStart(2, '0');
              const mSs = normSt.match(/^ss(\d{1,2})$/i);
              const mSub = normSt.match(/^sub(\d{1,2})$/i);
              if (mSs) {
                const nn = pad2(mSs[1]);
                candKeys.push(`ss${nn}`);
                candKeys.push(`sub${nn}`);
              }
              if (mSub) {
                const nn = pad2(mSub[1]);
                candKeys.push(`sub${nn}`);
                candKeys.push(`ss${nn}`);
              }
              let fromKey = '';
              let row = null;
              for (const k of candKeys) {
                if (csv[k]) { fromKey = k; row = csv[k]; break; }
              }
              const phases = row ? {
                L1: row.L1 || { value: '', status: 'N/A' },
                L2: row.L2 || { value: '', status: 'N/A' },
                L3: row.L3 || { value: '', status: 'N/A' },
              } : { L1: { value: '', status: 'N/A' }, L2: { value: '', status: 'N/A' }, L3: { value: '', status: 'N/A' } };
              const x = draggingRef.current?.startPoint?.x ?? 0;
              const y = draggingRef.current?.startPoint?.y ?? 0;
              // Prefer the click-location popup (panel may stay unused in MVT)
              setMvtTestPanel(null);
              setMvtTestPopup({ stationLabel, fromKey, phases, x, y });
              // Don't allow this click to act as selection elsewhere
              draggingRef.current = null;
              return;
            }
          } catch (_e) {
            void _e;
          }

          // 2) Counter click (editable unless locked)
          try {
            const pool = mvtCounterLabelPoolRef.current || [];
            const active = mvtCounterLabelActiveCountRef.current || 0;
            let best = null;
            let bestD = Infinity;
            for (let i = 0; i < active; i++) {
              const lbl = pool[i];
              const d = distToLabelPx(lbl);
              if (d < hitRadius && d < bestD) { bestD = d; best = lbl; }
            }
            if (best) {
              const stationNorm = String(best._mvtStationNorm || '');
              const lockedNow = Boolean(best._mvtLocked);
              if (stationNorm && !lockedNow) {
                const prevVal = Math.max(0, Math.min(3, Number(mvtTerminationByStationRef.current?.[stationNorm] ?? 0)));
                const nextVal = Math.min(3, prevVal + 1);
                if (nextVal !== prevVal) {
                  mvtTermPushHistory(stationNorm, prevVal, nextVal);
                  setMvtTerminationByStation((prev) => {
                    const base = prev && typeof prev === 'object' ? { ...prev } : {};
                    base[stationNorm] = nextVal;
                    return base;
                  });
                }
                setMvtTermPanel({
                  stationLabel: String(best._mvtStationLabel || '').trim() || stationNorm,
                  stationNorm,
                  value: nextVal,
                });
              } else if (stationNorm && lockedNow) {
                setMvtTermPanel({
                  stationLabel: String(best._mvtStationLabel || '').trim() || stationNorm,
                  stationNorm,
                  value: 3,
                });
              }
              draggingRef.current = null;
              return;
            }
          } catch (_e) {
            void _e;
          }
        }

        if (isMC4) {
          // MC4: Single click to advance panel state
          const panels = polygonById.current || {};
          let clickedPanelId = null;

          const isPointInPoly = (pt, poly) => {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              const xi = poly[i].x, yi = poly[i].y;
              const xj = poly[j].x, yj = poly[j].y;
              const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
                (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi);
              if (intersect) inside = !inside;
            }
            return inside;
          };

          const latLngsToLayerPoints = (layer) => {
            if (!map || !layer || typeof layer.getLatLngs !== 'function') return null;
            let ll = layer.getLatLngs();
            while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
            while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
            const ring = Array.isArray(ll) ? ll : null;
            if (!ring || ring.length < 3) return null;
            const pts = ring.map((p) => map.latLngToLayerPoint(p)).filter(Boolean);
            if (pts.length < 3) return null;
            const a = pts[0];
            const z = pts[pts.length - 1];
            if (a && z && a.x === z.x && a.y === z.y) pts.pop();
            return pts;
          };

          Object.keys(panels).forEach((pid) => {
            if (clickedPanelId) return;
            const info = panels[pid];
            const layer = info?.layer;
            if (!layer) return;
            const poly = latLngsToLayerPoints(layer);
            if (poly && isPointInPoly(clickPoint, poly)) {
              clickedPanelId = pid;
            }
          });

          if (clickedPanelId) {
            const currentMode = mc4SelectionModeRef.current; // null | 'mc4' | 'termination'
            const advanceState = (cur) => {
              if (currentMode === 'mc4') {
                // MC4 mode: set to MC4 (blue), but never downgrade TERMINATED (green)
                if (cur === 'terminated') return 'terminated';
                return 'mc4';
              } else if (currentMode === 'termination') {
                // Termination mode: ONLY MC4 (blue) -> TERMINATED (green)
                if (cur === 'mc4') return 'terminated';
                if (cur === 'terminated') return 'terminated';
                return cur;
              }
              // No mode - forward-only cycle: null -> mc4 -> terminated
              if (cur == null) return 'mc4';
              if (cur === 'mc4') return 'terminated';
              return 'terminated';
            };
            const prev = mc4GetPanelState(clickedPanelId);
            const next = { left: advanceState(prev.left), right: advanceState(prev.right) };
            const changes = [{ id: clickedPanelId, prev, next }];
            // In termination mode, if neither end changes, treat as no-op.
            if (currentMode === 'termination' && next.left === prev.left && next.right === prev.right) {
              draggingRef.current = null;
              return;
            }
            setMc4PanelStates((s) => {
              const out = { ...(s || {}) };
              out[clickedPanelId] = { left: next.left ?? null, right: next.right ?? null };
              return out;
            });
            mc4PushHistory(changes);
          }
        } else if (isLV) {
          // LV: Single click to toggle inv_id completion
          const labels = lvInvLabelByIdRef.current || {};
          let clickedInvId = null;
          let minDist = Infinity;

          Object.keys(labels).forEach((invIdNorm) => {
            const lbl = labels[invIdNorm];
            if (!lbl || typeof lbl.getLatLng !== 'function') return;
            const ll = lbl.getLatLng();
            const pt = map.latLngToLayerPoint(ll);
            const dist = Math.sqrt((pt.x - clickPoint.x) ** 2 + (pt.y - clickPoint.y) ** 2);
            if (dist < clickTolerance && dist < minDist) {
              minDist = dist;
              clickedInvId = invIdNorm;
            }
          });

          if (clickedInvId) {
            setLvCompletedInvIds((prev) => {
              const next = new Set(prev);
              if (next.has(clickedInvId)) {
                next.delete(clickedInvId);
              } else {
                next.add(clickedInvId);
              }
              return next;
            });
          }
        } else if (isMVF) {
          // MVF: Single click near a trench line to select a small segment around the click point
          const byId = mvfTrenchByIdRef.current || {};
          const isFibreMode = String(activeMode?.key || '').toUpperCase() === 'FIB';
          const rawSegKey = String(mvfCurrentSegmentKeyRef.current || '');
          const segKey = isFibreMode ? rawSegKey : (rawSegKey || '__FREE__');
          const doneSet = mvfDoneSegmentKeysRef.current || new Set();

          if (!isFibreMode || (isFibreMode && segKey && segKey !== '__FREE__')) {
            if (!(segKey && segKey !== '__FREE__' && doneSet.has(segKey))) {
              let bestMatch = null;
              let bestDist = Infinity;
              const clickMeters = 5; // Select 5 meters around click point

              Object.keys(byId).forEach((fid) => {
                const layer = byId[fid];
                if (!layer || typeof layer.getLatLngs !== 'function') return;
                const lines = asLineStrings(layer.getLatLngs());
                lines.forEach((lineLL, lineIndex) => {
                  if (!lineLL || lineLL.length < 2) return;
                  for (let i = 0; i < lineLL.length - 1; i++) {
                    const p1 = map.latLngToLayerPoint(lineLL[i]);
                    const p2 = map.latLngToLayerPoint(lineLL[i + 1]);
                    // Distance from point to line segment
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len2 = dx * dx + dy * dy;
                    let t = 0;
                    if (len2 > 0) {
                      t = Math.max(0, Math.min(1, ((clickPoint.x - p1.x) * dx + (clickPoint.y - p1.y) * dy) / len2));
                    }
                    const projX = p1.x + t * dx;
                    const projY = p1.y + t * dy;
                    const dist = Math.sqrt((clickPoint.x - projX) ** 2 + (clickPoint.y - projY) ** 2);
                    if (dist < clickTolerance && dist < bestDist) {
                      bestDist = dist;
                      bestMatch = { fid, lineIndex, lineLL, segmentIndex: i, t };
                    }
                  }
                });
              });

              if (bestMatch) {
                const { fid, lineIndex, lineLL } = bestMatch;
                const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                const totalLen = cumData[cumData.length - 1] || 0;

                // Find meter position of click
                let clickM = 0;
                for (let i = 0; i < lineLL.length - 1; i++) {
                  const p1 = map.latLngToLayerPoint(lineLL[i]);
                  const p2 = map.latLngToLayerPoint(lineLL[i + 1]);
                  const dx = p2.x - p1.x;
                  const dy = p2.y - p1.y;
                  const len2 = dx * dx + dy * dy;
                  let t = 0;
                  if (len2 > 0) {
                    t = Math.max(0, Math.min(1, ((clickPoint.x - p1.x) * dx + (clickPoint.y - p1.y) * dy) / len2));
                  }
                  const projX = p1.x + t * dx;
                  const projY = p1.y + t * dy;
                  const dist = Math.sqrt((clickPoint.x - projX) ** 2 + (clickPoint.y - projY) ** 2);
                  if (dist < clickTolerance + 1) {
                    clickM = cumData[i] + t * (cumData[i + 1] - cumData[i]);
                    break;
                  }
                }

                const startM = Math.max(0, clickM - clickMeters / 2);
                const endM = Math.min(totalLen, clickM + clickMeters / 2);

                if (endM > startM + 0.5) {
                  const segScale =
                    segKey && segKey !== '__FREE__' && typeof mvfSegmentScaleByKeyRef.current?.[segKey] === 'number'
                      ? mvfSegmentScaleByKeyRef.current[segKey]
                      : mvfCircuitsMultiplier;

                  const coords = sliceLineByMeters({ lineLatLngs: lineLL, cumData, startM, endM });
                  if (coords && coords.length >= 2) {
                    const id = `${fid}:${lineIndex}:${startM.toFixed(2)}-${endM.toFixed(2)}:seg:${segKey}`;
                    const committedPartIds = new Set(
                      (mvfCommittedTrenchPartsRef.current || [])
                        .filter((p) => String(p?.segmentKey || '') === String(segKey))
                        .map((p) => String(p?.id || ''))
                    );

                    if (!committedPartIds.has(id)) {
                      setMvfSelectedTrenchParts((prev) => {
                        // Check if already selected
                        const existing = (prev || []).find((p) => p.id === id);
                        if (existing) return prev;
                        return [...(prev || []), {
                          id,
                          fid: String(fid),
                          lineIndex,
                          startM,
                          endM,
                          coords,
                          meters: Math.max(0, endM - startM),
                          metersMultiplier: segScale,
                          segmentKey: segKey,
                          source: 'click',
                        }];
                      });
                    }
                  }
                }
              }
            }
          }
        } else {
          // DC: Single click to toggle polygon selection
          const panels = polygonById.current || {};
          let clickedPolygonId = null;

          const isPointInPoly = (pt, poly) => {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              const xi = poly[i].x, yi = poly[i].y;
              const xj = poly[j].x, yj = poly[j].y;
              const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
                (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi);
              if (intersect) inside = !inside;
            }
            return inside;
          };

          const latLngsToLayerPoints = (layer) => {
            if (!map || !layer || typeof layer.getLatLngs !== 'function') return null;
            let ll = layer.getLatLngs();
            while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
            while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
            const ring = Array.isArray(ll) ? ll : null;
            if (!ring || ring.length < 3) return null;
            const pts = ring.map((p) => map.latLngToLayerPoint(p)).filter(Boolean);
            if (pts.length < 3) return null;
            const a = pts[0];
            const z = pts[pts.length - 1];
            if (a && z && a.x === z.x && a.y === z.y) pts.pop();
            return pts;
          };

          Object.keys(panels).forEach((pid) => {
            if (clickedPolygonId) return;
            const info = panels[pid];
            const layer = info?.layer;
            if (!layer) return;
            const poly = latLngsToLayerPoints(layer);
            if (poly && isPointInPoly(clickPoint, poly)) {
              clickedPolygonId = pid;
            }
          });

          if (clickedPolygonId) {
            // DCCT: polygon clicks are handled by Leaflet per-polygon handler (toggle overlays).
            if (isDCCT) {
              // do nothing here
            } else {
              const polygonInfo = polygonById.current[clickedPolygonId];
              const finalSelectedIds = new Set();

              if (polygonInfo && polygonInfo.isSmallTable && polygonInfo.stringId) {
                Object.keys(polygonById.current).forEach(pid => {
                  const info = polygonById.current[pid];
                  if (info && info.stringId === polygonInfo.stringId && info.isSmallTable) {
                    finalSelectedIds.add(pid);
                  }
                });
              } else {
                finalSelectedIds.add(clickedPolygonId);
              }

              setSelectedPolygons(prev => {
                const next = new Set(prev);
                // Toggle: if all are selected, deselect; otherwise select
                const allSelected = Array.from(finalSelectedIds).every(id => next.has(id));
                if (allSelected) {
                  finalSelectedIds.forEach(id => next.delete(id));
                } else {
                  finalSelectedIds.forEach(id => next.add(id));
                }
                return next;
              });
            }
          } else if (isDCCT) {
            // DCCT: Clicking on empty area clears filter + all test overlays
            setDcctFilter(null);
            dcctClearTestOverlays();
          }
        }
      }
      
      draggingRef.current = null;
    };
    
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseup', onMouseUp);
    
    return () => {
      container.removeEventListener('contextmenu', preventContextMenu);
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseup', onMouseUp);
    };
  // IMPORTANT: include isMC4 (and module key) so drag-selection behavior updates when switching modes.
  }, [mapReady, activeMode?.key, isLV, isMVF, isMC4, isMVT, isLVTT, isDCCT, stringPoints, noteMode, notes]);

  useEffect(() => {
    mapRef.current = L.map('map', {
      zoomControl: false,
      preferCanvas: true,
      // Animations can feel laggy with lots of canvas layers
      zoomAnimation: false,
      markerZoomAnimation: false,
      fadeAnimation: false,
    });
    setMapReady(true);

    // Dedicated canvas renderer + pane for string_text labels (prevents ghosting when hiding/showing)
    try {
      const paneName = 'stringTextPane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '450'; // above polygons, below markers
        pane.style.pointerEvents = 'none';
      }
      stringTextRendererRef.current = L.canvas({ padding: 0.1, pane: paneName });
    } catch (_e) {
      void _e;
      stringTextRendererRef.current = null;
    }

    // MVF: highlight layer (green trench path for selected segment)
    try {
      if (mvfHighlightLayerRef.current) {
        mvfHighlightLayerRef.current.remove();
      }
      mvfHighlightLayerRef.current = L.layerGroup().addTo(mapRef.current);
    } catch (_e) {
      void _e;
      mvfHighlightLayerRef.current = null;
    }

    // MVF: partial trench selection/completion overlay layers
    try {
      if (mvfTrenchSelectedLayerRef.current) mvfTrenchSelectedLayerRef.current.remove();
      mvfTrenchSelectedLayerRef.current = L.layerGroup().addTo(mapRef.current);
    } catch (_e) {
      void _e;
      mvfTrenchSelectedLayerRef.current = null;
    }
    try {
      if (mvfTrenchCommittedLayerRef.current) mvfTrenchCommittedLayerRef.current.remove();
      mvfTrenchCommittedLayerRef.current = L.layerGroup().addTo(mapRef.current);
    } catch (_e) {
      void _e;
      mvfTrenchCommittedLayerRef.current = null;
    }

    // Hide raster tiles for best performance + clean dark background
    // (Re-enable if you want map imagery)
    // L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    //   maxZoom: 23,
    //   maxNativeZoom: 19,
    //   attribution: '&copy; OpenStreetMap',
    //   updateWhenIdle: true,
    //   updateWhenZooming: false,
    //   keepBuffer: 1
    // }).addTo(mapRef.current);

    fetchAllGeoJson();

    // DCCT: Clear test overlays immediately when clicking empty map.
    // Table clicks stop propagation/prevent default, so this typically only triggers for empty clicks.
    const onMapClick = () => {
      if (!isDCCTRef.current) return;
      setDcctFilter(null);
      dcctClearTestOverlays();
    };
    try {
      mapRef.current.on('click', onMapClick);
    } catch (_e) {
      void _e;
    }

    return () => {
      try {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        mapRef.current?.off('zoomend moveend', scheduleStringTextLabelUpdate);
        mapRef.current?.off('click', onMapClick);
      } catch (_e) { void _e; }
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // MC4: disable map double-click zoom so polygon dblclick can be used for TERMINATED instantly.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      if (isMC4) map.doubleClickZoom?.disable?.();
      else map.doubleClickZoom?.enable?.();
    } catch (_e) {
      void _e;
    }
  }, [isMC4]);

  // MVF: render selected/committed trench PART overlays (only the selected portion turns green).
  useEffect(() => {
    if (!isMVF) return;
    const map = mapRef.current;
    if (!map) return;
    const selectedLayer = mvfTrenchSelectedLayerRef.current;
    const committedLayer = mvfTrenchCommittedLayerRef.current;
    if (!selectedLayer || !committedLayer) return;

    try { selectedLayer.clearLayers(); } catch (_e) { void _e; }
    try { committedLayer.clearLayers(); } catch (_e) { void _e; }

            // Committed parts (locked) - completed GREEN
    (mvfCommittedTrenchParts || []).forEach((p) => {
      if (!p?.coords || p.coords.length < 2) return;
              const line = L.polyline(p.coords, { color: '#16a34a', weight: 6.0, opacity: 1.0, interactive: false });
      committedLayer.addLayer(line);
    });

            // Selected (pending) parts (completed-in-progress): always vivid GREEN
    (mvfSelectedTrenchParts || []).forEach((p) => {
      if (!p?.coords || p.coords.length < 2) return;
      const segKey = String(p?.segmentKey || '');
      const color = '#22c55e';
      const line = L.polyline(p.coords, { color: '#00e676', weight: 6.4, opacity: 1.0, interactive: true });
      line._mvfTrenchPartId = p.id;
      line.on('contextmenu', (evt) => {
        try {
          if (evt?.originalEvent) {
            L.DomEvent.stopPropagation(evt.originalEvent);
            L.DomEvent.preventDefault(evt.originalEvent);
          }
        } catch (_e) {
          void _e;
        }
        setMvfSelectedTrenchParts((prev) => (prev || []).filter((x) => x?.id !== p.id));
      });
      selectedLayer.addLayer(line);
    });
  }, [isMVF, mvfSelectedTrenchParts, mvfCommittedTrenchParts]);

  // Reload GeoJSON layers when module changes (same UI, different dataset)
  useEffect(() => {
    if (!mapRef.current) return;
    fetchAllGeoJson();
  }, [activeMode]);

  // If a module wants string_text on hover/cursor, control label visibility by map pointer state.
  useEffect(() => {
    if (!mapRef.current) return;
    const visibility = effectiveStringTextVisibility;
    if (visibility !== 'hover' && visibility !== 'cursor') return;

    const el = mapRef.current.getContainer();
    if (!el) return;

    const onEnter = () => {
      // hover mode shows labels on enter; cursor mode waits for actual cursor position
      if (visibility === 'hover') {
        stringLabelsEnabledRef.current = true;
        scheduleStringTextLabelUpdate();
      } else {
        stringLabelsEnabledRef.current = false;
        cursorLabelBoundsRef.current = null;
        cursorPointRef.current = null;
        clearStringTextLabelsNow();
        scheduleStringTextLabelUpdate(); // ensures nothing is rendered
      }
    };
    const onLeave = () => {
      stringLabelsEnabledRef.current = false;
      cursorLabelBoundsRef.current = null;
      cursorPointRef.current = null;
      clearStringTextLabelsNow(); // instant hide (no ghosting)
      scheduleStringTextLabelUpdate(); // clears active labels
    };

    const onMove = (evt) => {
      if (visibility !== 'cursor') return;
      if (!mapRef.current) return;

      if (cursorMoveRafRef.current) return;
      cursorMoveRafRef.current = requestAnimationFrame(() => {
        cursorMoveRafRef.current = null;
        const map = mapRef.current;
        if (!map) return;

        const p = map.mouseEventToContainerPoint(evt);
        cursorPointRef.current = p;
        const r = STRING_LABEL_CURSOR_PX;
        const sw = map.containerPointToLatLng([p.x - r, p.y + r]);
        const ne = map.containerPointToLatLng([p.x + r, p.y - r]);
        cursorLabelBoundsRef.current = L.latLngBounds(sw, ne);
        // Optional gate: only enable cursor labels when cursor is over a table polygon (MC4 requirement).
        const requiresPoly = Boolean(activeMode?.stringTextCursorRequiresPolygon);
        if (requiresPoly) {
          const ll = map.containerPointToLatLng(p);
          let onPoly = false;
          try {
            const entries = Object.values(polygonById.current || {});
            for (let i = 0; i < entries.length; i++) {
              const layer = entries[i]?.layer;
              if (!layer || typeof layer.getBounds !== 'function') continue;
              const b = layer.getBounds();
              if (b && b.contains(ll)) { onPoly = true; break; }
            }
          } catch (_e) {
            void _e;
          }
          stringLabelsEnabledRef.current = onPoly;
          if (!onPoly) {
            cursorLabelBoundsRef.current = null;
            clearStringTextLabelsNow(); // instant hide when cursor leaves any polygon
            scheduleStringTextLabelUpdate();
            return;
          }
        } else {
          stringLabelsEnabledRef.current = true;
        }
        scheduleStringTextLabelUpdate();
      });
    };

    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('mousemove', onMove);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      el.removeEventListener('mousemove', onMove);
      if (cursorMoveRafRef.current) cancelAnimationFrame(cursorMoveRafRef.current);
      cursorMoveRafRef.current = null;
    };
  }, [activeMode, clearStringTextLabelsNow, effectiveStringTextVisibility, scheduleStringTextLabelUpdate]);

  // Seçimi temizle


  // Field-ready UI constants (industrial, glove-friendly)
  const BTN_BASE =
    'relative inline-flex h-12 w-12 items-center justify-center rounded-none border-2 text-slate-100 shadow-[0_5px_0_rgba(0,0,0,0.50)] transition-transform active:translate-y-[2px] active:shadow-[0_3px_0_rgba(0,0,0,0.50)] focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 disabled:opacity-50 disabled:cursor-not-allowed';
  const BTN_SMALL_BASE =
    'relative inline-flex h-9 w-9 items-center justify-center rounded-none border-2 text-slate-100 shadow-[0_4px_0_rgba(0,0,0,0.50)] transition-transform active:translate-y-[2px] active:shadow-[0_2px_0_rgba(0,0,0,0.50)] focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 disabled:opacity-50 disabled:cursor-not-allowed';
  const BTN_NEUTRAL = `${BTN_BASE} bg-slate-800 border-slate-500 hover:bg-slate-700 hover:border-slate-400`;
  const BTN_ACTIVE = `${BTN_BASE} bg-sky-500 border-sky-200 text-black hover:bg-sky-400`;
  const BTN_PRIMARY = `${BTN_BASE} bg-amber-500 border-amber-300 text-black hover:bg-amber-400`;
  const BTN_DANGER = `${BTN_BASE} bg-red-600 border-red-300 text-white hover:bg-red-500`;
  const BTN_SMALL_NEUTRAL = `${BTN_SMALL_BASE} bg-slate-800 border-slate-500 hover:bg-slate-700 hover:border-slate-400`;
  const ICON = 'h-6 w-6';
  const ICON_SMALL = 'h-5 w-5';

  // Shared counter typography (match DC cable pulling look across all modules)
  const COUNTER_BOX = 'min-w-[140px] border-2 border-slate-700 bg-slate-800 py-2 px-2';
  const COUNTER_GRID = 'grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-1';
  const COUNTER_LABEL = 'text-xs font-bold text-slate-200';
  const COUNTER_VALUE = 'text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap';
  const COUNTER_DONE_LABEL = 'text-xs font-bold text-emerald-400';
  const COUNTER_DONE_VALUE = 'text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap';

  // LV completion is tracked via inv_id clicks; MVF uses segment completion; DC uses polygon selection (+/-).
  const lvCompletedLength = isLV
    ? Array.from(lvCompletedInvIds).reduce((sum, invId) => {
        const data = lengthData[normalizeId(invId)];
        if (!data?.plus?.length) return sum;
        return sum + data.plus.reduce((a, b) => a + b, 0);
      }, 0)
    : 0;

  const mvfSelectedCableMeters = isMVF
    ? (mvfSelectedTrenchParts || []).reduce((sum, p) => {
        const segKey = String(p?.segmentKey || '');
        if (segKey && mvfDoneSegmentKeysRef.current?.has?.(segKey)) return sum; // done segments count via CSV length
        const m = Number(p?.meters) || 0; // trench meters
        const mult =
          typeof p?.metersMultiplier === 'number' && Number.isFinite(p.metersMultiplier)
            ? p.metersMultiplier
            : mvfCircuitsMultiplier;
        return sum + m * mult;
      }, 0)
    : 0;
  const mvfCommittedCableMeters = isMVF
    ? (mvfCommittedTrenchParts || []).reduce((sum, p) => {
        const segKey = String(p?.segmentKey || '');
        if (segKey && mvfDoneSegmentKeysRef.current?.has?.(segKey)) return sum; // done segments count via CSV length
        const m = Number(p?.meters) || 0;
        const mult =
          typeof p?.metersMultiplier === 'number' && Number.isFinite(p.metersMultiplier)
            ? p.metersMultiplier
            : mvfCircuitsMultiplier;
        return sum + m * mult;
      }, 0)
    : 0;
  const mvfDoneCableMeters = isMVF
    ? (mvfSegments || []).reduce((sum, s) => (mvfDoneSegmentKeys.has(s.key) ? sum + (Number(s.length) || 0) : sum), 0)
    : 0;

  // MVF Total must come from CSV (already represents 3 circuits); completed comes from selected trench meters * 3.
  const overallTotal = isMVF ? totalPlus : ((isLV || useSimpleCounters) ? totalPlus : (totalPlus + totalMinus));
  const completedTotal = isLV
    ? lvCompletedLength
    : (isMVF ? (mvfSelectedCableMeters + mvfCommittedCableMeters + mvfDoneCableMeters) : (completedPlus + completedMinus));
  const completedPct = overallTotal > 0 ? (completedTotal / overallTotal) * 100 : 0;
  const remainingPlus = Math.max(0, totalPlus - completedPlus);
  const remainingMinus = Math.max(0, totalMinus - completedMinus);
  const remainingTotal = Math.max(0, overallTotal - completedTotal);

  // MC4 counters (per string_text count; each string/table has 2 ends)
  // IMPORTANT: Must be defined before workSelectionCount/workAmount which depend on it
  const mc4Counts = useMemo(() => {
    if (!isMC4) return null;
    // Source of truth for total strings:
    // 1) MC4 dc_strings.csv row count (9056)
    // 2) module default (9056)
    // Never fall back to string_text.geojson because it can be incomplete/different.
    const totalStrings =
      typeof mc4TotalStringsCsv === 'number' && Number.isFinite(mc4TotalStringsCsv)
        ? mc4TotalStringsCsv
        : (Number(activeMode?.mc4DefaultStrings) || 9056);
    const totalEnds = totalStrings * 2;

    // Completed ends should match the number of VISIBLE dots.
    // Many panels can overlap the same physical table/end; dedupe by end position.
    const panels = polygonById.current || {};
    const mc4Keys = new Set(); // endpoints that are MC4 or TERMINATED
    const termKeys = new Set(); // endpoints that are TERMINATED
    const toKey = (latLng) => {
      if (!latLng) return null;
      const lat = Number(latLng.lat);
      const lng = Number(latLng.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return `${lat.toFixed(6)},${lng.toFixed(6)}`;
    };

    Object.keys(mc4PanelStates || {}).forEach((id) => {
      const st = mc4PanelStates[id] || { left: null, right: null };
      const panel = panels[id];
      if (panel && !panel.mc4Ends && typeof panel.computeEnds === 'function') {
        try {
          const ends = panel.computeEnds();
          if (ends) panel.mc4Ends = ends;
        } catch (_e) {
          void _e;
        }
      }
      const ends = panel?.mc4Ends;
      if (!ends?.leftPos || !ends?.rightPos) return;

      const leftKey = toKey(ends.leftPos);
      const rightKey = toKey(ends.rightPos);

      if (leftKey) {
        if (st.left === MC4_PANEL_STATES.MC4 || st.left === MC4_PANEL_STATES.TERMINATED) mc4Keys.add(leftKey);
        if (st.left === MC4_PANEL_STATES.TERMINATED) termKeys.add(leftKey);
      }
      if (rightKey) {
        if (st.right === MC4_PANEL_STATES.MC4 || st.right === MC4_PANEL_STATES.TERMINATED) mc4Keys.add(rightKey);
        if (st.right === MC4_PANEL_STATES.TERMINATED) termKeys.add(rightKey);
      }
    });

    let mc4Completed = mc4Keys.size;
    let terminatedCompleted = termKeys.size;

    // Safety clamp if polygons != strings for any reason
    mc4Completed = Math.min(mc4Completed, totalEnds);
    terminatedCompleted = Math.min(terminatedCompleted, totalEnds);

    return { totalStrings, totalEnds, mc4Completed, terminatedCompleted };
  }, [isMC4, mc4PanelStates, mc4HistoryTick, mc4TotalStringsCsv]);

  const workSelectionCount = isLV 
    ? lvCompletedInvIds.size 
    : (isMVF 
      ? (mvfSelectedTrenchParts?.length || 0) 
      : (isMC4 
        ? Object.keys(mc4PanelStates || {}).length 
        : selectedPolygons.size));
  const mvtCompletedForSubmit = isMVT
    ? Math.max(0, Object.values(mvtTerminationByStation || {}).reduce((s, v) => s + Math.max(0, Math.min(3, Number(v) || 0)), 0))
    : 0;
  const lvttCompletedForSubmit = (isLVTT && String(lvttSubMode || 'termination') === 'termination')
    ? Math.max(
      0,
      Object.values(lvttTerminationByInv || {}).reduce((s, v) => s + Math.max(0, Math.min(3, Number(v) || 0)), 0)
    )
    : 0;
  const lvttWorkUnit = lvttCompletedForSubmit === 1 ? 'cable terminated' : 'cables terminated';
  const workAmount = isMVF 
    ? mvfSelectedCableMeters 
    : (isMC4 
      ? (mc4Counts?.mc4Completed || 0) 
      : completedTotal); // MVF: pending selected cable meters (scaled), MC4: completed ends count

  const [dwgUrl, setDwgUrl] = useState('');
  useEffect(() => {
    const linkPath = activeMode.linkPath;
    if (!linkPath) return;
    fetch(linkPath)
      .then((r) => r.text())
      .then((t) => setDwgUrl((t || '').trim()))
      .catch(() => setDwgUrl(linkPath));
  }, [activeMode.linkPath]);

  const effectiveCustomCounters =
    customCounters ||
    (isMC4 && mc4Counts ? (
      <div className="flex min-w-0 items-stretch gap-3 overflow-x-auto pb-1 justify-self-start">
        {(() => {
          const total = Number(mc4Counts.totalEnds) || 0; // expected: 9056 * 2 = 18112
          const mc4Done = Number(mc4Counts.mc4Completed) || 0;
          const termDone = Number(mc4Counts.terminatedCompleted) || 0;
          const mc4Rem = Math.max(0, total - mc4Done);
          const termRem = Math.max(0, total - termDone);
          const mc4Pct = total > 0 ? ((mc4Done / total) * 100).toFixed(1) : '0.0';
          const termPct = total > 0 ? ((termDone / total) * 100).toFixed(1) : '0.0';
          const isMc4Mode = mc4SelectionMode === 'mc4';
          const isTermMode = mc4SelectionMode === 'termination';
          const canTerminate = mc4Done > 0;
          const mc4DoneLabelCls = isMc4Mode ? 'text-xs font-bold text-blue-400' : 'text-xs font-bold text-slate-500';
          const mc4DoneValueCls = isMc4Mode ? 'text-xs font-bold text-blue-400 tabular-nums' : 'text-xs font-bold text-slate-500 tabular-nums';
          const termDoneLabelCls = isTermMode ? COUNTER_DONE_LABEL : 'text-xs font-bold text-slate-500';
          const termDoneValueCls = isTermMode ? COUNTER_DONE_VALUE : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';
          return (
            <div className="min-w-[800px] border-2 border-slate-700 bg-slate-900/40 py-3 px-3">
              <div className="flex flex-col gap-2">
                {/* MC4 Install row with checkbox */}
                <div
                  className="grid grid-cols-[24px_170px_repeat(3,max-content)] items-center gap-x-3 gap-y-2 cursor-pointer"
                  onClick={() => {
                    if (!isMc4Mode) setMc4SelectionMode('mc4');
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isMc4Mode) setMc4SelectionMode('mc4');
                    }}
                    className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                      isMc4Mode 
                        ? 'border-blue-500 bg-blue-500 text-white' 
                        : 'border-slate-500 bg-slate-800 hover:border-blue-400'
                    }`}
                    title="Select MC4 Installation mode"
                  >
                    {isMc4Mode && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <div className={`text-sm font-bold ${isMc4Mode ? 'text-blue-300' : 'text-blue-400/60'}`}>MC4 Install:</div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{total}</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={mc4DoneLabelCls}>Done</span>
                      <span className={mc4DoneValueCls}>{mc4Done} ({mc4Pct}%)</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Remaining</span>
                      <span className={COUNTER_VALUE}>{mc4Rem}</span>
                    </div>
                  </div>
                </div>

                {/* Cable Termination row with checkbox */}
                <div
                  className="grid grid-cols-[24px_170px_repeat(3,max-content)] items-center gap-x-3 gap-y-2 cursor-pointer"
                  onClick={() => {
                    if (!canTerminate) {
                      if (!isMc4Mode) setMc4SelectionMode('mc4');
                      return;
                    }
                    if (!isTermMode) setMc4SelectionMode('termination');
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canTerminate) {
                        // No MC4 (blue) ends yet; termination cannot be selected.
                        if (mc4SelectionMode !== 'mc4') setMc4SelectionMode('mc4');
                        return;
                      }
                      if (!isTermMode) setMc4SelectionMode('termination');
                    }}
                    disabled={!canTerminate}
                    className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                      (!canTerminate)
                        ? 'border-slate-600 bg-slate-900/40 opacity-60 cursor-not-allowed'
                        : isTermMode 
                        ? 'border-emerald-500 bg-emerald-500 text-white' 
                        : 'border-slate-500 bg-slate-800 hover:border-emerald-400'
                    }`}
                    title={canTerminate ? 'Select Cable Termination mode' : 'Select MC4 Install first (no blue ends yet)'}
                  >
                    {isTermMode && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <div className={`text-sm font-bold ${isTermMode ? 'text-emerald-300' : 'text-emerald-400/60'}`}>Cable Termination:</div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{total}</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={termDoneLabelCls}>Done</span>
                      <span className={termDoneValueCls}>{termDone} ({termPct}%)</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Remaining</span>
                      <span className={COUNTER_VALUE}>{termRem}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    ) : null) ||
    (isMVT ? (
      <div className="flex min-w-0 items-stretch gap-3 overflow-x-auto pb-1 justify-self-start">
        {(() => {
          const total = Number(mvtCsvTotals?.total) || 0;
          const completed = Math.max(
            0,
            Object.values(mvtTerminationByStation || {}).reduce((s, v) => s + Math.max(0, Math.min(3, Number(v) || 0)), 0)
          );
          const remaining = Math.max(0, total - completed);
          return (
            <>
              <div className="min-w-[180px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                  <span className="text-xs font-bold text-slate-200">MV termination TOTAL</span>
                  <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{total}</span>
                </div>
              </div>
              <div className="min-w-[220px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                  <span className="text-xs font-bold text-emerald-400">MV termination COMPLETED</span>
                  <span className="text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap">{completed}</span>
                </div>
              </div>
              <div className="min-w-[180px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                  <span className="text-xs font-bold text-slate-200">MV termination REMAINING</span>
                  <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{remaining}</span>
                </div>
              </div>
            </>
          );
        })()}
      </div>
    ) : null) ||
    (isLVTT ? (
      <div className="flex min-w-0 items-stretch gap-3 overflow-x-auto pb-1 justify-self-start">
        {(() => {
          const total = Number(lvttCsvTotals?.total) || 0;
          const passed = Number(lvttCsvTotals?.passed) || 0;
          const failed = Number(lvttCsvTotals?.failed) || 0;
          const mode = String(lvttSubMode || 'termination');
          const isTermMode = mode === 'termination';
          const isTestMode = mode === 'testing';

          const termDone = Math.max(
            0,
            Object.values(lvttTerminationByInv || {}).reduce((s, v) => {
              const n = Math.max(0, Math.min(3, Number(v) || 0));
              return s + n;
            }, 0)
          );
          const termRem = Math.max(0, total - termDone);
          const termPct = total > 0 ? ((termDone / total) * 100).toFixed(1) : '0.0';

          const passPct = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';

          const termDoneLabelCls = isTermMode ? COUNTER_DONE_LABEL : 'text-xs font-bold text-slate-500';
          const termDoneValueCls = isTermMode ? COUNTER_DONE_VALUE : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';
          const passLabelCls = isTestMode ? 'text-xs font-bold text-emerald-400' : 'text-xs font-bold text-slate-500';
          const passValueCls = isTestMode ? 'text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap' : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';
          const failLabelCls = isTestMode ? 'text-xs font-bold text-red-400' : 'text-xs font-bold text-slate-500';
          const failValueCls = isTestMode ? 'text-xs font-bold text-red-400 tabular-nums whitespace-nowrap' : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';

          return (
            <div className="min-w-[820px] border-2 border-slate-700 bg-slate-900/40 py-3 px-3">
              <div className="flex flex-col gap-2">
                {/* LV TERMINATION row */}
                <div
                  className="grid grid-cols-[24px_170px_repeat(3,max-content)] items-center gap-x-3 gap-y-2 cursor-pointer"
                  onClick={() => {
                    if (!isTermMode) {
                      setLvttSubMode('termination');
                      setLvttPopup(null);
                    }
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTermMode) {
                        setLvttSubMode('termination');
                        setLvttPopup(null);
                      }
                    }}
                    className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                      isTermMode
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-slate-500 bg-slate-800 hover:border-emerald-400'
                    }`}
                    title="Select LV_TERMINATION"
                    aria-pressed={isTermMode}
                  >
                    {isTermMode && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <div className={`text-sm font-bold ${isTermMode ? 'text-emerald-300' : 'text-emerald-400/60'}`}>LV_TERMINATION:</div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{total}</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={termDoneLabelCls}>Done</span>
                      <span className={termDoneValueCls}>{termDone} ({termPct}%)</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Remaining</span>
                      <span className={COUNTER_VALUE}>{termRem}</span>
                    </div>
                  </div>
                </div>

                {/* LV TESTING row */}
                <div
                  className="grid grid-cols-[24px_170px_repeat(3,max-content)] items-center gap-x-3 gap-y-2 cursor-pointer"
                  onClick={() => {
                    if (!isTestMode) {
                      setLvttSubMode('testing');
                      setLvttPopup(null);
                    }
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) {
                        setLvttSubMode('testing');
                        setLvttPopup(null);
                      }
                    }}
                    className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${
                      isTestMode
                        ? 'border-sky-500 bg-sky-500 text-white'
                        : 'border-slate-500 bg-slate-800 hover:border-sky-400'
                    }`}
                    title="Select LV_TESTING"
                    aria-pressed={isTestMode}
                  >
                    {isTestMode && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <div className={`text-sm font-bold ${isTestMode ? 'text-sky-300' : 'text-sky-400/60'}`}>LV_TESTING:</div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{total}</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={passLabelCls}>PASSED</span>
                      <span className={passValueCls}>{passed} ({passPct}%)</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={failLabelCls}>FAILED</span>
                      <span className={failValueCls}>{failed}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    ) : isDCCT ? (
      <div className="flex min-w-0 items-stretch gap-3 overflow-x-auto pb-1 justify-self-start">
        {(() => {
          // DCCT Counters: Total, Passed, Failed, Not Tested
          const csvTestData = dcctTestData || {};
          const csvIds = new Set(Object.keys(csvTestData));
          const mapIds = dcctMapIds || new Set();
          
          // Calculate counts
          const csvTotal = csvIds.size;
          let passedCount = 0;
          let failedCount = 0;
          
          csvIds.forEach((id) => {
            const result = csvTestData[id];
            if (result === 'passed') passedCount++;
            else if (result === 'failed') failedCount++;
          });
          
          // Not tested: IDs in map but not in CSV, plus IDs in CSV but not in map
          let notTestedCount = 0;
          mapIds.forEach((id) => {
            if (!csvIds.has(id)) notTestedCount++;
          });
          // Spec: Not Tested should be ONLY IDs that are on the map (string_text) but missing in CSV.
          
          const activeFilter = dcctFilter;
          
          // Styling for clickable filter links
          const filterLinkBase = 'cursor-pointer underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity';
          const filterActiveRing = 'ring-2 ring-offset-1 ring-offset-slate-900';
          
          return (
            <div className="flex items-center gap-3">
              {/* Total Counter */}
              <div className="min-w-[120px] border-2 border-slate-700 bg-slate-800 py-3 px-3">
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                  <span className="text-xs font-bold text-slate-200">Total</span>
                  <span className="text-xs font-bold text-slate-200 tabular-nums">{csvTotal}</span>
                </div>
              </div>
              
              {/* Passed Counter - Clickable */}
              <div 
                className={`min-w-[120px] border-2 py-3 px-3 transition-all ${
                  activeFilter === 'passed' 
                    ? 'border-emerald-500 bg-emerald-950/40 ' + filterActiveRing + ' ring-emerald-500' 
                    : 'border-slate-700 bg-slate-800 hover:border-emerald-600'
                }`}
              >
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                  <span 
                    className={`text-xs font-bold text-emerald-400 ${filterLinkBase}`}
                    onClick={() => setDcctFilter(activeFilter === 'passed' ? null : 'passed')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setDcctFilter(activeFilter === 'passed' ? null : 'passed')}
                  >
                    Passed
                  </span>
                  <span className="text-xs font-bold text-emerald-400 tabular-nums">{passedCount}</span>
                </div>
              </div>
              
              {/* Failed Counter - Clickable */}
              <div 
                className={`min-w-[120px] border-2 py-3 px-3 transition-all ${
                  activeFilter === 'failed' 
                    ? 'border-red-500 bg-red-950/40 ' + filterActiveRing + ' ring-red-500' 
                    : 'border-slate-700 bg-slate-800 hover:border-red-600'
                }`}
              >
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                  <span 
                    className={`text-xs font-bold text-red-400 ${filterLinkBase}`}
                    onClick={() => setDcctFilter(activeFilter === 'failed' ? null : 'failed')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setDcctFilter(activeFilter === 'failed' ? null : 'failed')}
                  >
                    Failed
                  </span>
                  <span className="text-xs font-bold text-red-400 tabular-nums">{failedCount}</span>
                </div>
              </div>
              
              {/* Not Tested Counter - Clickable */}
              <div 
                className={`min-w-[140px] border-2 py-3 px-3 transition-all ${
                  activeFilter === 'not_tested' 
                    ? 'border-slate-400 bg-slate-700/40 ' + filterActiveRing + ' ring-slate-400' 
                    : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                }`}
              >
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                  <span 
                    className={`text-xs font-bold text-slate-400 ${filterLinkBase}`}
                    onClick={() => setDcctFilter(activeFilter === 'not_tested' ? null : 'not_tested')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setDcctFilter(activeFilter === 'not_tested' ? null : 'not_tested')}
                  >
                    Not Tested
                  </span>
                  <span className="text-xs font-bold text-slate-400 tabular-nums">{notTestedCount}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    ) : null);

  return (
    <div className="app">
      {_customSidebar}
      {/* Header with Buttons and Counters */}
      <div className="sticky top-0 left-0 z-[1100] w-full min-h-[92px] border-b-2 border-slate-700 bg-slate-900 px-4 py-0 sm:px-6 relative flex items-center">
        <div className="w-full">
        <div className="grid grid-cols-[1fr_auto] items-center gap-1">
          {/* Counters (left) */}
          {showCounters ? (
            effectiveCustomCounters ? (
              effectiveCustomCounters
            ) : (
              <div className="flex min-w-0 items-stretch gap-3 overflow-x-auto pb-1 justify-self-start">
                {useSimpleCounters ? (
                  <>
                    <div className="min-w-[180px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                      <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                        <span className="text-xs font-bold text-slate-200">Total</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{overallTotal.toFixed(0)} m</span>
                      </div>
                    </div>

                    <div className="min-w-[220px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                      <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                        <span className="text-xs font-bold text-emerald-400">Completed</span>
                        <span className="text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap">
                          {completedTotal.toFixed(0)} m, {completedPct.toFixed(2)}%
                        </span>
                      </div>
                    </div>

                    <div className="min-w-[180px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                      <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                        <span className="text-xs font-bold text-slate-200">Remaining</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{remainingTotal.toFixed(0)} m</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="min-w-[220px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                      <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                        <span className="text-xs font-bold text-slate-200">+DC Cable</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{totalPlus.toFixed(0)} m</span>

                        <span className="text-xs font-bold text-slate-200">-DC Cable</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{totalMinus.toFixed(0)} m</span>

                        <span className="text-xs font-bold text-slate-200">Total</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{(totalPlus + totalMinus).toFixed(0)} m</span>
                      </div>
                    </div>

                    <div className="min-w-[260px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                      <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                        <span className="text-xs font-bold text-slate-200">+DC Cable</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{completedPlus.toFixed(0)} m</span>

                        <span className="text-xs font-bold text-slate-200">-DC Cable</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{completedMinus.toFixed(0)} m</span>

                        <span className="text-xs font-bold text-emerald-400">Completed ({completedPct.toFixed(2)}%)</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{completedTotal.toFixed(0)} m</span>
                      </div>
                    </div>

                    <div className="min-w-[180px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                      <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                        <span className="text-xs font-bold text-slate-200">+DC Cable</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{remainingPlus.toFixed(0)} m</span>

                        <span className="text-xs font-bold text-slate-200">-DC Cable</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{remainingMinus.toFixed(0)} m</span>

                        <span className="text-xs font-bold text-slate-200">Remaining</span>
                        <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{remainingTotal.toFixed(0)} m</span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          ) : (
            <div />
          )}

          {/* Controls (right) */}
          <div className="flex flex-shrink-0 items-center gap-2 justify-self-end">
            {noteMode && selectedNotes.size > 0 && (
              <button onClick={deleteSelectedNotes} className={BTN_DANGER} title="Delete Selected" aria-label="Delete Selected">
                <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  <line x1="10" y1="11" x2="10" y2="17"/>
                  <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
              </button>
            )}

            <div className="mx-1 h-10 w-[2px] bg-slate-600" />

            <button
              onClick={() => {
                globalUndo();
              }}
              disabled={!globalCanUndo}
              className={BTN_SMALL_NEUTRAL}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <svg className={ICON_SMALL} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 14l-4-4 4-4" />
                <path d="M5 10h9a6 6 0 010 12h-1" />
              </svg>
            </button>

            <button
              onClick={() => {
                globalRedo();
              }}
              disabled={!globalCanRedo}
              className={BTN_SMALL_NEUTRAL}
              title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
              aria-label="Redo"
            >
              <svg className={ICON_SMALL} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 14l4-4-4-4" />
                <path d="M19 10H10a6 6 0 000 12h1" />
              </svg>
            </button>

            {!isDCCT && (
              <>
                <button
                  onClick={() => setModalOpen(true)}
                  disabled={
                    noteMode ||
                    (isMC4 && !mc4SelectionMode) ||
                    (isLVTT
                      ? (String(lvttSubMode || 'termination') === 'testing' || lvttCompletedForSubmit === 0)
                      : (isMVT ? mvtCompletedForSubmit === 0 : workSelectionCount === 0))
                  }
                  className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                  title={isMC4 && !mc4SelectionMode ? "Select MC4 Install or Cable Termination first" : "Submit Work"}
                  aria-label="Submit Work"
                >
                  Submit
                </button>

                <button
                  onClick={() => setHistoryOpen(true)}
                  disabled={(isLVTT && String(lvttSubMode || 'termination') === 'testing') || (dailyLog.length === 0 && notes.length === 0)}
                  className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                  title={isLVTT && String(lvttSubMode || 'termination') === 'testing' ? 'History disabled in LV_TESTING' : 'History'}
                  aria-label="History"
                >
                  History
                </button>

                <button
                  onClick={() =>
                    exportToExcel(dailyLog, {
                      moduleKey: isMC4
                        ? (mc4SelectionMode === 'termination' ? 'MC4_TERM' : 'MC4_INST')
                        : (isMVT
                          ? 'MVT_TERM'
                          : (isLVTT && String(lvttSubMode || 'termination') === 'termination')
                            ? 'LVTT_TERM'
                            : (activeMode?.key || '')),
                      moduleLabel: isMC4
                        ? (mc4SelectionMode === 'termination' ? 'Cable Termination' : 'MC4 Installation')
                        : (isMVT
                          ? 'Cable Termination'
                          : (isLVTT && String(lvttSubMode || 'termination') === 'termination')
                            ? 'Cable Termination'
                            : moduleName),
                      unit: isMC4
                        ? 'ends'
                        : ((isMVT || (isLVTT && String(lvttSubMode || 'termination') === 'termination')) ? 'cables' : 'm'),
                      chartSheetName: (isMVT || (isLVTT && String(lvttSubMode || 'termination') === 'termination'))
                        ? 'Cable Termination'
                        : undefined,
                      chartTitle: (isMVT || (isLVTT && String(lvttSubMode || 'termination') === 'termination'))
                        ? 'Cable Termination'
                        : undefined,
                    })
                  }
                  disabled={(isLVTT && String(lvttSubMode || 'termination') === 'testing') || dailyLog.length === 0}
                  className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                  title={isLVTT && String(lvttSubMode || 'termination') === 'testing' ? 'Export disabled in LV_TESTING' : 'Export Excel'}
                  aria-label="Export Excel"
                >
                  Export
                </button>
              </>
            )}
          </div>
        </div>

        {/* MV+FIBER: segments panel (right side, under header level) */}
        {isMVF && mvfSegments.length > 0 && (
          <div className="fixed left-3 sm:left-5 top-[190px] z-[1190] w-[230px] border-2 border-slate-300 bg-white text-slate-900 shadow-[0_10px_26px_rgba(0,0,0,0.35)]">
            <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-2">
              <span className="inline-block h-2 w-2 bg-pink-500" aria-hidden="true" />
              <div className="text-[10px] font-extrabold uppercase tracking-wide">mv cable length</div>
            </div>
            <div className="max-h-[260px] overflow-y-auto p-2">
              {mvfSegments.map((s) => {
                const active = mvfActiveSegmentKeys.has(s.key);
                const done = mvfDoneSegmentKeys.has(s.key);
                const current = String(mvfCurrentSegmentKey || '') === String(s.key || '');
                const segColor = mvfColorOfSegment(s.key);
                return (
                  <div
                    key={s.key}
                    className={`mb-2 flex w-full items-center justify-between border px-2 py-2 text-left ${
                      done
                        ? 'border-emerald-600 bg-emerald-100'
                        : active
                          ? 'border-slate-300 bg-slate-50'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                    } ${current ? 'ring-2 ring-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.22)] animate-pulse' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const ck = String(s.key || '');
                        mvfCurrentSegmentKeyRef.current = ck; // immediate for box handler
                        setMvfCurrentSegmentKey(ck);
                        setMvfActiveSegmentKeys((prev) => {
                          // If this segment route was already submitted (committed), don't allow recounting.
                          try {
                            const committed = mvfCommittedTrenchPartsRef.current || [];
                            const sk = String(s.key || '');
                            if (sk && committed.some((p) => p?.source === 'segment' && String(p?.segmentKey || '') === sk)) return prev;
                          } catch (_e) {
                            void _e;
                          }
                          const next = new Set(prev);
                          if (next.has(s.key)) next.delete(s.key);
                          else next.add(s.key);
                          return next;
                        });
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 pr-2 text-left"
                      title={done ? `${s.label} (DONE)` : active ? `${s.label} (selected)` : `${s.label} (select)`}
                      aria-pressed={active}
                    >
                      <span
                        className={`inline-block h-3 w-3 border ${current ? 'animate-pulse' : ''}`}
                        style={{ background: segColor, borderColor: segColor }}
                        aria-hidden="true"
                      />
                      <span className={`min-w-0 truncate text-[13px] font-semibold ${active ? 'text-emerald-900' : 'text-slate-800'}`}>
                        {s.label}
                      </span>
                    </button>

                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span className={`text-[13px] font-bold tabular-nums ${active ? 'text-emerald-900' : 'text-slate-600'}`}>
                        {mvfCircuitsMultiplier > 1
                          ? `${Math.round(Number(s.length || 0) / mvfCircuitsMultiplier)}*${mvfCircuitsMultiplier}`
                          : `${Math.round(Number(s.length || 0))}`}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const key = String(s.key || '');
                          if (!key) return;
                          // Make sure the segment is visible/active when toggling Done.
                          mvfCurrentSegmentKeyRef.current = key;
                          setMvfCurrentSegmentKey(key);
                          setMvfActiveSegmentKeys((prev) => {
                            const next = new Set(prev);
                            next.add(key);
                            return next;
                          });
                          setMvfDoneSegmentKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                          // When marking done: lock current selected parts for this segment by moving them to committed.
                          if (!done) {
                            setMvfCommittedTrenchParts((prev) => {
                              const base = prev || [];
                              const add = (mvfSelectedTrenchPartsRef.current || []).filter((p) => String(p?.segmentKey || '') === key);
                              if (!add.length) return base;
                              const seen = new Set(base.map((p) => String(p?.id || '')));
                              const out = [...base];
                              add.forEach((p) => {
                                const id = String(p?.id || '');
                                if (!id || seen.has(id)) return;
                                seen.add(id);
                                out.push(p);
                              });
                              return out;
                            });
                            setMvfSelectedTrenchParts((prev) => (prev || []).filter((p) => String(p?.segmentKey || '') !== key));
                          }
                        }}
                        className={`inline-flex h-6 w-6 items-center justify-center border text-[12px] font-black leading-none ${
                          done ? 'border-emerald-600 bg-white text-emerald-600' : 'border-slate-300 bg-white text-transparent hover:bg-slate-100'
                        }`}
                        title="Done"
                        aria-pressed={done}
                        aria-label={done ? `Undone ${s.label}` : `Done ${s.label}`}
                      >
                        {done ? '✓' : ''}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend / DWG / Notes (right aligned, vertically centered on screen) */}
        <div className="fixed right-3 sm:right-5 top-[40%] -translate-y-1/2 z-[1090] flex flex-col items-end gap-2">
          <div className="border-2 border-slate-700 bg-slate-900 px-4 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.55)]">
            <div className="text-base font-black uppercase tracking-wide text-white">Legend</div>
            <div className="mt-2 border-2 border-slate-700 bg-slate-800 px-3 py-2">
              {isMC4 ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 border-2 border-white bg-white" aria-hidden="true" />
                    <span className="text-[11px] font-bold uppercase tracking-wide text-white">Uncompleted</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full border-2 border-blue-700 bg-blue-500" aria-hidden="true" />
                    <span className="text-[11px] font-bold uppercase tracking-wide text-blue-400">Completed MC4</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full border-2 border-emerald-700 bg-emerald-500" aria-hidden="true" />
                    <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">Completed Termination</span>
                  </div>
                </>
              ) : isDCCT ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 border-2 border-emerald-900 bg-emerald-500" aria-hidden="true" />
                    <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">PASSED</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-3 w-3 border-2 border-red-900 bg-red-500" aria-hidden="true" />
                    <span className="text-[11px] font-bold uppercase tracking-wide text-red-300">FAILED</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-3 w-3 border-2 border-slate-600 bg-slate-500" aria-hidden="true" />
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">NOT TESTED</span>
                  </div>
                </>
              ) : (
                <>
                  {isMVT ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 border-2 border-white bg-white" aria-hidden="true" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-white">Unterminated</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="h-3 w-3 border-2 border-emerald-300 bg-emerald-500" aria-hidden="true" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">Terminated</span>
                      </div>
                    </>
                  ) : isLVTT ? (
                    <>
                      {String(lvttSubMode || 'termination') === 'termination' ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 border-2 border-red-300 bg-red-500" aria-hidden="true" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-red-300">0/3 – 2/3</span>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="h-3 w-3 border-2 border-emerald-300 bg-emerald-500" aria-hidden="true" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">3/3</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 border-2 border-emerald-300 bg-emerald-500" aria-hidden="true" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">PASSED</span>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="h-3 w-3 border-2 border-red-300 bg-red-500" aria-hidden="true" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-red-300">FAILED</span>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 border-2 border-white bg-white" aria-hidden="true" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-white">Uncompleted</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="h-3 w-3 border-2 border-emerald-300 bg-emerald-500" aria-hidden="true" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">Completed</span>
                      </div>
                    </>
                  )}
                  {isMVT ? (
                    <>
                      <div className="mt-3 border-t border-slate-700/70" />
                      <div className="mt-2 flex items-center gap-2">
                        <span className="h-3 w-3 border-2 border-emerald-900 bg-emerald-500" aria-hidden="true" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">TESTED – Passed</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="h-3 w-3 border-2 border-red-900 bg-red-500" aria-hidden="true" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-red-300">TESTED – Failed</span>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* MVT popups are rendered near click position (not in the fixed right panel). */}

          <a
             href={dwgUrl || activeMode.linkPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-6 items-center justify-center border-2 border-slate-700 bg-slate-900 px-2 text-[10px] font-extrabold uppercase tracking-wide text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            title="Open Original DWG"
          >
            Original DWG
          </a>
          {isMC4 && mc4Toast ? (
            <div className="mt-1 max-w-[220px] border border-amber-500/70 bg-amber-950/30 px-2 py-1 text-[10px] font-bold text-amber-200">
              {mc4Toast}
            </div>
          ) : null}

          {stringTextToggleEnabled && (
            <button
              type="button"
              onClick={() => setStringTextUserOn((v) => !v)}
              className="inline-flex h-6 items-center justify-center border-2 border-slate-700 bg-slate-900 px-2 text-[10px] font-extrabold uppercase tracking-wide text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              title="Toggle string text"
            >
              TEXT {stringTextUserOn ? 'ON' : 'OFF'}
            </button>
          )}
        </div>

        {/* NOTE (between header and legend, right-aligned with legend/DWG) */}
        <div className="fixed right-3 sm:right-5 top-[20%] z-[1090] note-btn-wrap">
          <button
            type="button"
            onClick={() => {
              setNoteMode((prev) => {
                const next = !prev;
                if (!next) setSelectedNotes(new Set());
                return next;
              });
            }}
            aria-pressed={noteMode}
            aria-label={noteMode ? 'Exit Notes' : 'Notes'}
            title={noteMode ? 'Exit Notes' : 'Notes'}
            className="relative inline-flex h-6 items-center justify-center border-2 border-slate-700 bg-slate-900 px-2 text-[10px] font-extrabold uppercase tracking-wide text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
          >
            Note
            {/* Red corner indicator (always visible; pulses only when note mode is active AND hovered) */}
            <svg
              className={`note-dot absolute -right-1 -top-1 ${noteMode ? 'h-3 w-3 note-dot--active' : 'h-2 w-2'}`}
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <circle cx="6" cy="6" r="4" fill="#e23a3a" stroke="#7a0f0f" strokeWidth="2" />
            </svg>
          </button>
        </div>
        </div>
      </div>

      {/* Title under header */}
      <div className="w-full border-0 bg-[#0b1220] py-2 text-center text-base font-black uppercase tracking-[0.22em] text-slate-200">
        {moduleName}
      </div>

      <div className="map-wrapper">
        <div id="map" />
      </div>

      {/* MVT: click-position popups */}
      {isMVT && mvtTestPopup ? (
        <div
          style={{
            position: 'fixed',
            left: Math.min(window.innerWidth - 280, Math.max(8, (mvtTestPopup.x || 0) + 10)),
            top: Math.min(window.innerHeight - 220, Math.max(8, (mvtTestPopup.y || 0) + 10)),
            zIndex: 1400,
          }}
          className="w-[260px] border-2 border-slate-700 bg-slate-900 px-3 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-wide text-white">Test Details</div>
              <div className="mt-1 text-sm font-extrabold text-slate-100 truncate">
                {mvtTestPopup.stationLabel || mvtTestPopup.fromKey || 'Substation'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMvtTestPopup(null)}
              className="inline-flex h-6 w-6 items-center justify-center border-2 border-slate-700 bg-slate-800 text-xs font-black text-white hover:bg-slate-700"
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {(['L1', 'L2', 'L3']).map((ph) => {
              const obj = mvtTestPopup?.phases?.[ph] || { value: '', status: 'N/A' };
              const statusRaw = String(obj?.status || 'N/A').trim();
              const statusU = statusRaw.toUpperCase();
              const val = String(obj?.value || '').trim();
              const pass = statusU === 'PASS';
              const status = pass ? 'PASS' : (statusRaw || 'N/A');
              return (
                <div key={ph} className="flex items-center justify-between border border-slate-700 bg-slate-800 px-2 py-1">
                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-200">{ph}</span>
                  <span className="ml-2 flex items-center gap-2">
                    {val ? (
                      <span className={`text-[11px] font-extrabold tabular-nums ${pass ? 'text-emerald-200' : 'text-red-200'}`}>{val}</span>
                    ) : null}
                    <span className={`text-[11px] font-black uppercase tracking-wide ${pass ? 'text-emerald-300' : 'text-red-300'}`}>
                      {status}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Debug removed (requested) */}
        </div>
      ) : null}

      {/* LVTT: click-position popup (termination or testing) */}
      {isLVTT && lvttPopup ? (
        <div
          style={{
            position: 'fixed',
            left: Math.min(window.innerWidth - 300, Math.max(8, (lvttPopup.x || 0) + 10)),
            top: Math.min(window.innerHeight - 320, Math.max(8, (lvttPopup.y || 0) + 10)),
            zIndex: 1400,
          }}
          className="w-[280px] border-2 border-slate-700 bg-slate-900 px-3 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-wide text-white">
                {lvttPopup.mode === 'termination' ? 'LV Termination' : 'LV Testing'}
              </div>
              <div className="mt-1 text-sm font-extrabold text-slate-100 truncate">
                {lvttPopup.invId || 'Inverter'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLvttPopup(null)}
              className="inline-flex h-6 w-6 items-center justify-center border-2 border-slate-700 bg-slate-800 text-xs font-black text-white hover:bg-slate-700"
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {lvttPopup.mode === 'termination' ? (
            (() => {
              const invNorm = String(lvttPopup.invIdNorm || '');
              const stored = Math.max(0, Math.min(3, Number(lvttTerminationByInv?.[invNorm] ?? 0)));
              const draft = Math.max(0, Math.min(3, Number(lvttPopup.draft ?? stored)));
              const locked = stored === 3;
              const setDraft = (v) => setLvttPopup((p) => (p ? { ...p, draft: Math.max(0, Math.min(3, v)) } : p));

              const applyDraft = (valueToApply) => {
                if (!invNorm) return;
                const nextVal = Math.max(0, Math.min(3, Number(valueToApply ?? 0)));
                const prevVal = Math.max(0, Math.min(3, Number(lvttTerminationByInvRef.current?.[invNorm] ?? 0)));
                if (nextVal === prevVal) return;
                lvttTermPushHistory(invNorm, prevVal, nextVal);
                setLvttTerminationByInv((prev) => {
                  const base = prev && typeof prev === 'object' ? { ...prev } : {};
                  base[invNorm] = nextVal;
                  return base;
                });
              };

              const orderedInvs = (() => {
                const meta = lvttInvMetaByNormRef.current || {};
                return Object.keys(meta)
                  .map((k) => ({
                    norm: k,
                    display: String(meta[k]?.displayId || meta[k]?.raw || k || '').trim() || String(k),
                  }))
                  .filter((x) => x.norm)
                  .sort((a, b) => a.display.localeCompare(b.display, undefined, { numeric: true, sensitivity: 'base' }));
              })();

              const openNextInv = () => {
                const list = orderedInvs;
                if (!list.length || !invNorm) return;

                const snapshot = {
                  ...(lvttTerminationByInvRef.current || {}),
                  [invNorm]: draft,
                };

                const idx = list.findIndex((x) => x.norm === invNorm);
                const start = idx >= 0 ? idx : 0;

                let next = null;
                for (let step = 1; step <= list.length; step++) {
                  const cand = list[(start + step) % list.length];
                  const vv = Math.max(0, Math.min(3, Number(snapshot?.[cand.norm] ?? 0)));
                  if (vv === 3) continue; // skip locked
                  next = { norm: cand.norm, display: cand.display, draft: vv };
                  break;
                }

                if (!next) {
                  setLvttPopup(null);
                  return;
                }

                setLvttPopup((p) => (p ? {
                  ...p,
                  mode: 'termination',
                  invId: next.display,
                  invIdNorm: next.norm,
                  draft: next.draft,
                } : p));
              };

              return (
                <div className="mt-3">
                  <div className="border border-slate-700 bg-slate-800 px-2 py-2">
                    {locked ? (
                      <div className="flex items-center justify-end">
                        <span className="text-[11px] font-black uppercase tracking-wide text-emerald-300">LOCKED</span>
                      </div>
                    ) : null}
                    <div className="mt-0 flex items-center justify-end gap-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={3}
                          step={1}
                          value={draft}
                          disabled={locked}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            try {
                              e.preventDefault();
                              e.stopPropagation();
                            } catch (_e) { void _e; }
                            if (locked) return;
                            applyDraft(draft);
                            setLvttPopup(null);
                          }}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '') return;
                            const n = Math.max(0, Math.min(3, parseInt(v, 10)));
                            if (Number.isFinite(n)) setDraft(n);
                          }}
                          className={`w-14 h-8 border-2 bg-slate-900 px-2 text-center text-[13px] font-black tabular-nums outline-none ${
                            locked
                              ? 'border-slate-700 text-slate-500 cursor-not-allowed'
                              : (draft === 3 ? 'border-emerald-700 text-emerald-200' : 'border-red-700 text-red-200')
                          }`}
                          title="Enter 0..3"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        if (locked) return;
                        applyDraft(draft);
                        openNextInv();
                      }}
                      className={`flex-1 h-8 border-2 text-[11px] font-extrabold uppercase tracking-wide ${
                        locked
                          ? 'border-slate-700 bg-slate-900/40 text-slate-500 cursor-not-allowed'
                          : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                      }`}
                      title={locked ? 'Locked at 3/3' : 'Apply and open next inverter'}
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        if (!invNorm) return;
                        applyDraft(draft);
                        setLvttPopup(null);
                      }}
                      className={`flex-1 h-8 border-2 text-[11px] font-extrabold uppercase tracking-wide ${
                        locked
                          ? 'border-slate-700 bg-slate-900/40 text-slate-500 cursor-not-allowed'
                          : 'border-emerald-700 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-950/40'
                      }`}
                      title="Apply"
                    >
                      OK
                    </button>
                  </div>
                </div>
              );
            })()
          ) : (
            (lvttPopup.testData ? (
              <div className="mt-3 space-y-2">
                {(['L1', 'L2', 'L3']).map((ph) => {
                  const obj = lvttPopup.testData?.[ph] || { value: '', status: 'N/A' };
                  const statusRaw = String(obj?.status || 'N/A').trim();
                  const statusU = statusRaw.toUpperCase();
                  const val = String(obj?.value || '').trim();
                  const pass = statusU === 'PASS';
                  const status = pass ? 'PASS' : (statusRaw || 'N/A');
                  return (
                    <div key={ph} className="flex items-center justify-between border border-slate-700 bg-slate-800 px-2 py-1">
                      <span className="text-[11px] font-black uppercase tracking-wide text-slate-200">{ph}</span>
                      <span className="ml-2 flex items-center gap-2">
                        {val ? (
                          <span className={`text-[11px] font-extrabold tabular-nums ${pass ? 'text-emerald-200' : 'text-red-200'}`}>{val}</span>
                        ) : null}
                        <span className={`text-[11px] font-black uppercase tracking-wide ${pass ? 'text-emerald-300' : 'text-red-300'}`}>{status}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 border border-slate-700 bg-slate-800 px-2 py-2 text-center">
                <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">NOT TESTED</span>
              </div>
            ))
          )}
        </div>
      ) : null}

      {isMVT && mvtTermPopup ? (
        <div
          style={{
            position: 'fixed',
            left: Math.min(window.innerWidth - 300, Math.max(8, (mvtTermPopup.x || 0) + 10)),
            top: Math.min(window.innerHeight - 220, Math.max(8, (mvtTermPopup.y || 0) + 10)),
            zIndex: 1400,
          }}
          className="w-[280px] border-2 border-slate-700 bg-slate-900 px-3 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-wide text-white">Termination</div>
              <div className="mt-1 text-sm font-extrabold text-slate-100 truncate">{mvtTermPopup.stationLabel}</div>
            </div>
            <button
              type="button"
              onClick={() => setMvtTermPopup(null)}
              className="inline-flex h-6 w-6 items-center justify-center border-2 border-slate-700 bg-slate-800 text-xs font-black text-white hover:bg-slate-700"
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {(() => {
            const stationNorm = String(mvtTermPopup.stationNorm || '');
            const stored = Math.max(0, Math.min(3, Number(mvtTerminationByStation?.[stationNorm] ?? 0)));
            const draft = Math.max(0, Math.min(3, Number(mvtTermPopup.draft ?? stored)));
            const locked = stored === 3;
            const setDraft = (v) => setMvtTermPopup((p) => (p ? { ...p, draft: Math.max(0, Math.min(3, v)) } : p));

            const applyDraft = (valueToApply) => {
              if (!stationNorm) return;
              const nextVal = Math.max(0, Math.min(3, Number(valueToApply ?? 0)));
              const prevVal = Math.max(0, Math.min(3, Number(mvtTerminationByStationRef.current?.[stationNorm] ?? 0)));
              if (nextVal === prevVal) return;
              mvtTermPushHistory(stationNorm, prevVal, nextVal);
              setMvtTerminationByStation((prev) => {
                const base = prev && typeof prev === 'object' ? { ...prev } : {};
                base[stationNorm] = nextVal;
                return base;
              });
            };

            const orderedStations = (() => {
              const pts = stringTextPointsRef.current || [];
              const seen = new Set();
              const arr = [];
              for (const pt of pts) {
                const raw = String(pt?.text || '').trim();
                const norm = normalizeId(raw);
                if (!(norm && /^ss\d{1,2}$/i.test(norm))) continue;
                if (seen.has(norm)) continue;
                seen.add(norm);
                arr.push({ norm, label: raw || norm });
              }
              const numOf = (n) => {
                const m = String(n || '').match(/\d+/);
                return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
              };
              arr.sort((a, b) => {
                const na = numOf(a.norm);
                const nb = numOf(b.norm);
                if (na !== nb) return na - nb;
                return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
              });
              return arr;
            })();

            const openNextStation = () => {
              const list = orderedStations;
              if (!list.length || !stationNorm) return;

              const snapshot = {
                ...(mvtTerminationByStationRef.current || {}),
                [stationNorm]: draft,
              };

              const idx = list.findIndex((x) => x.norm === stationNorm);
              const start = idx >= 0 ? idx : 0;

              let next = null;
              for (let step = 1; step <= list.length; step++) {
                const cand = list[(start + step) % list.length];
                const vv = Math.max(0, Math.min(3, Number(snapshot?.[cand.norm] ?? 0)));
                if (vv === 3) continue; // skip locked
                next = { norm: cand.norm, label: cand.label, draft: vv };
                break;
              }

              if (!next) {
                setMvtTermPopup(null);
                return;
              }

              setMvtTermPopup((p) => (p ? {
                ...p,
                stationNorm: next.norm,
                stationLabel: next.label,
                draft: next.draft,
              } : p));
            };

            return (
              <div className="mt-3">
                <div className="border border-slate-700 bg-slate-800 px-2 py-2">
                  {locked ? (
                    <div className="flex items-center justify-end">
                      <span className="text-[11px] font-black uppercase tracking-wide text-emerald-300">LOCKED</span>
                    </div>
                  ) : null}

                  <div className="mt-0 flex items-center justify-end gap-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={3}
                        step={1}
                        value={draft}
                        disabled={locked}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          try {
                            e.preventDefault();
                            e.stopPropagation();
                          } catch (_e) { void _e; }
                          if (locked) return;
                          applyDraft(draft);
                          setMvtTermPopup(null);
                        }}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '') return;
                          const n = Math.max(0, Math.min(3, parseInt(v, 10)));
                          if (Number.isFinite(n)) setDraft(n);
                        }}
                        className={`w-14 h-8 border-2 bg-slate-900 px-2 text-center text-[13px] font-black tabular-nums outline-none ${
                          locked ? 'border-slate-700 text-slate-500 cursor-not-allowed' : (draft === 3 ? 'border-emerald-700 text-emerald-200' : 'border-red-700 text-red-200')
                        }`}
                        title="Enter 0..3"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      if (locked) return;
                      applyDraft(draft);
                      openNextStation();
                    }}
                    className={`flex-1 h-8 border-2 text-[11px] font-extrabold uppercase tracking-wide ${
                      locked ? 'border-slate-700 bg-slate-900/40 text-slate-500 cursor-not-allowed' : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                    }`}
                    title={locked ? 'Locked at 3/3' : 'Apply and open next SS'}
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      if (!stationNorm) return;
                      applyDraft(draft);
                      setMvtTermPopup(null);
                    }}
                    className={`flex-1 h-8 border-2 text-[11px] font-extrabold uppercase tracking-wide ${
                      locked ? 'border-slate-700 bg-slate-900/40 text-slate-500 cursor-not-allowed' : 'border-emerald-700 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-950/40'
                    }`}
                    title="Apply"
                  >
                    OK
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}

      {_customFooter}
      
      {/* Note Edit Popup */}
      {editingNote && (
        <div
          className="note-popup-overlay"
          onClick={() => {
            setEditingNote(null);
            setNoteText('');
            setNoteDate('');
            setNotePhotoDataUrl(null);
            setNotePhotoName('');
          }}
        >
          <div className="note-popup" onClick={(e) => e.stopPropagation()}>
            <div className="note-popup-header">
              <h3>
                <svg viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="popupPinGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#f87171" />
                      <stop offset="100%" stopColor="#dc2626" />
                    </linearGradient>
                  </defs>
                  <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20c0-6.6-5.4-12-12-12z" fill="url(#popupPinGrad)"/>
                  <circle cx="12" cy="11" r="5" fill="white" opacity="0.9"/>
                  <circle cx="12" cy="11" r="3" fill="#dc2626"/>
                </svg>
                Note
              </h3>
              <button
                className="note-close-btn"
                onClick={() => {
                  setEditingNote(null);
                  setNoteText('');
                  setNoteDate('');
                  setNotePhotoDataUrl(null);
                  setNotePhotoName('');
                }}
              >
                ×
              </button>
            </div>

            <div className="note-date-row">
              <label className="note-date-label">Date</label>
              <input
                className="note-date-input"
                type="date"
                value={noteDate}
                onChange={(e) => setNoteDate(e.target.value)}
              />
            </div>

            <div className="note-attachments">
              <input
                ref={notePhotoInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  handleNotePhotoSelected(file);
                  // allow selecting the same file again
                  e.target.value = '';
                }}
              />
              <button
                className="btn btn-photo-note"
                onClick={() => notePhotoInputRef.current?.click()}
                type="button"
              >
                📷 Add Photo
              </button>
              {notePhotoDataUrl && (
                <button
                  className="btn btn-remove-photo"
                  onClick={() => {
                    setNotePhotoDataUrl(null);
                    setNotePhotoName('');
                  }}
                  type="button"
                >
                  Remove
                </button>
              )}
            </div>

            {notePhotoDataUrl && (
              <div className="note-photo-preview">
                <img src={notePhotoDataUrl} alt={notePhotoName || 'Note attachment'} />
              </div>
            )}
            <textarea
              className="note-textarea"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Write your note here..."
              autoFocus
            />
            <div className="note-popup-actions">
              <button className="btn btn-delete-note" onClick={() => deleteNote(editingNote.id)}>
                🗑️ Delete
              </button>
              <button className="btn btn-save-note" onClick={saveNote}>
                💾 Save
              </button>
            </div>
            <div className="note-popup-meta">
              Lat: {editingNote.lat.toFixed(6)}, Lng: {editingNote.lng.toFixed(6)}
            </div>
          </div>
        </div>
      )}

      {/* Submit Modal */}
      <SubmitModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={(record) => {
          // Add notes from the same date to the record
          const recordDate = record.date;
          const notesOnDate = notes.filter(n => {
            const ymd = n.noteDate || (n.createdAt ? new Date(n.createdAt).toISOString().split('T')[0] : null);
            return ymd === recordDate;
          });
          // MVF: once submitted, lock selected mv_trench parts + segment routes so they cannot be changed/recounted.
          if (isMVF) {
            const toCommitParts = mvfSelectedTrenchPartsRef.current || [];
            if (toCommitParts.length > 0 && recordDate) {
              const key = `${mvfStoragePrefix}:trench_parts_committed:${recordDate}`;
              try {
                const raw = localStorage.getItem(key);
                const arr = raw ? JSON.parse(raw) : [];
                const prev = Array.isArray(arr) ? arr : [];
                const seen = new Set(prev.map((p) => String(p?.id || '')));
                const merged = [...prev];
                toCommitParts.forEach((p) => {
                  const id = String(p?.id || '');
                  if (!id || seen.has(id)) return;
                  seen.add(id);
                  // reduce payload size a bit (coords rounded)
                  const coords = Array.isArray(p?.coords)
                    ? p.coords.map((c) => [Number(c?.[0]).toFixed ? Number(c[0].toFixed(6)) : c[0], Number(c?.[1]).toFixed ? Number(c[1].toFixed(6)) : c[1]])
                    : [];
                  merged.push({
                    id,
                    fid: String(p?.fid || ''),
                    lineIndex: Number.isFinite(Number(p?.lineIndex)) ? Number(p.lineIndex) : null,
                    startM: Number.isFinite(Number(p?.startM)) ? Number(p.startM) : null,
                    endM: Number.isFinite(Number(p?.endM)) ? Number(p.endM) : null,
                    source: p?.source || null,
                    segmentKey: p?.segmentKey ? String(p.segmentKey) : null,
                    metersMultiplier:
                      typeof p?.metersMultiplier === 'number' && Number.isFinite(p.metersMultiplier)
                        ? p.metersMultiplier
                        : null,
                    coords,
                    meters: Number(p?.meters) || 0,
                  });
                });
                localStorage.setItem(key, JSON.stringify(merged));
              } catch (_e) {
                void _e;
              }

              if (recordDate === mvfTodayYmd) {
                setMvfCommittedTrenchParts((prev) => {
                  const base = prev || [];
                  const seen = new Set(base.map((p) => String(p?.id || '')));
                  const next = [...base];
                  toCommitParts.forEach((p) => {
                    const id = String(p?.id || '');
                    if (!id || seen.has(id)) return;
                    seen.add(id);
                    next.push(p);
                  });
                  return next;
                });
              }

              // Clear current selection after submit (submit button disables until new selection)
              setMvfSelectedTrenchParts([]);
              setMvfActiveSegmentKeys(new Set());
            }
          }
          addRecord({ ...record, notes: notesOnDate });
          alert('Work submitted successfully!');
        }}
        moduleKey={isMC4
          ? (mc4SelectionMode === 'termination' ? 'MC4_TERM' : 'MC4_INST')
          : (isMVT
            ? 'MVT_TERM'
            : (isLVTT && String(lvttSubMode || 'termination') === 'termination')
              ? 'LVTT_TERM'
              : (activeMode?.key || ''))}
        moduleLabel={isMC4
          ? (mc4SelectionMode === 'termination' ? 'Cable Termination' : 'MC4 Installation')
          : (isMVT
            ? 'Cable Termination'
            : (isLVTT && String(lvttSubMode || 'termination') === 'termination')
              ? 'Cable Termination'
              : moduleName)}
        workAmount={isMC4
          ? (mc4SelectionMode === 'termination'
            ? (mc4Counts?.terminatedCompleted || 0)
            : (mc4Counts?.mc4Completed || 0))
          : (isMVT
            ? mvtCompletedForSubmit
            : (isLVTT && String(lvttSubMode || 'termination') === 'termination')
              ? lvttCompletedForSubmit
              : workAmount)}
        workUnit={
          isMC4
            ? (mc4SelectionMode === 'termination' ? 'cables terminated' : 'mc4')
            : (isMVT
              ? 'cables terminated'
              : (isLVTT && String(lvttSubMode || 'termination') === 'termination')
                ? lvttWorkUnit
                : 'm')
        }
      />
      
      {/* History Modal */}
      {historyOpen && (
        <div className="history-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="history-header">
              <h2>📊 Work History</h2>
              <button className="history-close" onClick={() => setHistoryOpen(false)}>×</button>
            </div>
            
            <div className="history-sort">
              <span>Sort by:</span>
              <button 
                className={`sort-btn ${historySortBy === 'date' ? 'active' : ''}`}
                onClick={() => {
                  if (historySortBy === 'date') setHistorySortOrder(o => o === 'asc' ? 'desc' : 'asc');
                  else { setHistorySortBy('date'); setHistorySortOrder('desc'); }
                }}
              >
                Date {historySortBy === 'date' && (historySortOrder === 'desc' ? '↓' : '↑')}
              </button>
              <button 
                className={`sort-btn ${historySortBy === 'workers' ? 'active' : ''}`}
                onClick={() => {
                  if (historySortBy === 'workers') setHistorySortOrder(o => o === 'asc' ? 'desc' : 'asc');
                  else { setHistorySortBy('workers'); setHistorySortOrder('desc'); }
                }}
              >
                Workers {historySortBy === 'workers' && (historySortOrder === 'desc' ? '↓' : '↑')}
              </button>
              <button 
                className={`sort-btn ${historySortBy === 'cable' ? 'active' : ''}`}
                onClick={() => {
                  if (historySortBy === 'cable') setHistorySortOrder(o => o === 'asc' ? 'desc' : 'asc');
                  else { setHistorySortBy('cable'); setHistorySortOrder('desc'); }
                }}
              >
                Cable {historySortBy === 'cable' && (historySortOrder === 'desc' ? '↓' : '↑')}
              </button>
            </div>
            
            <div className="history-summary">
              <div className="summary-item">
                <span className="summary-label">Total Records</span>
                <span className="summary-value">{dailyLog.length}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Total Cable</span>
                <span className="summary-value">{dailyLog.reduce((s, r) => s + (r.total_cable || 0), 0).toFixed(0)} m</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Total Workers</span>
                <span className="summary-value">{dailyLog.reduce((s, r) => s + (r.workers || 0), 0)}</span>
              </div>
            </div>
            
            <div className="history-list">
              {(() => {
                const noteYmd = (n) => n.noteDate || (n.createdAt ? new Date(n.createdAt).toISOString().split('T')[0] : null);

                const notesByDate = {};
                notes.forEach(n => {
                  const d = noteYmd(n);
                  if (!d) return;
                  if (!notesByDate[d]) notesByDate[d] = [];
                  notesByDate[d].push(n);
                });

                const recordsByDate = {};
                dailyLog.forEach(r => {
                  const d = r.date;
                  if (!d) return;
                  if (!recordsByDate[d]) recordsByDate[d] = [];
                  recordsByDate[d].push(r);
                });

                const dates = Array.from(new Set([...Object.keys(recordsByDate), ...Object.keys(notesByDate)]));
                const mult = historySortOrder === 'desc' ? -1 : 1;

                const dateMetric = (d) => {
                  const recs = recordsByDate[d] || [];
                  if (historySortBy === 'workers') return recs.reduce((s, r) => s + (r.workers || 0), 0);
                  if (historySortBy === 'cable') return recs.reduce((s, r) => s + (r.total_cable || 0), 0);
                  return new Date(d).getTime();
                };

                dates.sort((a, b) => mult * (dateMetric(a) - dateMetric(b)));

                if (dates.length === 0) {
                  return <div className="history-empty">No work records or notes yet</div>;
                }

                return dates.map((d) => {
                  const recs = [...(recordsByDate[d] || [])];
                  const dayNotes = [...(notesByDate[d] || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                  const dateLabel = new Date(d).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

                  return (
                    <div key={d} className="history-day">
                      <div className="history-day-header">
                        <span className="history-day-date">{dateLabel}</span>
                        <span className="history-day-badges">
                          {recs.length > 0 && <span className="history-day-badge">Work: {recs.length}</span>}
                          {dayNotes.length > 0 && <span className="history-day-badge notes">Notes: {dayNotes.length}</span>}
                        </span>
                      </div>

                      {recs.length > 0 && (
                        <div className="history-day-section">
                          <div className="history-day-section-title">Work</div>
                          {recs.map((record, idx) => (
                            <div key={idx} className="history-item">
                              <div className="history-item-header">
                                <span className="history-subcontractor">{record.subcontractor}</span>
                              </div>
                              <div className="history-item-stats">
                                <div className="stat">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="stat-icon">
                                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                                    <circle cx="9" cy="7" r="4"/>
                                    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                                  </svg>
                                  <span>{record.workers} workers</span>
                                </div>
                                <div className="stat stat-positive">
                                  <span>+DC: {(record.plus_dc || 0).toFixed(0)} m</span>
                                </div>
                                <div className="stat stat-negative">
                                  <span>-DC: {(record.minus_dc || 0).toFixed(0)} m</span>
                                </div>
                                <div className="stat stat-total">
                                  <span>Total: {(record.total_cable || 0).toFixed(0)} m</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {dayNotes.length > 0 && (
                        <div className="history-day-section">
                          <div className="history-day-section-title">Notes</div>
                          <div className="history-notes">
                            {dayNotes.map((n) => {
                              const time = n.createdAt ? new Date(n.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
                              const hasPhoto = Boolean(n.photoDataUrl);
                              return (
                                <div key={n.id} className="history-note">
                                  <div className="history-note-top">
                                    <span className="history-note-time">{time}</span>
                                    {hasPhoto && <span className="history-note-photo">📷</span>}
                                  </div>
                                  <div className="history-note-text">{n.text || '(empty note)'}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
