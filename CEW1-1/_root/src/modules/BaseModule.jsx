import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../App.css';
import SubmitModal from '../components/SubmitModal';
import useDailyLog from '../hooks/useDailyLog';
import { useChartExport } from '../hooks/useChartExport';
import Papa from 'papaparse';
import {
  asLineStrings,
  mergeIntervals,
  computeIntervalsInBox,
  buildCumulativeMeters,
  sliceLineByMeters,
  subtractInterval,
} from '../utils/lineBoxSelection';

// Punch List Services
import * as plDb from './punch-list/services/db';
import { loadConfig as plLoadConfig } from './punch-list/services/configLoader';
import { exportToPdf as plExportToPdf, exportToExcel as plExportToExcel, exportAllHistoryToPdf as plExportAllHistoryToPdf, exportAllHistoryToExcel as plExportAllHistoryToExcel } from './punch-list/services/export';


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
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    const dist = Math.sqrt(dx * dx + dy * dy);

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

// FULL.GEOJSON base style across ALL modules (requested): subtle slate-grey, consistent thickness.
// This is the "unselected" look for tables/panels coming from `full.geojson` in every module.
const FULL_GEOJSON_BASE_COLOR = 'rgba(100,116,139,0.45)';
const FULL_GEOJSON_BASE_WEIGHT = 1.05;

// LV: map inverter IDs (inv_id labels) to nearest LV box geometry so the box can turn green on selection.
const LV_INV_BOX_GRID_DEG = 0.001; // ~111m; search in neighboring cells for nearest inv_id

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
  // Global status line used across module load/parsing flows.
  const [status, setStatus] = useState('Loading...');

  // In this codebase, each module passes a single immutable config object.
  // Historically we called this the "activeMode".
  const activeMode = moduleConfig || {};
  const moduleName = name || activeMode?.label || activeMode?.key || 'Module';

  // Optional: auto-discover GeoJSON files from a public folder (via generated manifest).
  const [geojsonFilesOverride, setGeojsonFilesOverride] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const folder = String(activeMode?.autoGeojsonFolder || '').trim();
    if (!folder) {
      setGeojsonFilesOverride(null);
      return;
    }

    (async () => {
      try {
        const res = await fetch('/cew_public_manifest.json', { cache: 'no-store' });
        if (!res.ok) return;
        const manifest = await res.json();
        const files = manifest?.folders?.[folder]?.geojson;
        if (!Array.isArray(files) || files.length === 0) return;

        const pickName = (fname) => {
          const low = String(fname || '').toLowerCase();
          if (!low.endsWith('.geojson')) return null;
          if (low.includes('string_text')) return 'string_text';
          if (low.includes('inv_id')) return 'inv_id';
          if (low.includes('lv_box')) return 'lv_box';
          if (low.includes('inv_box')) return 'lv_box'; // many datasets use inv_box as the box layer
          if (low.includes('boundry') || low.includes('boundary')) return 'boundry';
          if (low.startsWith('full')) return 'full';
          return low.replace(/\.geojson$/i, '');
        };

        const mkStyle = (name) => {
          if (name === 'boundry') {
            return {
              color: 'rgba(239, 68, 68, 0.7)',
              fillColor: 'transparent',
              weight: 1.2,
              fillOpacity: 0,
              interactive: false,
            };
          }
          if (name === 'lv_box') {
            return {
              color: '#eab308',
              fillColor: '#facc15',
              weight: 3,
              fillOpacity: 0.6,
            };
          }
          if (name === 'string_text') {
            return { color: '#dc2626', fillColor: '#ef4444' };
          }
          if (name === 'inv_id') {
            return { color: '#16a34a', fillColor: '#22c55e' };
          }
          // Default table/line styling
          return { color: 'rgba(255,255,255,0.55)', fillColor: 'transparent' };
        };

        const out = files
          .map((fname) => {
            const name = pickName(fname);
            if (!name) return null;
            const url = `/${encodeURIComponent(folder)}/${encodeURIComponent(fname)}`;
            return { url, name, ...mkStyle(name) };
          })
          .filter(Boolean);

        if (!cancelled && out.length > 0) setGeojsonFilesOverride(out);
      } catch (_e) {
        void _e;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeMode?.autoGeojsonFolder]);

  const activeGeojsonFiles = geojsonFilesOverride || activeMode?.geojsonFiles || [];

  // Whether to show counter UI in header
  const showCounters = counters;

  const isLV = String(activeMode?.key || '').toUpperCase() === 'LV';
  const isFIB = String(activeMode?.key || '').toUpperCase() === 'FIB';
  // DC Cable Pulling Progress mode
  const isDC = String(activeMode?.key || '').toUpperCase() === 'DC';
  // Treat any module with mvf-style CSV/logic as MVF-mode (e.g., MV + FIBRE modules).
  const isMVF = String(activeMode?.csvFormat || '').toLowerCase() === 'mvf';
  const isMC4 = String(activeMode?.key || '').toUpperCase() === 'MC4';
  const isMVT = String(activeMode?.key || '').toUpperCase() === 'MVT';
  const isLVTT = String(activeMode?.key || '').toUpperCase() === 'LVTT';
  const isPL = String(activeMode?.key || '').toUpperCase() === 'PL';
  // PARAMETER & TABLE EARTHING PROGRESS mode
  const isPTEP = String(activeMode?.key || '').toUpperCase() === 'PTEP' || Boolean(activeMode?.earthingMode);
  // DC Cable Testing Progress mode
  const isDCCT = String(activeMode?.key || '').toUpperCase() === 'DCCT' || Boolean(activeMode?.dcctMode);
  const isMVTRef = useRef(isMVT);
  useEffect(() => {
    isMVTRef.current = isMVT;
  }, [isMVT]);
  const isDCCTRef = useRef(isDCCT);
  useEffect(() => {
    isDCCTRef.current = isDCCT;
  }, [isDCCT]);
  // TABLE_INSTALLATION_PROGRESS mode
  const isTIP = String(activeMode?.key || '').toUpperCase() === 'TIP' || Boolean(activeMode?.tableCounters);
  // LV_BOX_INV_BOX_INSTALLATION mode
  const isLVIB = String(activeMode?.key || '').toUpperCase() === 'LVIB' || Boolean(activeMode?.boxLabelsEnabled);
  // DC&AC TRENCH PROGRESS mode
  const isDATP = String(activeMode?.key || '').toUpperCase() === 'DATP';
  // MV&FIBRE TRENCH PROGRESS mode
  const isMVFT = String(activeMode?.key || '').toUpperCase() === 'MVFT';
  // DC TERMINATION & TESTING PROGRESS mode
  const isDCTT = String(activeMode?.key || '').toUpperCase() === 'DCTT';
  const isDCTTRef = useRef(isDCTT);
  useEffect(() => {
    isDCTTRef.current = isDCTT;
  }, [isDCTT]);

















  // ─────────────────────────────────────────────────────────────
  // GENERIC POLYGON SELECTION (shared across many modules)
  // ─────────────────────────────────────────────────────────────
  const [selectedPolygons, setSelectedPolygons] = useState(() => new Set());
  const selectedPolygonsRef = useRef(selectedPolygons);
  useEffect(() => {
    selectedPolygonsRef.current = selectedPolygons;
  }, [selectedPolygons]);

  // "Committed" (submitted) polygon selections. Many modules lock these until history deletion.
  const [committedPolygons, setCommittedPolygons] = useState(() => new Set());
  const committedPolygonsRef = useRef(committedPolygons);
  useEffect(() => {
    committedPolygonsRef.current = committedPolygons;
  }, [committedPolygons]);

  // CSV-derived length lookup used by LV/DC/MC4/MVF counters and history editing meters.
  // Shape varies by module, but generally: idNorm -> { plus?: number[], minus?: number[], total?: number }
  const [lengthData, setLengthData] = useState(() => ({}));

  const datpTrenchLineColor = isDATP
    ? (activeGeojsonFiles || []).find((f) => String(f?.name || '').toLowerCase() === 'trench')?.color || '#3b82f6'
    : '#3b82f6';

  // MVFT trench line color (blue like DATP)
  const mvftTrenchLineColor = isMVFT
    ? (activeGeojsonFiles || []).find((f) => String(f?.name || '').toLowerCase() === 'trench')?.color || '#3b82f6'
    : '#3b82f6';

  const datpCompletedLineColor = '#22c55e';
  const mvftCompletedLineColor = '#22c55e';
  const mvfCircuitsMultiplier =
    typeof activeMode?.circuitsMultiplier === 'number' && Number.isFinite(activeMode.circuitsMultiplier)
      ? activeMode.circuitsMultiplier
      : 1;
  // Segment colors must never use green (reserved for "completed").
  // Use VERY distinct, high-contrast colors that are easy to tell apart.
  const mvfSegmentPalette = [
    '#dc2626', // bright red
    '#2563eb', // strong blue
    '#d946ef', // magenta/fuchsia
    '#f59e0b', // amber/orange
    '#06b6d4', // cyan
    '#8b5cf6', // violet
    '#f43f5e', // rose/pink
    '#14b8a6', // teal
    '#ea580c', // deep orange
    '#7c3aed', // purple
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

  // String-text points used for hit-testing and drag-selection (populated after string_text is loaded).
  const [stringPoints, setStringPoints] = useState(() => []);
  const stringPointsRef = useRef(stringPoints);
  useEffect(() => {
    stringPointsRef.current = stringPoints;
  }, [stringPoints]);

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

  // Expose current header height for App-level positioning (e.g., hamburger button).
  // Header height varies by module/counters, so we keep this dynamic.
  useEffect(() => {
    const el = headerBarRef.current;
    if (!el) return;

    const setVar = () => {
      try {
        const h = el.getBoundingClientRect().height;
        const px = `${Math.round(h)}px`;
        document.documentElement.style.setProperty('--cewHeaderH', px);
      } catch (_e) {
        void _e;
      }
    };

    setVar();
    let ro = null;
    try {
      ro = new ResizeObserver(() => setVar());
      ro.observe(el);
    } catch (_e) {
      void _e;
    }
    window.addEventListener('resize', setVar);
    return () => {
      window.removeEventListener('resize', setVar);
      if (ro) ro.disconnect();
    };
  }, []);

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
  const headerBarRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const stringTextRendererRef = useRef(null); // dedicated canvas renderer for string_text to avoid ghosting
  const lvttInvIdRendererRef = useRef(null); // dedicated canvas renderer for LVTT inv_id labels to avoid overlap when switching modes
  const lvttTermCounterRendererRef = useRef(null); // dedicated canvas renderer for LVTT termination counters
  const lvttSubCounterRendererRef = useRef(null); // dedicated canvas renderer for LVTT SUB counters
  const ptepTableToTableSvgRendererRef = useRef(null); // dedicated SVG renderer for PTEP table-to-table (ensures clickability under preferCanvas)
  const ptepParameterSvgRendererRef = useRef(null); // dedicated SVG renderer for PTEP parameter (ensures clickability under preferCanvas)
  const layersRef = useRef([]);
  const polygonIdCounter = useRef(0); // Counter for unique polygon IDs
  const polygonById = useRef({}); // uniqueId -> {layer, stringId}
  const prevHistoryHighlightRef = useRef(new Set()); // Track previously highlighted history polygons
  const mvtHistoryHighlightStationSetRef = useRef(new Set()); // stationNorms highlighted by history selection (MVT termination)
  const boxRectRef = useRef(null);
  const draggingRef = useRef(null);
  const rafRef = useRef(null);
  const stringTextPointsRef = useRef([]); // [{lat,lng,text,angle,stringId}]
  const stringTextLayerRef = useRef(null); // L.LayerGroup
  // MVT: cache SS/SUB station label points for reliable MV_TESTING click hit-testing.
  const mvtStationPointsRef = useRef([]); // [{lat,lng,stationKey,stationLabel}]
  // MVT: separate interactive layer for clickable termination counters (0/3..3/3).
  const mvtCounterLayerRef = useRef(null); // L.LayerGroup
  const mvtCounterLabelPoolRef = useRef([]); // L.TextLabel[]
  const mvtCounterLabelActiveCountRef = useRef(0);
  const mvtTestCsvByFromRef = useRef({}); // fromNorm -> { L1: 'PASS'|'FAIL'|..., L2, L3 }
  const mvtTerminationByStationRef = useRef({}); // stationNorm -> 0..max (per station)

  // MVT termination: station-specific max counts
  // SUB1-3 => max 6, SUB4-6 => max 3, CSS => max 9
  const mvtCanonicalTerminationStationNorm = (rawNorm) => {
    const norm = normalizeId(rawNorm);
    if (!norm) return '';
    if (norm === 'css') return 'css';
    const m = norm.match(/^(ss|sub)(\d{1,2})$/i);
    if (!m) return norm;
    const prefix = String(m[1] || '').toLowerCase();
    const nn = String(parseInt(m[2], 10)).padStart(2, '0');
    return `${prefix}${nn}`;
  };
  const isMvtTerminationStationNorm = (stationNorm) => {
    const norm = mvtCanonicalTerminationStationNorm(stationNorm);
    if (norm === 'css') return true;
    const m = norm.match(/^(ss|sub)(\d{2})$/i);
    if (!m) return false;
    const n = parseInt(m[2], 10);
    return Number.isFinite(n) && n >= 1 && n <= 6;
  };
  const mvtTerminationMaxForNorm = (stationNorm) => {
    const norm = mvtCanonicalTerminationStationNorm(stationNorm);
    if (!isMvtTerminationStationNorm(norm)) return 0;
    if (norm === 'css') return 9;
    const m = norm.match(/^(ss|sub)(\d{2})$/i);
    const n = m ? parseInt(m[2], 10) : 0;
    if (n >= 1 && n <= 3) return 6;
    if (n >= 4 && n <= 6) return 3;
    return 0;
  };
  const clampMvtTerminationCount = (stationNorm, value) => {
    const max = mvtTerminationMaxForNorm(stationNorm);
    if (!max) return 0;
    return Math.max(0, Math.min(max, Number(value) || 0));
  };
  // MVT: sub-mode selector (single module with two internal modes)
  const [mvtSubMode, setMvtSubMode] = useState(() => {
    try {
      const raw = localStorage.getItem('cew:mvt:submode');
      const v = String(raw || '').toLowerCase();
      return v === 'testing' ? 'testing' : 'termination';
    } catch (_e) {
      void _e;
      return 'termination';
    }
  }); // 'termination' | 'testing'
  const mvtSubModeRef = useRef(mvtSubMode);
  useEffect(() => {
    mvtSubModeRef.current = mvtSubMode;
    try {
      localStorage.setItem('cew:mvt:submode', String(mvtSubMode || 'termination'));
    } catch (_e) {
      void _e;
    }
  }, [mvtSubMode]);
  // LVTT: LV Termination & Testing mode - CSV data by inverter ID
  const lvttTestCsvByInvRef = useRef({}); // invNorm -> { L1: {value, status}, L2: {value, status}, L3: {value, status} }
  const lvttInvMetaByNormRef = useRef({}); // invNorm -> { lat, lng, angle, raw, displayId }
  // LVTT: separate clickable termination counter labels under inv_id
  const lvttTermCounterLayerRef = useRef(null); // L.LayerGroup
  const lvttTermCounterLabelPoolRef = useRef([]); // L.TextLabel[]
  const lvttTermCounterLabelActiveCountRef = useRef(0);
  // LVTT: separate clickable SUB counters (0/max per SUB, max derived from LV cable pulling CSV)
  const lvttSubCounterLayerRef = useRef(null); // L.LayerGroup
  const lvttSubCounterLabelPoolRef = useRef([]); // L.TextLabel[]
  const lvttSubCounterLabelActiveCountRef = useRef(0);
  const lvttTxInvMaxByTxRef = useRef({}); // txNumber -> maxInv
  const [lvttTxInvMaxVersion, setLvttTxInvMaxVersion] = useState(0);
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

  // LVTT: manual termination/progress counts per SUB (persistent)
  const lvttCanonicalSubNorm = useCallback((raw) => {
    const norm = normalizeId(raw);
    if (!norm) return '';
    // LVTT subs_text uses SSxx labels (e.g., SS06). Users may refer to them as SUB.
    // Accept both SSxx and SUBxx.
    const m = norm.match(/^(ss|sub)(\d{1,2})$/i);
    if (!m) return '';
    const prefix = String(m[1] || '').toLowerCase();
    const n = parseInt(m[2], 10);
    if (!Number.isFinite(n) || n <= 0) return '';
    return `${prefix}${String(n).padStart(2, '0')}`;
  }, []);

  const [lvttSubTerminationBySub, setLvttSubTerminationBySub] = useState(() => ({})); // subNN -> 0..maxInv
  const lvttSubTerminationBySubRef = useRef(lvttSubTerminationBySub);
  useEffect(() => {
    lvttSubTerminationBySubRef.current = lvttSubTerminationBySub || {};
  }, [lvttSubTerminationBySub]);

  // LVTT: load TX->max INV map from LV cable pulling CSV (public/LV_CABLE_PULLING _PROGRESS_TRACKING/lv_pulling.csv)
  useEffect(() => {
    if (!isLVTT) {
      lvttTxInvMaxByTxRef.current = {};
      setLvttTxInvMaxVersion((v) => v + 1);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Folder name contains a space, so be defensive and try encoded + literal variants.
        const basePaths = [
          '/LV_CABLE_PULLING _PROGRESS_TRACKING/lv_pulling.csv',
          encodeURI('/LV_CABLE_PULLING _PROGRESS_TRACKING/lv_pulling.csv'),
          '/LV_CABLE_PULLING%20_PROGRESS_TRACKING/lv_pulling.csv',
        ];

        let text = '';
        let lastErr = null;
        for (const p of basePaths) {
          try {
            const url = `${p}?v=${Date.now()}`;
            const r = await fetch(url, { cache: 'no-store' });
            if (r && r.ok) {
              text = await r.text();
              break;
            }
            lastErr = new Error(`HTTP ${r?.status || '??'} for ${p}`);
          } catch (e) {
            lastErr = e;
          }
        }
        if (!text) throw lastErr || new Error('Failed to load lv_pulling.csv');
        if (cancelled) return;

        const rawText = String(text || '');
        const rawLinesArr = rawText.split(/\r?\n/);
        const lines = rawLinesArr.map((l) => String(l || '').trim()).filter(Boolean);
        if (lines.length <= 1) {
          lvttTxInvMaxByTxRef.current = {};
          setLvttTxInvMaxVersion((v) => v + 1);
          return;
        }

        const first = String(lines[0] || '');
        const sep = first.includes('\t') ? '\t' : (first.includes(';') && first.split(';').length > first.split(',').length ? ';' : ',');
        const header = first.split(sep).map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
        const idIdx = header.findIndex((h) => h === 'id' || h === 'name' || h === 'key');
        const out = {};

        for (let i = 1; i < lines.length; i++) {
          const parts = String(lines[i] || '').split(sep).map((p) => String(p || '').trim());
          const rawId = idIdx >= 0 ? parts[idIdx] : parts[0];
          const id = String(rawId || '').trim();
          if (!id) continue;
          const m = id.match(/^\s*TX\s*(\d+)\s*[-_ ]\s*INV\s*(\d+)\s*$/i) || id.match(/TX\s*(\d+).*INV\s*(\d+)/i);
          if (!m) continue;
          const tx = parseInt(m[1], 10);
          const inv = parseInt(m[2], 10);
          if (!Number.isFinite(tx) || !Number.isFinite(inv)) continue;
          if (tx <= 0 || inv <= 0) continue;
          const prev = Number(out[tx] || 0);
          out[tx] = Math.max(prev, inv);
        }

        lvttTxInvMaxByTxRef.current = out;
        setLvttTxInvMaxVersion((v) => v + 1);
        // eslint-disable-next-line no-console
        console.log('[LVTT] loaded lv_pulling.csv TX max', out);
      } catch (e) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('[LVTT] failed to load lv_pulling.csv for SUB counters', e);
        lvttTxInvMaxByTxRef.current = {};
        setLvttTxInvMaxVersion((v) => v + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLVTT]);

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
  // DCCT: Preserve original CSV row ordering (and duplicates) for Export parity with dc_riso.csv
  // rows: [{ originalId: string, idNorm: string }]
  const dcctRowsRef = useRef([]);
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
  const [dcctTestResultsDirty, setDcctTestResultsDirty] = useState(false);
  const dcctTestResultsSubmittedRef = useRef(null); // { risoById, updatedAt, source } | null
  const dcctTestImportFileInputRef = useRef(null);
  const [dcctPopup, setDcctPopup] = useState(null); // { idNorm, displayId, draftPlus, draftMinus, draftStatus, x, y } | null

  const dcctClearTestOverlays = useCallback(() => {
    try {
      const layer = dcctOverlayLayerRef.current;
      if (layer) layer.clearLayers();
    } catch (_e) {
      void _e;
    }
    dcctOverlayLabelsByIdRef.current = {};
  }, []);

  const dcctNormalizeStatus = (raw) => {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'passed' || v === 'pass') return 'passed';
    if (v === 'failed' || v === 'fail') return 'failed';
    return null;
  };

  const dcctNormalizeId = useCallback((raw) => {
    const rawText = String(raw ?? '').replace(/^\uFEFF/, '').trim();
    if (!rawText) return '';
    const compact = rawText.replace(/\s+/g, '').replace(/^['\"]+|['\"]+$/g, '');
    const low = compact.toLowerCase();

    // Canonicalize the common DCCT key shapes:
    // - TX2-INV1-STR1
    // - TX2_INV1_STR1
    // - TX2INV1STR1
    const m = low.match(/^tx(\d+)[_\-]?inv(\d+)[_\-]?str(\d+)$/i) || low.match(/tx(\d+).*inv(\d+).*str(\d+)/i);
    if (m) return `tx${m[1]}-inv${m[2]}-str${m[3]}`;

    return normalizeId(rawText);
  }, []);

  const dcctFormatDisplayId = (idNorm, recOriginalId) => {
    const original = String(recOriginalId || '').trim();
    if (original) return original;
    return String(idNorm || '')
      .toUpperCase()
      .replace(/TX(\d+)INV(\d+)STR(\d+)/i, 'TX$1-INV$2-STR$3');
  };

  const dcctImportTestResultsFromText = useCallback((text, source = 'import') => {
    try {
      // Clear transient UI state so the user immediately sees the imported data.
      setDcctFilter(null);
      dcctClearTestOverlays();

      const cleaned = String(text || '').replace(/^\uFEFF/, '');
      const parsed = Papa.parse(cleaned, {
        header: false,
        skipEmptyLines: true,
        delimiter: '',
      });

      const rowsArr = Array.isArray(parsed?.data) ? parsed.data : [];
      if (rowsArr.length <= 1) {
        setDcctTestData({});
        setDcctCsvTotals({ total: 0, passed: 0, failed: 0 });
        dcctRisoByIdRef.current = {};
        dcctRowsRef.current = [];
        setDcctTestResultsDirty(true);
        dcctTestResultsSubmittedRef.current = null;
        try { localStorage.removeItem('cew:dcct:test_results_submitted'); } catch (_e) { void _e; }
        setDcctPopup(null);
        setStringMatchVersion((v) => v + 1);
        return;
      }

      const headerRow = Array.isArray(rowsArr[0]) ? rowsArr[0] : [];
      const header = headerRow.map((h) => String(h ?? '').trim().toLowerCase());
      const idIdx = header.findIndex((h) => h === 'id' || h.includes('id'));
      const remarkIdx = header.findIndex((h) => h === 'remark' || h.includes('remark') || h.includes('status') || h.includes('result'));
      const minusIdx = header.findIndex((h) => h.includes('insulation') && (h.includes('(-') || h.includes('-)')));
      const plusIdx = header.findIndex((h) => h.includes('insulation') && (h.includes('(+)') || h.includes('+)')));

      const risoById = {}; // normalizedId -> { plus, minus, status, remarkRaw, originalId }
      const rows = []; // preserve duplicates + original order

      for (let i = 1; i < rowsArr.length; i++) {
        const parts = Array.isArray(rowsArr[i]) ? rowsArr[i] : [];
        if (parts.length === 0) continue;
        const rawId = idIdx >= 0 ? parts[idIdx] : parts[0];
        const rawRemark = remarkIdx >= 0 ? parts[remarkIdx] : parts[parts.length - 1];
        const rawMinus = minusIdx >= 0 ? parts[minusIdx] : (parts.length >= 2 ? parts[1] : '');
        const rawPlus = plusIdx >= 0 ? parts[plusIdx] : (parts.length >= 3 ? parts[2] : '');

        const id = dcctNormalizeId(rawId);
        const originalId = String(rawId || '').trim();
        const remarkRaw = String(rawRemark || '').trim();

        if (!id) continue;
        rows.push({ originalId, idNorm: id });

        const nextPlus = String(rawPlus ?? '').trim();
        const nextMinus = String(rawMinus ?? '').trim();
        const nextStatus = dcctNormalizeStatus(remarkRaw);

        const prev = risoById[id];
        if (!prev) {
          risoById[id] = {
            plus: nextPlus,
            minus: nextMinus,
            status: nextStatus,
            remarkRaw,
            originalId,
          };
        } else {
          // Prefer existing originalId (first occurrence), but fill missing values if needed.
          const merged = {
            ...prev,
            plus: prev.plus && String(prev.plus).trim() !== '' ? prev.plus : nextPlus,
            minus: prev.minus && String(prev.minus).trim() !== '' ? prev.minus : nextMinus,
            status: prev.status != null ? prev.status : nextStatus,
            remarkRaw: prev.remarkRaw && String(prev.remarkRaw).trim() !== '' ? prev.remarkRaw : remarkRaw,
          };
          risoById[id] = merged;
        }
      }

      const testResults = {}; // normalizedId -> 'passed' | 'failed'
      let passedCount = 0;
      let failedCount = 0;
      Object.keys(risoById || {}).forEach((id) => {
        const st = dcctNormalizeStatus(risoById[id]?.status || risoById[id]?.remarkRaw);
        if (st === 'passed') {
          testResults[id] = 'passed';
          passedCount++;
        } else if (st === 'failed') {
          testResults[id] = 'failed';
          failedCount++;
        }
      });

      setDcctTestData(testResults);
      dcctRisoByIdRef.current = risoById;
      dcctRowsRef.current = rows;
      setDcctCsvTotals({ total: Object.keys(risoById || {}).length, passed: passedCount, failed: failedCount });

      setDcctTestResultsDirty(true);
      dcctTestResultsSubmittedRef.current = null;
      try { localStorage.removeItem('cew:dcct:test_results_submitted'); } catch (_e) { void _e; }

      setDcctPopup(null);
      setStringMatchVersion((v) => v + 1);
      void source;
    } catch (err) {
      console.error('Error parsing imported DCCT CSV:', err);
    }
  }, [dcctClearTestOverlays, dcctNormalizeId]);

  const dcctSubmitTestResults = useCallback(() => {
    if (!isDCCT) return;
    if (!dcctTestResultsDirty) return;
    const payload = {
      risoById: { ...(dcctRisoByIdRef.current || {}) },
      rows: Array.isArray(dcctRowsRef.current) ? dcctRowsRef.current : [],
      updatedAt: Date.now(),
      source: 'submit',
    };
    dcctTestResultsSubmittedRef.current = payload;
    try {
      localStorage.setItem('cew:dcct:test_results_submitted', JSON.stringify(payload));
    } catch (_e) {
      void _e;
    }
    setDcctTestResultsDirty(false);
  }, [isDCCT, dcctTestResultsDirty]);

  const dcctExportTestResultsCsv = useCallback(() => {
    try {
      if (dcctTestResultsDirty) return;
      let submitted = dcctTestResultsSubmittedRef.current;
      if (!submitted) {
        try {
          const raw = localStorage.getItem('cew:dcct:test_results_submitted');
          if (raw) submitted = JSON.parse(raw);
        } catch (_e) {
          void _e;
        }
      }
      const risoData = (submitted && typeof submitted === 'object') ? (submitted.risoById || {}) : {};
      const submittedRows = (submitted && typeof submitted === 'object' && Array.isArray(submitted.rows)) ? submitted.rows : [];
      const mapIds = dcctMapIdsRef.current || new Set();

      const header = 'ID,Insulation Resistance (-),Insulation Resistance (+),remark';
      const rows = [header];

      const pushed = new Set(); // idNorms present in submittedRows
      if (submittedRows.length > 0) {
        for (const row of submittedRows) {
          const originalId = String(row?.originalId || '').trim();
          const idNorm = row?.idNorm ? String(row.idNorm) : dcctNormalizeId(originalId);
          if (!idNorm) continue;
          pushed.add(idNorm);

          const rec = risoData[idNorm] || {};
          const displayId = originalId || dcctFormatDisplayId(idNorm, rec.originalId);
          const minus = (rec.minus != null && String(rec.minus).trim() !== '') ? String(rec.minus).trim() : '0';
          const plus = (rec.plus != null && String(rec.plus).trim() !== '') ? String(rec.plus).trim() : '0';
          const status = dcctNormalizeStatus(rec.status || rec.remarkRaw);
          const remark = status === 'passed' ? 'PASSED' : status === 'failed' ? 'FAILED' : '';
          rows.push(`${displayId},${minus},${plus},${remark}`);
        }
      }

      // Append any IDs that exist in data/map but were not in the original CSV rows.
      const allIds = new Set([...Object.keys(risoData), ...mapIds]);
      const remaining = Array.from(allIds).filter((id) => !pushed.has(id));
      const sortedRemaining = remaining.sort((a, b) => {
        const parseId = (id) => {
          const match = String(id).match(/tx(\d+)-inv(\d+)-str(\d+)/i);
          if (match) return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
          return [0, 0, 0];
        };
        const [aTx, aInv, aStr] = parseId(a);
        const [bTx, bInv, bStr] = parseId(b);
        if (aTx !== bTx) return aTx - bTx;
        if (aInv !== bInv) return aInv - bInv;
        return aStr - bStr;
      });
      for (const idNorm of sortedRemaining) {
        const rec = risoData[idNorm] || {};
        const displayId = dcctFormatDisplayId(idNorm, rec.originalId);
        const minus = (rec.minus != null && String(rec.minus).trim() !== '') ? String(rec.minus).trim() : '0';
        const plus = (rec.plus != null && String(rec.plus).trim() !== '') ? String(rec.plus).trim() : '0';
        const status = dcctNormalizeStatus(rec.status || rec.remarkRaw);
        const remark = status === 'passed' ? 'PASSED' : status === 'failed' ? 'FAILED' : '';
        rows.push(`${displayId},${minus},${plus},${remark}`);
      }

      const csvContent = rows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dc_riso_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting DCCT CSV:', err);
    }
  }, [dcctTestResultsDirty, dcctNormalizeId]);

  const dcctExportFilteredTestResultsCsv = useCallback(() => {
    try {
      if (dcctTestResultsDirty) return;
      const activeFilter = dcctFilterRef.current;
      if (!activeFilter) return;

      let submitted = dcctTestResultsSubmittedRef.current;
      if (!submitted) {
        try {
          const raw = localStorage.getItem('cew:dcct:test_results_submitted');
          if (raw) submitted = JSON.parse(raw);
        } catch (_e) {
          void _e;
        }
      }

      const risoData = (submitted && typeof submitted === 'object') ? (submitted.risoById || {}) : {};
      const submittedRows = (submitted && typeof submitted === 'object' && Array.isArray(submitted.rows)) ? submitted.rows : [];
      const mapIds = dcctMapIdsRef.current || new Set();

      const selected = new Set();
      if (activeFilter === 'not_tested') {
        // Not tested = on map but missing in submitted CSV data
        mapIds.forEach((id) => {
          const idNorm = dcctNormalizeId(id);
          if (idNorm && !Object.prototype.hasOwnProperty.call(risoData, idNorm)) selected.add(idNorm);
        });
      } else {
        Object.keys(risoData || {}).forEach((id) => {
          const rec = risoData[id] || {};
          const st = dcctNormalizeStatus(rec.status || rec.remarkRaw);
          if (st && st === activeFilter) selected.add(String(id));
        });
      }

      const header = 'ID,Insulation Resistance (-),Insulation Resistance (+),remark';
      const rows = [header];

      const pushed = new Set();
      if (submittedRows.length > 0) {
        for (const row of submittedRows) {
          const originalId = String(row?.originalId || '').trim();
          const idNorm = row?.idNorm ? String(row.idNorm) : dcctNormalizeId(originalId);
          if (!idNorm) continue;
          if (!selected.has(idNorm)) continue;
          pushed.add(idNorm);

          const rec = risoData[idNorm] || {};
          const displayId = originalId || dcctFormatDisplayId(idNorm, rec.originalId);
          const minus = (rec.minus != null && String(rec.minus).trim() !== '') ? String(rec.minus).trim() : '0';
          const plus = (rec.plus != null && String(rec.plus).trim() !== '') ? String(rec.plus).trim() : '0';
          const status = dcctNormalizeStatus(rec.status || rec.remarkRaw);
          const remark = status === 'passed' ? 'PASSED' : status === 'failed' ? 'FAILED' : '';
          rows.push(`${displayId},${minus},${plus},${remark}`);
        }
      }

      // Append remaining selected IDs not present in original rows (common for not_tested)
      const remaining = Array.from(selected).filter((id) => !pushed.has(id));
      const sortedRemaining = remaining.sort((a, b) => {
        const parseId = (id) => {
          const match = String(id).match(/tx(\d+)-inv(\d+)-str(\d+)/i);
          if (match) return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
          return [0, 0, 0];
        };
        const [aTx, aInv, aStr] = parseId(a);
        const [bTx, bInv, bStr] = parseId(b);
        if (aTx !== bTx) return aTx - bTx;
        if (aInv !== bInv) return aInv - bInv;
        return aStr - bStr;
      });
      for (const idNorm of sortedRemaining) {
        const rec = risoData[idNorm] || {};
        const displayId = dcctFormatDisplayId(idNorm, rec.originalId);
        const minus = (rec.minus != null && String(rec.minus).trim() !== '') ? String(rec.minus).trim() : '0';
        const plus = (rec.plus != null && String(rec.plus).trim() !== '') ? String(rec.plus).trim() : '0';
        const status = dcctNormalizeStatus(rec.status || rec.remarkRaw);
        const remark = status === 'passed' ? 'PASSED' : status === 'failed' ? 'FAILED' : '';
        rows.push(`${displayId},${minus},${plus},${remark}`);
      }

      const csvContent = rows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const tag = String(activeFilter).toLowerCase();
      link.download = `dc_riso_${tag}_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting filtered DCCT CSV:', err);
    }
  }, [dcctTestResultsDirty, dcctNormalizeId]);

  // Clear DCCT overlays/popup when switching modules
  useEffect(() => {
    dcctClearTestOverlays();
    setDcctPopup(null);
  }, [activeMode?.key, dcctClearTestOverlays]);
  useEffect(() => {
    const committed = committedPolygonsRef.current || committedPolygons;
    if (!committed || committed.size === 0) return;

    setSelectedPolygons((prev) => {
      // Fast path: if all committed are already present, do nothing.
      let missing = false;
      committed.forEach((id) => {
        if (!prev.has(id)) missing = true;
      });
      if (!missing) return prev;

      const next = new Set(prev);
      committed.forEach((id) => next.add(id));
      return next;
    });
  }, [selectedPolygons, committedPolygons]);
  // MVT: test panel state for "TESTED" click
  const [mvtTestPanel, setMvtTestPanel] = useState(null); // { stationLabel, fromKey, phases: {L1,L2,L3} } | null
  // MVT: manual termination counter state (persistent)
  const [mvtTerminationByStation, setMvtTerminationByStation] = useState(() => ({})); // stationNorm -> 0..max
  useEffect(() => {
    mvtTerminationByStationRef.current = mvtTerminationByStation || {};
  }, [mvtTerminationByStation]);
  const [mvtTermPopup, setMvtTermPopup] = useState(null); // { stationLabel, stationNorm, draft, x, y } | null
  const [mvtTestPopup, setMvtTestPopup] = useState(null); // { stationLabel, fromKey, phases, x, y } | null
  const [mvtCsvTotals, setMvtCsvTotals] = useState(() => ({ total: 0, fromRows: 0, toRows: 0 })); // generic total
  const [mvtTestResultsDirty, setMvtTestResultsDirty] = useState(false);
  // MVT: Active test filter ('passed' | 'failed' | 'not_tested' | null)
  const [mvtTestFilter, setMvtTestFilter] = useState(null);
  const mvtTestFilterRef = useRef(mvtTestFilter);
  useEffect(() => {
    mvtTestFilterRef.current = mvtTestFilter;
  }, [mvtTestFilter]);
  const mvtTestToByFromRef = useRef({}); // fromNorm -> raw `to` string (for export)
  const mvtTestResultsSubmittedRef = useRef(null); // { byFrom, toByFrom, updatedAt, source } | null
  const mvtTestImportFileInputRef = useRef(null);
  // LVTT: popup state (content depends on sub-mode)
  const [lvttPopup, setLvttPopup] = useState(null);
  const [lvttCsvTotals, setLvttCsvTotals] = useState(() => ({ total: 0, passed: 0, failed: 0 }));
  const [lvttTestResultsDirty, setLvttTestResultsDirty] = useState(false);
  // LVTT: Active test filter ('passed' | 'failed' | 'not_tested' | null)
  const [lvttTestFilter, setLvttTestFilter] = useState(null);
  const lvttTestFilterRef = useRef(lvttTestFilter);
  useEffect(() => {
    lvttTestFilterRef.current = lvttTestFilter;
  }, [lvttTestFilter]);
  const lvttTestResultsSubmittedRef = useRef(null); // { byInv, updatedAt, source } | null
  const lvttTestImportFileInputRef = useRef(null);
  const lvttTermInvInputRef = useRef(null);
  const [lvttCsvVersion, setLvttCsvVersion] = useState(0);
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
  const mvfHistoryHighlightLayerRef = useRef(null); // L.LayerGroup for history orange highlights
  const mvfSegmentLinesByKeyRef = useRef({}); // key -> L.Polyline[] (for history highlighting)
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

  // Clear testing filters when switching modules or leaving testing sub-modes
  useEffect(() => {
    setMvtTestFilter(null);
    setLvttTestFilter(null);
  }, [activeMode?.key]);
  useEffect(() => {
    if (!isMVT || String(mvtSubMode || 'termination') !== 'testing') setMvtTestFilter(null);
  }, [isMVT, mvtSubMode]);
  useEffect(() => {
    if (!isLVTT || String(lvttSubMode || 'termination') !== 'testing') setLvttTestFilter(null);
  }, [isLVTT, lvttSubMode]);

  // TABLE_INSTALLATION: küçük ve büyük masa sayaçları (masa = 2 panel üst üste)
  const [tableSmallCount, setTableSmallCount] = useState(0); // 2V14 küçük masalar
  const [tableBigCount, setTableBigCount] = useState(0);     // 2V27 büyük masalar
  // Panel eşleştirme: polygonId -> partnerId (üst üste duran paneller)
  const tipPanelPairsRef = useRef(new Map()); // Map<polygonId, partnerPolygonId>
  // LVIB: Box label data for rendering LV/INV text inside boxes
  const lvibBoxLabelsRef = useRef([]); // [{center: [lat, lng], label: 'LV'|'INV'}, ...]
  // LVIB: Sub-mode state (which box type is currently selectable)
  const [lvibSubMode, setLvibSubMode] = useState('lvBox'); // 'lvBox' | 'invBox'
  const lvibSubModeRef = useRef(lvibSubMode);
  useEffect(() => { lvibSubModeRef.current = lvibSubMode; }, [lvibSubMode]);
  // LVIB: Selected box IDs for each type
  const [lvibSelectedLvBoxes, setLvibSelectedLvBoxes] = useState(new Set());
  const [lvibSelectedInvBoxes, setLvibSelectedInvBoxes] = useState(new Set());
  const lvibSelectedLvBoxesRef = useRef(lvibSelectedLvBoxes);
  const lvibSelectedInvBoxesRef = useRef(lvibSelectedInvBoxes);
  useEffect(() => { lvibSelectedLvBoxesRef.current = lvibSelectedLvBoxes; }, [lvibSelectedLvBoxes]);
  useEffect(() => { lvibSelectedInvBoxesRef.current = lvibSelectedInvBoxes; }, [lvibSelectedInvBoxes]);

  // LVIB: repaint box layers when selections change so selected boxes turn green.
  useEffect(() => {
    if (!isLVIB) return;
    try {
      if (lvibLvBoxLayerRef.current) lvibLvBoxLayerRef.current.setStyle(lvibLvBoxLayerRef.current.options.style);
      if (lvibInvBoxLayerRef.current) lvibInvBoxLayerRef.current.setStyle(lvibInvBoxLayerRef.current.options.style);
    } catch (_e) {
      void _e;
    }
  }, [isLVIB, lvibSelectedLvBoxes, lvibSelectedInvBoxes]);
  // LVIB: Total box counts from geojson (feature count)
  const [lvibLvBoxTotal, setLvibLvBoxTotal] = useState(0);
  const [lvibInvBoxTotal, setLvibInvBoxTotal] = useState(0);
  // LVIB: Layer references for styling updates
  const lvibLvBoxLayerRef = useRef(null);
  const lvibInvBoxLayerRef = useRef(null);
  // LVIB: polygonId -> boxType mapping
  const lvibBoxTypeRef = useRef(new Map()); // Map<polygonId, 'lvBox'|'invBox'>

  const [totalPlus, setTotalPlus] = useState(0); // Total +DC Cable from CSV
  const [totalMinus, setTotalMinus] = useState(0); // Total -DC Cable from CSV
  const [completedPlus, setCompletedPlus] = useState(0); // Selected +DC Cable
  const [completedMinus, setCompletedMinus] = useState(0); // Selected -DC Cable
  const [modalOpen, setModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyOpenRef = useRef(false);
  useEffect(() => {
    historyOpenRef.current = Boolean(historyOpen);
  }, [historyOpen]);
  const [historySortBy, setHistorySortBy] = useState('date'); // 'date', 'workers', 'cable'
  const [historySortOrder, setHistorySortOrder] = useState('desc'); // 'asc', 'desc'

  // History editing mode states
  const [historySelectedRecordId, setHistorySelectedRecordId] = useState(null); // ID of selected record in history
  const historySelectedRecordIdRef = useRef(historySelectedRecordId);
  useEffect(() => {
    historySelectedRecordIdRef.current = historySelectedRecordId;
    // Also set on window for Leaflet click handlers (they run outside React's event system)
    window.__historySelectedRecordId = historySelectedRecordId;
  }, [historySelectedRecordId]);

  // Local editing state for history record polygons
  const [editingPolygonIds, setEditingPolygonIds] = useState([]);
  const editingPolygonIdsRef = useRef([]);
  useEffect(() => {
    editingPolygonIdsRef.current = editingPolygonIds;
    window.__editingPolygonIds = editingPolygonIds;
  }, [editingPolygonIds]);

  // Editing amount state (updated directly from click handler)
  const [editingAmountState, setEditingAmountState] = useState(0);
  useEffect(() => {
    window.__setEditingAmountState = setEditingAmountState;
  }, []);

  // Draggable history panel position
  const [historyPanelPos, setHistoryPanelPos] = useState({ x: 0, y: 0 });
  const [historyDragging, setHistoryDragging] = useState(false);
  const historyDragOffset = useRef({ x: 0, y: 0 });
  const historyPanelRef = useRef(null);

  // Note Mode state - PUNCH_LIST always starts in punch mode
  const [noteMode, setNoteMode] = useState(isPL);

  // PUNCH_LIST: Ensure punch mode is always active
  useEffect(() => {
    if (isPL && !noteMode) {
      setNoteMode(true);
    }
  }, [isPL, noteMode]);

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

  // ─────────────────────────────────────────────────────────────────
  // PUNCH LIST: Contractor (Taşeron) Management + Isometric View
  // ─────────────────────────────────────────────────────────────────
  const PL_CONTRACTORS_KEY = 'cew_pl_contractors';
  const PL_PUNCHES_KEY = 'cew_pl_punches';
  // Green (#22c55e) is reserved for completed punches - not available for contractors
  // 8 distinct, easily distinguishable colors (no green/teal tones)
  const DEFAULT_PUNCH_COLORS = [
    '#ef4444', // Red
    '#f97316', // Orange
    '#eab308', // Yellow
    '#3b82f6', // Blue
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#06b6d4', // Cyan
    '#78716c', // Stone/Gray
  ];

  // Special color for completed punches
  const PUNCH_COMPLETED_COLOR = '#22c55e';

  // Contractors: { id, name, color }
  // Contractors: { id, name, color }
  const [plContractors, setPlContractors] = useState([]);

  // Disciplines: { id, name } - loaded from types.txt
  const [plDisciplines, setPlDisciplines] = useState([]);

  // Currently selected discipline for new punches
  const [plSelectedDiscipline, setPlSelectedDiscipline] = useState('');

  // Discipline dropdown state (Live Filter)
  const [plDisciplineDropdownOpen, setPlDisciplineDropdownOpen] = useState(false);
  const [plSelectedDisciplineFilter, setPlSelectedDisciplineFilter] = useState(''); // '' = All

  // Multiple Punch Lists State
  const [plActiveListId, setPlActiveListId] = useState(null);
  const [plLists, setPlLists] = useState([]);
  const [plListDropdownOpen, setPlListDropdownOpen] = useState(false);

  // Punch list history (submitted snapshots)
  const [plHistory, setPlHistory] = useState([]);
  const plHistoryRef = useRef(plHistory);
  useEffect(() => { plHistoryRef.current = plHistory; }, [plHistory]);

  // Submit modal state
  const [plShowSubmitModal, setPlShowSubmitModal] = useState(false);
  const [plSubmitName, setPlSubmitName] = useState('');

  // All history view state
  const [plShowAllHistory, setPlShowAllHistory] = useState(false);

  // Punch List Summary Table State
  const [plSummarySortBy, setPlSummarySortBy] = useState('name'); // 'name' | 'createdAt' | 'updatedAt' | 'total' | 'open' | 'closed'
  const [plSummarySortOrder, setPlSummarySortOrder] = useState('asc'); // 'asc' | 'desc'
  const [plSummaryViewMode, setPlSummaryViewMode] = useState('summary'); // 'summary' | 'detail'

  // Load Config & Lists on mount (isPL)
  useEffect(() => {
    if (!isPL) return;
    let cancelled = false;

    const PL_LISTS_KEY = 'cew_pl_punchlists';
    const PL_ACTIVE_LIST_KEY = 'cew_pl_active_list';
    const OLD_PUNCHES_KEY = 'cew_pl_punches';

    (async () => {
      try {
        // Load CONFIG from TXT files (Contractors & Disciplines)
        try {
          // Fetch raw text files
          const [contractorRes, typeRes] = await Promise.all([
            fetch('/PUNCH_LIST/contractors.txt'),
            fetch('/PUNCH_LIST/types.txt')
          ]);

          if (contractorRes.ok) {
            const text = await contractorRes.text();
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const loadedContractors = lines.map((name, idx) => ({
              id: `c_${idx}`, // Simple ID
              name: name,
              color: DEFAULT_PUNCH_COLORS[idx % DEFAULT_PUNCH_COLORS.length]
            }));
            setPlContractors(loadedContractors);
          }

          if (typeRes.ok) {
            const text = await typeRes.text();
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const loadedDisciplines = lines.map((name, idx) => ({
              id: `d_${idx}`,
              name: name
            }));
            setPlDisciplines(loadedDisciplines);
          }
        } catch (err) {
          console.error('Failed to load Punch List config:', err);
        }

        // Load Lists from LocalStorage
        let lists = [];
        try {
          const raw = localStorage.getItem(PL_LISTS_KEY);
          lists = raw ? JSON.parse(raw) : [];
        } catch (e) { console.error('Failed to parse punch lists', e); }

        // Migration Check: Old single-list punches
        try {
          const oldPunchesRaw = localStorage.getItem(OLD_PUNCHES_KEY);
          if (oldPunchesRaw) {
            const oldPunches = JSON.parse(oldPunchesRaw);
            if (Array.isArray(oldPunches) && oldPunches.length > 0) {
              console.log('Migrating old punches to new list structure...');
              // Create new list "P1"
              const migrationListId = `list-${Date.now()}`;
              const p1 = {
                id: migrationListId,
                name: 'P1',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                punches: oldPunches.map(p => ({ ...p, punchListId: migrationListId }))
              };
              lists.push(p1);
              // Clear old key to prevent re-migration
              localStorage.removeItem(OLD_PUNCHES_KEY);
              // Save new structure
              localStorage.setItem(PL_LISTS_KEY, JSON.stringify(lists));
            }
          }
        } catch (e) {
          console.error('Migration failed', e);
        }

        // Initialize if empty
        let currentId = null;
        if (!lists || lists.length === 0) {
          const defaultList = {
            id: `list-${Date.now()}`,
            name: 'Punch List 1',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            punches: []
          };
          lists.push(defaultList);
          localStorage.setItem(PL_LISTS_KEY, JSON.stringify(lists));
          currentId = defaultList.id;
        } else {
          // Load active ID
          const savedActive = localStorage.getItem(PL_ACTIVE_LIST_KEY);
          if (savedActive && lists.find(l => l.id === savedActive)) {
            currentId = savedActive;
          } else {
            currentId = lists[0].id;
          }
        }

        setPlLists(lists);
        setPlActiveListId(currentId);
        localStorage.setItem(PL_ACTIVE_LIST_KEY, currentId);

        // Load History (Global for now - keep using DB for history if not requested to change, 
        // but user asked for "Refactor Punch List" to support multiple lists via localStorage. 
        // NOTE: User only specified PunchList and Punch models. 
        // We will leave history in DB for now to avoid breaking it, unless explicitly told to move history to LS too.)
        const history = await plDb.getAllHistory();
        if (cancelled) return;
        setPlHistory(history);

      } catch (err) {
        console.error('Failed to load punch list data:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isPL]);

  // Load Punches when Active List Changes (Sync from Memory/State)
  useEffect(() => {
    if (!isPL || !plActiveListId) return;

    const activeList = plLists.find(l => l.id === plActiveListId);
    const punches = activeList?.punches || [];

    // Only update if different (avoid loops if using object references carefully, strictly references might change so this is reactive)
    setPlPunches(punches);

    // Init counter from max existing punch number
    const maxNum = Math.max(0, ...punches.map(p => p.punchNumber || 0));
    setPlPunchCounter(prev => Math.max(prev, maxNum));

  }, [isPL, plActiveListId, plLists]);


  // Punch points: { id, lat, lng, contractorId, text, photoDataUrl, photoName, tableId?, createdAt, punchNumber, discipline }
  const [plPunches, setPlPunches] = useState([]);

  // Punch counter for permanent numbering - always starts from max existing punchNumber
  // Punch counter for permanent numbering - initialized from DB load
  const [plPunchCounter, setPlPunchCounter] = useState(0);

  // Ref to track current counter value for async handlers
  const plPunchCounterRef = useRef(plPunchCounter);

  // Keep counter ref in sync with state
  useEffect(() => {
    plPunchCounterRef.current = plPunchCounter;
  }, [plPunchCounter]);

  // Persist punch counter
  useEffect(() => {
    try {
      localStorage.setItem(PL_COUNTER_KEY, String(plPunchCounter));
    } catch (_e) {
      void _e;
    }
  }, [plPunchCounter]);

  // Currently selected contractor for new punches
  const [plSelectedContractorId, setPlSelectedContractorId] = useState(null);
  const plSelectedContractorIdRef = useRef(null); // Ref to track selected contractor for async handlers

  // Keep contractor ref in sync with state
  useEffect(() => {
    plSelectedContractorIdRef.current = plSelectedContractorId;
  }, [plSelectedContractorId]);

  // Contractor management dropdown state
  const [plContractorDropdownOpen, setPlContractorDropdownOpen] = useState(false);
  const plContractorDropdownOpenRef = useRef(false); // Ref to track dropdown state for async handlers
  const [plNewContractorName, setPlNewContractorName] = useState('');
  const [plNewContractorColor, setPlNewContractorColor] = useState(DEFAULT_PUNCH_COLORS[0]);
  const [plShowAddContractorForm, setPlShowAddContractorForm] = useState(false); // Show add form when contractors exist

  // Ref to capture hamburger menu state at mousedown time (before App.jsx closes it)
  const plHamburgerWasOpenOnMouseDownRef = useRef(false);

  // History Panel State (Draggable)
  const [plHistoryPos, setPlHistoryPos] = useState({ x: 100, y: 100 });
  const [plViewingHistoryId, setPlViewingHistoryId] = useState(null); // ID of punch list being viewed in detail
  const plHistoryDragStart = useCallback((e) => {
    if (e.button !== 0) return; // Left click only
    // e.preventDefault(); // Don't prevent default immediately if interacting with content? No, header drag needs preventDefault to avoid selection
    // But we attach this to header.

    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = plHistoryPos.x;
    const startTop = plHistoryPos.y;

    const onMouseMove = (ev) => {
      ev.preventDefault();
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setPlHistoryPos({ x: startLeft + dx, y: startTop + dy });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [plHistoryPos]);

  // Keep ref in sync with state
  useEffect(() => {
    plContractorDropdownOpenRef.current = plContractorDropdownOpen;
  }, [plContractorDropdownOpen]);

  // Isometric view state (when clicking a table)
  const [plIsometricTableId, setPlIsometricTableId] = useState(null); // tableId being viewed
  const [plIsometricOpen, setPlIsometricOpen] = useState(false);

  // Punch editing popup
  const [plEditingPunch, setPlEditingPunch] = useState(null); // punch object being edited
  const [plPunchText, setPlPunchText] = useState('');
  const [plPunchContractorId, setPlPunchContractorId] = useState(null);
  const [plPunchDiscipline, setPlPunchDiscipline] = useState(''); // NEW: discipline for edit popup
  const [plPunchPhotoDataUrl, setPlPunchPhotoDataUrl] = useState(null);
  const [plPunchPhotoName, setPlPunchPhotoName] = useState('');
  const [plPopupPosition, setPlPopupPosition] = useState(null); // {x, y} screen coords for dynamic positioning

  const plPunchPhotoInputRef = useRef(null);
  const plPunchMarkersRef = useRef({}); // id -> marker
  const plIsoInnerRef = useRef(null); // ref for isometric inner container (for fit button)

  // Selected punches (for box selection and deletion)
  const [plSelectedPunches, setPlSelectedPunches] = useState(new Set());

  // Drag state for moving punches
  const plDraggingPunchRef = useRef(null); // { punchId, startLatLng, marker }


  // Contractor management is now READ-ONLY from TXT file
  // No add/remove/update functions needed.


  // Get contractor by ID
  const plGetContractor = useCallback((contractorId) => {
    return plContractors.find(c => c.id === contractorId) || null;
  }, [plContractors]);

  // Helper: Switch List
  const plSwitchList = useCallback(async (listId) => {
    // Punches derived from list
    setPlActiveListId(listId);
    setPlListDropdownOpen(false);
    localStorage.setItem('cew_pl_active_list', listId);

    // Sync punches state to the active list
    const found = plLists.find(l => l.id === listId);
    if (found) {
      setPlPunches(found.punches || []);
    } else {
      setPlPunches([]);
    }
  }, [plLists]);

  // Helper: Create New List
  const plCreateNewList = useCallback(async () => {
    const name = prompt('Enter new Punch List name:', `Punch List ${plLists.length + 1}`);
    if (!name) return;
    const newList = { id: `list-${Date.now()}`, name, createdAt: Date.now(), updatedAt: Date.now(), punches: [] };

    // Update State
    const nextLists = [...plLists, newList];
    setPlLists(nextLists);
    setPlActiveListId(newList.id);
    setPlListDropdownOpen(false);

    // Save to LS
    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));
    localStorage.setItem('cew_pl_active_list', newList.id);
  }, [plLists]);

  // Punch List Edit Menu State
  const [plEditingListId, setPlEditingListId] = useState(null); // ID of list being edited (shows mini-menu)

  // Close edit menu when dropdown closes
  useEffect(() => {
    if (!plListDropdownOpen) {
      setPlEditingListId(null);
    }
  }, [plListDropdownOpen]);

  // Helper: Rename List
  const plRenameList = useCallback((listId) => {
    const list = plLists.find(l => l.id === listId);
    if (!list) return;
    const newName = prompt('Listeyi yeniden adlandır:', list.name);
    if (!newName || newName.trim() === '' || newName.trim() === list.name) {
      setPlEditingListId(null);
      return;
    }
    const nextLists = plLists.map(l =>
      l.id === listId ? { ...l, name: newName.trim(), updatedAt: Date.now() } : l
    );
    setPlLists(nextLists);
    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));
    setPlEditingListId(null);
  }, [plLists]);

  // Helper: Delete List (with confirmation and auto-switch logic)
  const plDeleteList = useCallback((listId) => {
    const list = plLists.find(l => l.id === listId);
    if (!list) return;

    // Confirmation dialog (Turkish per user request)
    if (!window.confirm(`Bu Punch List silinsin mi?\n\n"${list.name}" ve içindeki tüm punch'lar kalıcı olarak silinecek.`)) {
      setPlEditingListId(null);
      return;
    }

    // Remove the list
    const nextLists = plLists.filter(l => l.id !== listId);

    // Auto-switch logic
    let nextActiveId = plActiveListId;
    if (listId === plActiveListId) {
      // Deleted the active list - switch to first available or null
      if (nextLists.length > 0) {
        nextActiveId = nextLists[0].id;
      } else {
        nextActiveId = null;
      }
    }

    setPlLists(nextLists);
    setPlActiveListId(nextActiveId);
    setPlEditingListId(null);
    setPlListDropdownOpen(false);

    // Update punches to reflect new active list
    if (nextActiveId) {
      const newActiveList = nextLists.find(l => l.id === nextActiveId);
      setPlPunches(newActiveList?.punches || []);
    } else {
      setPlPunches([]);
    }

    // Persist to localStorage
    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));
    if (nextActiveId) {
      localStorage.setItem('cew_pl_active_list', nextActiveId);
    } else {
      localStorage.removeItem('cew_pl_active_list');
    }
  }, [plLists, plActiveListId]);

  // Create punch point (no popup on create - user clicks on dot to edit)
  // Returns null if no contractor selected (caller should show warning)
  const plCreatePunch = useCallback(async (latlng, tableId = null) => {
    // Must have contractor selected - use ref for current value
    // Allow punch creation without contractor (will set to null/undefined)
    const contractorId = plSelectedContractorIdRef.current || null;
    if (!plActiveListId) {
      alert('No active punch list selected');
      return null;
    }

    // Get next punch number using ref (always current) and increment both ref and state
    const nextNumber = plPunchCounterRef.current + 1;
    plPunchCounterRef.current = nextNumber; // Update ref immediately for next call
    setPlPunchCounter(nextNumber); // Update state for persistence

    const punch = {
      id: `punch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      lat: latlng.lat,
      lng: latlng.lng,
      contractor: contractorId, // Changed to 'contractor' per DATA MODEL
      contractorId: contractorId, // Keep for backward compat/UI logic if needed, but model says 'contractor'
      punchListId: plActiveListId,
      discipline: plSelectedDiscipline || null, // null per model
      text: '', // description
      description: '', // Model says 'description'
      photo: null, // Model says 'photo'
      photoDataUrl: null, // UI uses this
      photoName: '',
      tableId: tableId || null,
      createdAt: Date.now(), // timestamp per model
      punchNumber: nextNumber,
      status: 'open', // Model says 'status': 'open' | 'closed'
      completed: false, // UI uses this
      updatedAt: Date.now()
    };

    // Update List logic
    const nextLists = plLists.map(l => {
      if (l.id === plActiveListId) {
        return { ...l, punches: [...(l.punches || []), punch], updatedAt: Date.now() };
      }
      return l;
    });
    setPlLists(nextLists);
    setPlPunches(prev => [...prev, punch]);

    // Save to LS
    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));

    return punch;
    return punch;
  }, [plSelectedDiscipline, plActiveListId, plLists]);

  // Keep plCreatePunch ref in sync for map click handler (which has empty dependency array)
  const plCreatePunchRef = useRef(plCreatePunch);
  useEffect(() => {
    plCreatePunchRef.current = plCreatePunch;
  }, [plCreatePunch]);


  // Move punch to new location
  // Move punch to new location
  const plMovePunch = useCallback(async (punchId, newLatLng) => {
    // Update Lists Logic
    const nextLists = plLists.map(l => {
      if (l.id === plActiveListId) {
        const newPunches = (l.punches || []).map(p => {
          if (p.id === punchId) {
            return { ...p, lat: newLatLng.lat, lng: newLatLng.lng, updatedAt: Date.now() };
          }
          return p;
        });
        return { ...l, punches: newPunches, updatedAt: Date.now() };
      }
      return l;
    });

    setPlLists(nextLists);
    // Update local UI state
    const currentList = nextLists.find(l => l.id === plActiveListId);
    if (currentList) setPlPunches(currentList.punches);

    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));
  }, [plPunches, plActiveListId, plLists]);

  // Delete multiple punches (for selection delete)
  const plDeleteSelectedPunches = useCallback(async () => {
    if (plSelectedPunches.size === 0) return;
    const count = plSelectedPunches.size;
    if (!window.confirm(`Are you sure you want to delete ${count} selected punch item${count > 1 ? 's' : ''}?`)) return;

    // Update Lists Logic
    const nextLists = plLists.map(l => {
      if (l.id === plActiveListId) {
        const newPunches = (l.punches || []).filter(p => !plSelectedPunches.has(p.id));
        return { ...l, punches: newPunches, updatedAt: Date.now() };
      }
      return l;
    });
    setPlLists(nextLists);

    // Update local UI
    const currentList = nextLists.find(l => l.id === plActiveListId);
    if (currentList) setPlPunches(currentList.punches);

    if (plEditingPunch && plSelectedPunches.has(plEditingPunch.id)) {
      setPlEditingPunch(null);
    }
    setPlSelectedPunches(new Set());

    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));
  }, [plSelectedPunches, plEditingPunch, plLists, plActiveListId]);

  // Delete single punch with legend sync
  const plDeleteSinglePunch = useCallback((punchId) => {
    if (!punchId || !plActiveListId) return;

    // Find the punch to get its contractor
    const punch = plPunches.find(p => p.id === punchId);
    if (!punch) return;

    // Confirm deletion
    if (!window.confirm(`Bu punch silinsin mi?\n\nPunch #${punch.punchNumber || '?'} kalıcı olarak silinecek.`)) {
      return;
    }

    const deletedContractorId = punch.contractorId || punch.contractor;

    // Remove the punch from lists
    const nextLists = plLists.map(l => {
      if (l.id === plActiveListId) {
        const newPunches = (l.punches || []).filter(p => p.id !== punchId);
        return { ...l, punches: newPunches, updatedAt: Date.now() };
      }
      return l;
    });

    setPlLists(nextLists);

    // Update local punches
    const currentList = nextLists.find(l => l.id === plActiveListId);
    const remainingPunches = currentList?.punches || [];
    setPlPunches(remainingPunches);

    // Legend sync: Check if this was the last punch for this contractor
    // Note: Legend sync is handled automatically via the plPunches state
    // which filters contractors shown based on punches in the active list

    // Clear selection if deleted punch was selected
    if (plSelectedPunches.has(punchId)) {
      setPlSelectedPunches(prev => {
        const next = new Set(prev);
        next.delete(punchId);
        return next;
      });
    }

    // Close edit popup if editing this punch
    if (plEditingPunch?.id === punchId) {
      setPlEditingPunch(null);
    }

    // Save to localStorage
    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));
  }, [plPunches, plActiveListId, plLists, plSelectedPunches, plEditingPunch]);

  // Highlight punch on map (pan to location and apply glow effect)
  const plHighlightPunchOnMap = useCallback((punch) => {
    if (!punch || !mapRef.current) return;

    // Get lat/lng
    const lat = punch.lat;
    const lng = punch.lng;

    if (!lat || !lng) {
      // Isometric punch - no map location
      console.log('Punch has no map coordinates (isometric punch)');
      return;
    }

    // Pan to location
    mapRef.current.flyTo([lat, lng], 18, { duration: 0.5 });

    // Find the marker layer and apply highlight
    setTimeout(() => {
      // Find punch marker by looking for the punch ID in the layer
      mapRef.current.eachLayer((layer) => {
        if (layer._punchId === punch.id || layer.options?.punchId === punch.id) {
          // Apply highlight class
          const el = layer.getElement?.() || layer._icon;
          if (el) {
            el.classList.add('punch-marker-highlight');
            setTimeout(() => el.classList.remove('punch-marker-highlight'), 3000);
          }
        }
      });

      // Also add a temporary highlight circle
      const highlightCircle = L.circleMarker([lat, lng], {
        radius: 25,
        color: '#fbbf24',
        weight: 3,
        opacity: 1,
        fillOpacity: 0,
        className: 'punch-highlight-ring'
      }).addTo(mapRef.current);

      // Remove after animation
      setTimeout(() => {
        if (mapRef.current.hasLayer(highlightCircle)) {
          mapRef.current.removeLayer(highlightCircle);
        }
      }, 2500);
    }, 600);
  }, []);

  // Save punch
  const plSavePunch = useCallback(async () => {
    if (!plEditingPunch) return;
    const updated = {
      ...plEditingPunch,
      text: plPunchText,
      description: plPunchText, // Sync fields
      contractor: plPunchContractorId,
      contractorId: plPunchContractorId,
      discipline: plPunchDiscipline,
      photo: plPunchPhotoDataUrl,
      photoDataUrl: plPunchPhotoDataUrl,
      photoName: plPunchPhotoName,
      updatedAt: Date.now()
    };

    // Update Lists
    const nextLists = plLists.map(l => {
      if (l.id === plActiveListId) {
        const newPunches = (l.punches || []).map(p => p.id === plEditingPunch.id ? updated : p);
        return { ...l, punches: newPunches, updatedAt: Date.now() };
      }
      return l;
    });
    setPlLists(nextLists);

    // Update UI
    const currentList = nextLists.find(l => l.id === plActiveListId);
    if (currentList) setPlPunches(currentList.punches);

    setPlEditingPunch(null);
    setPlPunchText('');
    setPlPunchContractorId(null);
    setPlPunchDiscipline('');
    setPlPunchPhotoDataUrl(null);
    setPlPunchPhotoName('');

    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));
  }, [plEditingPunch, plPunchText, plPunchContractorId, plPunchDiscipline, plPunchPhotoDataUrl, plPunchPhotoName, plLists, plActiveListId]);


  // Delete punch
  const plDeletePunch = useCallback(async (punchId) => {
    if (!window.confirm('Are you sure you want to delete this punch item?')) return;

    // Update Lists
    const nextLists = plLists.map(l => {
      if (l.id === plActiveListId) {
        const newPunches = (l.punches || []).filter(p => p.id !== punchId);
        return { ...l, punches: newPunches, updatedAt: Date.now() };
      }
      return l;
    });
    setPlLists(nextLists);

    // Update UI
    const currentList = nextLists.find(l => l.id === plActiveListId);
    if (currentList) setPlPunches(currentList.punches);

    if (plEditingPunch?.id === punchId) {
      setPlEditingPunch(null);
    }

    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));
  }, [plEditingPunch, plLists, plActiveListId]);

  // Mark punch as completed (done)
  const plMarkPunchCompleted = useCallback(async (punchId) => {
    // if (!window.confirm('Are you sure you want to mark this punch as completed?')) return; // Check if user wants generic confirmation
    // Original had confirmation, keeping it? User said "remove command confirmation" earlier for *commands*, but this is module logic.
    // Keeping confirmation for safety unless user complained about it here specifically.

    // Update Lists
    const nextLists = plLists.map(l => {
      if (l.id === plActiveListId) {
        const newPunches = (l.punches || []).map(p => {
          if (p.id === punchId) {
            return { ...p, completed: true, status: 'closed', completedAt: Date.now(), updatedAt: Date.now() };
          }
          return p;
        });
        return { ...l, punches: newPunches, updatedAt: Date.now() };
      }
      return l;
    });
    setPlLists(nextLists);

    // Update UI
    const currentList = nextLists.find(l => l.id === plActiveListId);
    if (currentList) setPlPunches(currentList.punches);

    // Close popup if this punch is being edited
    if (plEditingPunch?.id === punchId) {
      setPlEditingPunch(null);
      setPlPunchText('');
      setPlPunchContractorId(null);
      setPlPunchPhotoDataUrl(null);
      setPlPunchPhotoName('');
    }

    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));
  }, [plEditingPunch, plPunches, plLists, plActiveListId]);

  // Mark punch as uncompleted
  const plMarkPunchUncompleted = useCallback(async (punchId) => {
    if (!window.confirm('Are you sure you want to mark this punch as incomplete?')) return;

    // Update Lists
    const nextLists = plLists.map(l => {
      if (l.id === plActiveListId) {
        const newPunches = (l.punches || []).map(p => {
          if (p.id === punchId) {
            return { ...p, completed: false, status: 'open', completedAt: null, updatedAt: Date.now() };
          }
          return p;
        });
        return { ...l, punches: newPunches, updatedAt: Date.now() };
      }
      return l;
    });
    setPlLists(nextLists);

    // Update UI
    const currentList = nextLists.find(l => l.id === plActiveListId);
    if (currentList) setPlPunches(currentList.punches);

    localStorage.setItem('cew_pl_punchlists', JSON.stringify(nextLists));
  }, [plPunches, plLists, plActiveListId]);

  // Toggle punch status (Used in History Table)
  const plTogglePunchStatus = useCallback(async (historyRecordId, punchId) => {
    if (!historyRecordId || !punchId) return;
    try {
      const record = await plDb.history.get(historyRecordId);
      if (!record) return;
      const punches = record.punches || [];
      const idx = punches.findIndex(p => p.id === punchId);
      if (idx === -1) return;

      // Toggle status
      punches[idx].completed = !punches[idx].completed;
      if (punches[idx].completed) {
        punches[idx].completedAt = new Date().toISOString();
      } else {
        punches[idx].completedAt = null;
      }

      // Update counts
      record.openCount = punches.filter(p => !p.completed).length;
      record.closedCount = punches.filter(p => p.completed).length;
      record.updatedAt = new Date().toISOString();

      await plDb.history.put(record);

      // Update State
      setPlHistory(prev => prev.map(r => r.id === historyRecordId ? record : r));
    } catch (err) {
      console.error('Failed to toggle punch status', err);
    }
  }, []);

  // Map Markers Rendering (Live Filter)
  const plMarkersRef = useRef(null);
  useEffect(() => {
    // SOFT DISABLE - PENDING REMOVAL
    // This loop (Loop A) is redundant and causes the "opaque ghosting" bug.
    // Loop B (lines ~8000+) handles all marker rendering correctly.
    if (true) {
      if (plMarkersRef.current) {
        plMarkersRef.current.clearLayers();
        plMarkersRef.current.remove();
        plMarkersRef.current = null;
      }
      return;
    }

    if (!isPL || !mapRef.current) {
      if (plMarkersRef.current) {
        plMarkersRef.current.clearLayers();
        plMarkersRef.current.remove();
        plMarkersRef.current = null;
      }
      return;
    }

    if (!plMarkersRef.current) {
      plMarkersRef.current = L.layerGroup().addTo(mapRef.current);
    }
    const layer = plMarkersRef.current;
    layer.clearLayers();

    plPunches.forEach(p => {
      // Filter Logic (Live)
      if (plSelectedDisciplineFilter && p.discipline !== plSelectedDisciplineFilter) return;

      const c = plGetContractor(p.contractorId);
      const color = p.completed ? PUNCH_COMPLETED_COLOR : (c?.color || '#888');

      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 7,
        fillColor: color,
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 1
      });
      marker.bindTooltip(`contractor: ${c?.name || 'Unknown'}\ndiscipline: ${p.discipline || '-'}\n${p.text || ''}`, { direction: 'top', offset: [0, -6] });
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setPlEditingPunch(p);
        setPlPunchText(p.text || '');
        setPlPunchContractorId(p.contractorId);
        setPlPunchDiscipline(p.discipline || '');
        setPlPunchPhotoDataUrl(p.photoDataUrl || null);
        setPlPunchPhotoName(p.photoName || '');
      });
      layer.addLayer(marker);
    });
  }, [isPL, plPunches, plSelectedDisciplineFilter, plContractors, plGetContractor]);

  // Photo lightbox state for enlarged view
  const [plPhotoLightbox, setPlPhotoLightbox] = useState(null); // { url, name, x, y }

  // Handle punch photo selection
  const handlePlPunchPhotoSelected = useCallback((file) => {
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }
    const maxBytes = 1.5 * 1024 * 1024;
    if (file.size > maxBytes) {
      alert('Image is too large. Please select an image under 1.5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (dataUrl) {
        setPlPunchPhotoDataUrl(dataUrl);
        setPlPunchPhotoName(file.name || '');
      }
    };
    reader.readAsDataURL(file);
  }, []);

  // Submit punch list to history (creates snapshot without clearing punches)
  const plSubmitPunchList = useCallback(async () => {
    const name = plSubmitName?.trim();
    if (!name) {
      alert('Please enter a punch list name.');
      return false;
    }

    if (plPunches.length === 0) {
      alert('No punches to submit.');
      return false;
    }

    const historyRecord = {
      id: `history-${Date.now()}`,
      name: name,
      punchListId: plActiveListId, // Link to active list
      punches: JSON.parse(JSON.stringify(plPunches)), // Deep clone
      contractors: JSON.parse(JSON.stringify(plContractors)),
      disciplines: JSON.parse(JSON.stringify(plDisciplines)),
      openCount: plPunches.filter(p => !p.completed).length,
      closedCount: plPunches.filter(p => p.completed).length,
      createdAt: new Date().toISOString(),
    };

    try {
      await plDb.saveHistoryRecord(historyRecord);
      setPlHistory(prev => [historyRecord, ...prev]);
      setPlShowSubmitModal(false);
      setPlSubmitName('');
      alert('Punch list submitted successfully!');
      return true;
    } catch (err) {
      console.error('Failed to submit punch list:', err);
      alert('Failed to submit punch list.');
      return false;
    }
  }, [plSubmitName, plPunches, plContractors, plDisciplines, plActiveListId]);

  // Export current punch list
  const plExportCurrentList = useCallback(async (format = 'excel') => {
    if (plPunches.length === 0) {
      alert('No punches to export.');
      return;
    }

    const record = {
      name: 'Current Punch List',
      punches: plPunches,
      createdAt: new Date().toISOString(),
    };

    try {
      if (format === 'pdf') {
        await plExportToPdf(record);
      } else {
        await plExportToExcel(record);
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    }
  }, [plPunches]);

  // Export a history record
  const plExportHistoryRecord = useCallback(async (historyId, format = 'excel') => {
    const record = plHistoryRef.current.find(h => h.id === historyId);
    if (!record) {
      alert('History record not found.');
      return;
    }

    try {
      if (format === 'pdf') {
        await plExportToPdf(record);
      } else {
        await plExportToExcel(record);
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    }
  }, []);

  // Export all history summary
  const plExportAllHistorySummary = useCallback(async (format = 'excel') => {
    const history = plHistoryRef.current;
    if (history.length === 0) {
      alert('No history to export.');
      return;
    }

    try {
      if (format === 'pdf') {
        await plExportAllHistoryToPdf(history);
      } else {
        await plExportAllHistoryToExcel(history);
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    }
  }, []);


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
      return {
        past: [...s.past, s.present].slice(-NOTES_HISTORY_LIMIT),
        present: next,
        future: [],
      };
    });
  };

  const undoNotes = () => {
    setNotesState((s) => {
      if (s.past.length === 0) return s;
      const previous = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        present: previous,
        future: [s.present, ...s.future].slice(0, NOTES_HISTORY_LIMIT),
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
  const polygonClickedRef = useRef(false); // Track if a polygon click was already handled by layer events

  // LV: inv_id daily completion tracking (click inv_id labels to mark completed for today)
  const getTodayYmd = () => new Date().toISOString().split('T')[0];
  const lvTodayYmd = getTodayYmd();
  const lvStorageKey = `cew:lv:inv_completed:${lvTodayYmd}`;
  const [lvCompletedInvIds, setLvCompletedInvIds] = useState(() => new Set());
  const lvCompletedInvIdsRef = useRef(lvCompletedInvIds);
  const lvInvLabelByIdRef = useRef({}); // invIdNorm -> L.TextLabel
  const lvInvLatLngByIdRef = useRef({}); // invIdNorm -> L.LatLng
  const lvInvGridRef = useRef(new Map()); // cellKey -> string[] invIdNorm
  const lvBoxLayersByInvIdRef = useRef({}); // invIdNorm -> L.Layer[] (lv_box geometries)
  const lvAllBoxLayersRef = useRef([]); // L.Layer[] (all lv_box layers for reset)
  const prevHistoryInvHighlightRef = useRef(new Set()); // invIdNorms highlighted by history selection
  const prevHistoryMc4InvHighlightRef = useRef(new Set()); // invIdNorms highlighted by history selection (MC4)
  const prevHistoryDcttInvHighlightRef = useRef(new Set()); // invIdNorms highlighted by history selection (DCTT)
  const prevHistoryDcttPanelHighlightRef = useRef(new Set()); // panelIds highlighted by history selection (DCTT)

  // LVTT: history selection highlight (orange) for SS/SUB labels
  const lvttHistoryHighlightSubSetRef = useRef(new Set()); // Set<subNorm>

  // LV: Track submitted/committed inv_id entries (locked until history record is deleted)
  const [lvCommittedInvIds, setLvCommittedInvIds] = useState(() => new Set());
  const lvCommittedInvIdsRef = useRef(lvCommittedInvIds);

  useEffect(() => {
    lvCompletedInvIdsRef.current = lvCompletedInvIds;
  }, [lvCompletedInvIds]);

  // LV: rebuild a simple spatial index for inv_id positions so we can match LV boxes to inv_ids efficiently.
  useEffect(() => {
    if (!isLV) return;
    const byId = lvInvLatLngByIdRef.current || {};
    const grid = new Map();
    const cellKey = (lat, lng) => {
      const cx = Math.floor(lng / LV_INV_BOX_GRID_DEG);
      const cy = Math.floor(lat / LV_INV_BOX_GRID_DEG);
      return `${cx}:${cy}`;
    };
    Object.keys(byId).forEach((invIdNorm) => {
      const ll = byId[invIdNorm];
      if (!ll) return;
      const key = cellKey(ll.lat, ll.lng);
      const arr = grid.get(key);
      if (arr) arr.push(invIdNorm);
      else grid.set(key, [invIdNorm]);
    });
    lvInvGridRef.current = grid;
  }, [isLV, lvCompletedInvIds]);

  useEffect(() => {
    lvCommittedInvIdsRef.current = lvCommittedInvIds;
  }, [lvCommittedInvIds]);

  // HARD GUARANTEE (LV):
  // Once an inv_id is submitted (committed), it must NEVER be removed from lvCompletedInvIds
  // until its history record is deleted (🗑️).
  useEffect(() => {
    if (!isLV) return;
    const committed = lvCommittedInvIdsRef.current || lvCommittedInvIds;
    if (!committed || committed.size === 0) return;

    setLvCompletedInvIds((prev) => {
      let missing = false;
      committed.forEach((id) => {
        if (!prev.has(id)) missing = true;
      });
      if (!missing) return prev;
      const next = new Set(prev);
      committed.forEach((id) => next.add(id));
      return next;
    });
  }, [isLV, lvCompletedInvIds, lvCommittedInvIds]);

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
    // Keep committed polygons locked unless their history record is deleted.
    setSelectedPolygons(new Set(committedPolygonsRef.current || []));
  }, [isLV, lvStorageKey]);

  useEffect(() => {
    if (!isLV) return;
    try {
      localStorage.setItem(lvStorageKey, JSON.stringify(Array.from(lvCompletedInvIds)));
    } catch (_e) {
      void _e;
    }
  }, [isLV, lvStorageKey, lvCompletedInvIds]);

  // PTEP: Sub-mode selection (like MC4) - 'tabletotable' or 'parameter'
  const [ptepSubMode, setPtepSubMode] = useState('tabletotable'); // 'tabletotable' | 'parameter'
  const ptepSubModeRef = useRef(ptepSubMode);
  useEffect(() => {
    ptepSubModeRef.current = ptepSubMode;
  }, [ptepSubMode]);

  // PTEP: table-to-table completion tracking (click lines to mark completed)
  const ptepTodayYmd = getTodayYmd();
  const ptepStorageKeyTT = `cew:ptep:tabletotable:${ptepTodayYmd}`;
  const ptepStorageKeyParam = `cew:ptep:parameter:${ptepTodayYmd}`;
  const ptepStorageKeyParamParts = `cew:ptep:parameter_parts:${ptepTodayYmd}`;
  const [ptepCompletedTableToTable, setPtepCompletedTableToTable] = useState(() => new Set());
  const ptepCompletedTableToTableRef = useRef(ptepCompletedTableToTable);
  const [ptepTotalTableToTable, setPtepTotalTableToTable] = useState(0);
  const ptepTableToTableByIdRef = useRef({}); // uniqueId -> featureLayer

  // PTEP: Undo/Redo history for table-to-table
  const ptepTTHistoryRef = useRef({ past: [], future: [] });
  const ptepTTPrevSnapshotRef = useRef([]);
  const ptepTTHistorySuspendRef = useRef(false);
  const [ptepTTHistoryTick, setPtepTTHistoryTick] = useState(0);

  // PTEP: parameter completion tracking (MVF-style partial selection: store selected PART geometries)
  // parts: [{ id, uid, lineIndex, startM, endM, coords:[[lat,lng],...], meters }]
  const [ptepSelectedParameterParts, setPtepSelectedParameterParts] = useState(() => []);
  const ptepSelectedParameterPartsRef = useRef(ptepSelectedParameterParts);
  const ptepParameterSelectedLayerRef = useRef(null); // L.LayerGroup for selected green parts
  const ptepLegacyCompletedParameterIdsRef = useRef(null); // Set<string> | null (migration from old full-line IDs)
  const [ptepTotalParameterMeters, setPtepTotalParameterMeters] = useState(0);
  const ptepParameterByIdRef = useRef({}); // uniqueId -> featureLayer
  const ptepParameterLenByIdRef = useRef({}); // uniqueId -> length in meters

  // PTEP: Undo/Redo history for parameter parts
  const ptepParamHistoryRef = useRef({ past: [], future: [] });
  const ptepParamPrevSnapshotRef = useRef([]);
  const ptepParamHistorySuspendRef = useRef(false);
  const [ptepParamHistoryTick, setPtepParamHistoryTick] = useState(0);

  // ======== DATP (DC&AC Trench Progress) ========
  // Storage key for persistence
  const datpStorageKey = `datp_completed_parts_${String(activeMode?.key || 'DATP')}`;
  // parts: [{ id, uid, lineIndex, startM, endM, coords:[[lat,lng],...], meters }]
  const [datpSelectedTrenchParts, setDatpSelectedTrenchParts] = useState(() => []);
  const datpSelectedTrenchPartsRef = useRef(datpSelectedTrenchParts);
  const datpTrenchSelectedLayerRef = useRef(null); // L.LayerGroup for selected green parts
  const [datpTotalTrenchMeters, setDatpTotalTrenchMeters] = useState(0);
  const datpTrenchByIdRef = useRef({}); // uniqueId -> featureLayer
  const datpTrenchLenByIdRef = useRef({}); // uniqueId -> length in meters
  const datpSvgRendererRef = useRef(null); // dedicated SVG renderer for trench lines

  // DATP: Undo/Redo history for trench parts
  const datpHistoryRef = useRef({ past: [], future: [] });
  const datpPrevSnapshotRef = useRef([]);
  const datpHistorySuspendRef = useRef(false);
  const [datpHistoryTick, setDatpHistoryTick] = useState(0);

  // ======== MVFT (MV&Fibre Trench Progress) ========
  // Storage key for persistence
  // Committed (submitted) parts persist under this key.
  const mvftStorageKey = `mvft_completed_parts_${String(activeMode?.key || 'MVFT')}`;
  // Draft (selected but not yet submitted) parts persist separately.
  const mvftDraftStorageKey = `mvft_selected_parts_${String(activeMode?.key || 'MVFT')}`;
  // parts: [{ id, uid, lineIndex, startM, endM, coords:[[lat,lng],...], meters }]
  const [mvftSelectedTrenchParts, setMvftSelectedTrenchParts] = useState(() => []); // draft
  const mvftSelectedTrenchPartsRef = useRef(mvftSelectedTrenchParts);
  const mvftTrenchSelectedLayerRef = useRef(null); // L.LayerGroup for selected green parts
  const [mvftCommittedTrenchParts, setMvftCommittedTrenchParts] = useState(() => []);
  const mvftCommittedTrenchPartsRef = useRef(mvftCommittedTrenchParts);
  const mvftTrenchCommittedLayerRef = useRef(null);
  const mvftHistoryHighlightLayerRef = useRef(null);
  const [mvftTotalTrenchMeters, setMvftTotalTrenchMeters] = useState(0);
  const mvftTrenchByIdRef = useRef({}); // uniqueId -> featureLayer
  const mvftTrenchLenByIdRef = useRef({}); // uniqueId -> length in meters
  const mvftSvgRendererRef = useRef(null); // dedicated SVG renderer for trench lines

  // MVFT: Undo/Redo history for trench parts
  const mvftHistoryRef = useRef({ past: [], future: [] });
  const mvftPrevSnapshotRef = useRef([]);
  const mvftHistorySuspendRef = useRef(false);
  const [mvftHistoryTick, setMvftHistoryTick] = useState(0);

  useEffect(() => {
    ptepCompletedTableToTableRef.current = ptepCompletedTableToTable;
  }, [ptepCompletedTableToTable]);

  useEffect(() => {
    ptepSelectedParameterPartsRef.current = ptepSelectedParameterParts;
  }, [ptepSelectedParameterParts]);

  useEffect(() => {
    datpSelectedTrenchPartsRef.current = datpSelectedTrenchParts;
  }, [datpSelectedTrenchParts]);

  // Track DATP trench parts changes for undo/redo
  useEffect(() => {
    if (!isDATP) return;
    if (datpHistorySuspendRef.current) return;
    const current = JSON.stringify(datpSelectedTrenchParts || []);
    const prev = JSON.stringify(datpPrevSnapshotRef.current || []);
    if (current === prev) return;
    datpHistoryRef.current.past = [...datpHistoryRef.current.past, datpPrevSnapshotRef.current || []].slice(-HISTORY_LIMIT);
    datpHistoryRef.current.future = [];
    datpPrevSnapshotRef.current = datpSelectedTrenchParts || [];
    setDatpHistoryTick((t) => t + 1);
  }, [isDATP, datpSelectedTrenchParts]);

  // MVFT: Undo/Redo history for trench parts
  useEffect(() => {
    if (!isMVFT) return;
    if (mvftHistorySuspendRef.current) return;
    const current = JSON.stringify(mvftSelectedTrenchParts || []);
    const prev = JSON.stringify(mvftPrevSnapshotRef.current || []);
    if (current === prev) return;
    mvftHistoryRef.current.past = [...mvftHistoryRef.current.past, mvftPrevSnapshotRef.current || []].slice(-HISTORY_LIMIT);
    mvftHistoryRef.current.future = [];
    mvftPrevSnapshotRef.current = mvftSelectedTrenchParts || [];
    setMvftHistoryTick((t) => t + 1);
  }, [isMVFT, mvftSelectedTrenchParts]);

  // Track PTEP table-to-table changes for undo/redo
  useEffect(() => {
    if (!isPTEP) return;
    if (ptepTTHistorySuspendRef.current) return;
    const current = Array.from(ptepCompletedTableToTable || new Set()).sort();
    const prev = ptepTTPrevSnapshotRef.current || [];
    if (JSON.stringify(current) === JSON.stringify(prev)) return;
    ptepTTHistoryRef.current.past = [...ptepTTHistoryRef.current.past, prev].slice(-HISTORY_LIMIT);
    ptepTTHistoryRef.current.future = [];
    ptepTTPrevSnapshotRef.current = current;
    setPtepTTHistoryTick((t) => t + 1);
  }, [isPTEP, ptepCompletedTableToTable]);

  // Track PTEP parameter parts changes for undo/redo
  useEffect(() => {
    if (!isPTEP) return;
    if (ptepParamHistorySuspendRef.current) return;
    const current = JSON.stringify(ptepSelectedParameterParts || []);
    const prev = JSON.stringify(ptepParamPrevSnapshotRef.current || []);
    if (current === prev) return;
    ptepParamHistoryRef.current.past = [...ptepParamHistoryRef.current.past, ptepParamPrevSnapshotRef.current || []].slice(-HISTORY_LIMIT);
    ptepParamHistoryRef.current.future = [];
    ptepParamPrevSnapshotRef.current = ptepSelectedParameterParts || [];
    setPtepParamHistoryTick((t) => t + 1);
  }, [isPTEP, ptepSelectedParameterParts]);

  useEffect(() => {
    mvftSelectedTrenchPartsRef.current = mvftSelectedTrenchParts;
  }, [mvftSelectedTrenchParts]);

  useEffect(() => {
    mvftCommittedTrenchPartsRef.current = mvftCommittedTrenchParts;
  }, [mvftCommittedTrenchParts]);

  // Load PTEP table-to-table completions from localStorage
  useEffect(() => {
    if (!isPTEP) return;
    try {
      const raw = localStorage.getItem(ptepStorageKeyTT);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) setPtepCompletedTableToTable(new Set(arr));
      else setPtepCompletedTableToTable(new Set());
    } catch (_e) {
      void _e;
      setPtepCompletedTableToTable(new Set());
    }
  }, [isPTEP, ptepStorageKeyTT]);

  // Load PTEP parameter PART completions from localStorage
  useEffect(() => {
    if (!isPTEP) return;
    try {
      const rawParts = localStorage.getItem(ptepStorageKeyParamParts);
      const parts = rawParts ? JSON.parse(rawParts) : [];
      if (Array.isArray(parts)) {
        setPtepSelectedParameterParts(parts);
        ptepLegacyCompletedParameterIdsRef.current = null;
        return;
      }
      setPtepSelectedParameterParts([]);
    } catch (_e) {
      void _e;
      setPtepSelectedParameterParts([]);
    }
    // Back-compat: if old full-line storage exists (array of ids), migrate after geojson loads.
    try {
      const rawLegacy = localStorage.getItem(ptepStorageKeyParam);
      const arr = rawLegacy ? JSON.parse(rawLegacy) : [];
      if (Array.isArray(arr) && arr.length > 0) {
        ptepLegacyCompletedParameterIdsRef.current = new Set(arr.map(String));
      } else {
        ptepLegacyCompletedParameterIdsRef.current = null;
      }
    } catch (_e) {
      void _e;
      ptepLegacyCompletedParameterIdsRef.current = null;
    }
  }, [isPTEP, ptepStorageKeyParamParts, ptepStorageKeyParam]);

  // PTEP: One-time migration from legacy full-line IDs -> full-length PARTs
  useEffect(() => {
    if (!isPTEP) return;
    const legacy = ptepLegacyCompletedParameterIdsRef.current;
    if (!legacy || legacy.size === 0) return;
    const byId = ptepParameterByIdRef.current || {};
    const toAdd = [];
    legacy.forEach((uid) => {
      const layer = byId[String(uid)];
      if (!layer || typeof layer.getLatLngs !== 'function') return;
      const lines = asLineStrings(layer.getLatLngs());
      lines.forEach((lineLL, lineIndex) => {
        if (!Array.isArray(lineLL) || lineLL.length < 2) return;
        const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
        const totalM = cumData?.cum?.[cumData.cum.length - 1] || 0;
        if (!(totalM > 0)) return;
        const coords = sliceLineByMeters({ lineLatLngs: lineLL, cumData, startM: 0, endM: totalM });
        if (!coords || coords.length < 2) return;
        toAdd.push({
          id: `${String(uid)}:${lineIndex}:0.00-${totalM.toFixed(2)}`,
          uid: String(uid),
          lineIndex,
          startM: 0,
          endM: totalM,
          coords,
          meters: totalM,
        });
      });
    });
    if (toAdd.length > 0) setPtepSelectedParameterParts(toAdd);
    ptepLegacyCompletedParameterIdsRef.current = null;
  }, [isPTEP, ptepTotalParameterMeters]);

  // Save PTEP table-to-table completions to localStorage and update styles
  useEffect(() => {
    if (!isPTEP) return;
    try {
      localStorage.setItem(ptepStorageKeyTT, JSON.stringify(Array.from(ptepCompletedTableToTable)));
    } catch (_e) {
      void _e;
    }
    // Update styles and interactivity for all table-to-table features
    const byId = ptepTableToTableByIdRef.current || {};
    const isActive = ptepSubModeRef.current === 'tabletotable';
    Object.keys(byId).forEach((uid) => {
      const layer = byId[uid];
      if (layer && typeof layer.setStyle === 'function') {
        const isDone = ptepCompletedTableToTable.has(uid);
        layer.setStyle({
          color: isDone ? '#22c55e' : '#3b82f6',
          weight: 2.2,
          opacity: isActive ? 1 : 0,
          dashArray: isDone ? null : '6 4',
          lineCap: 'round',
          lineJoin: 'round',
        });
        // Disable/enable interactivity based on sub-mode
        if (layer.options) {
          layer.options.interactive = isActive;
        }
        // Also update the underlying path element's pointer-events
        try {
          if (layer._path) {
            layer._path.style.pointerEvents = isActive ? 'auto' : 'none';
          }
        } catch (_e) { void _e; }
      }
    });
  }, [isPTEP, ptepStorageKeyTT, ptepCompletedTableToTable, ptepSubMode]);

  // Save PTEP parameter PART completions to localStorage and update base styles/interactivity
  useEffect(() => {
    if (!isPTEP) return;
    try {
      localStorage.setItem(ptepStorageKeyParamParts, JSON.stringify(ptepSelectedParameterParts || []));
    } catch (_e) {
      void _e;
    }

    const byId = ptepParameterByIdRef.current || {};
    const isActive = ptepSubModeRef.current === 'parameter';
    Object.keys(byId).forEach((uid) => {
      const layer = byId[uid];
      if (layer && typeof layer.setStyle === 'function') {
        layer.setStyle({
          color: '#facc15',
          weight: 1.5,
          opacity: isActive ? 1 : 0,
        });
        if (layer.options) {
          layer.options.interactive = isActive;
        }
        try {
          if (layer._path) {
            layer._path.style.pointerEvents = isActive ? 'auto' : 'none';
          }
        } catch (_e) {
          void _e;
        }
      }
    });
  }, [isPTEP, ptepStorageKeyParamParts, ptepSelectedParameterParts, ptepSubMode]);

  // PTEP: Render selected parameter PARTS as green overlay (MVF-style)
  useEffect(() => {
    if (!isPTEP) return;
    const map = mapRef.current;
    if (!map) return;
    try {
      if (!ptepParameterSelectedLayerRef.current) {
        ptepParameterSelectedLayerRef.current = L.layerGroup().addTo(map);
      }
      const lg = ptepParameterSelectedLayerRef.current;
      lg.clearLayers();
      if (ptepSubModeRef.current !== 'parameter') return;
      const parts = ptepSelectedParameterPartsRef.current || [];
      parts.forEach((p) => {
        const coords = p?.coords;
        if (!Array.isArray(coords) || coords.length < 2) return;
        const line = L.polyline(coords, {
          color: '#22c55e',
          weight: 3,
          opacity: 1,
          interactive: false,
          pane: 'ptepParameterSelectedPane',
        });
        lg.addLayer(line);
      });
    } catch (_e) {
      void _e;
    }
  }, [isPTEP, ptepSubMode, ptepSelectedParameterParts]);

  // PTEP: Update pane-level pointer-events and visibility based on sub-mode
  // This ensures inactive layers are both non-interactive AND hidden
  useEffect(() => {
    if (!isPTEP) return;
    const map = mapRef.current;
    if (!map) return;

    try {
      const ttPane = map.getPane('ptepTableToTablePane');
      const paramPane = map.getPane('ptepParameterPane');

      if (ttPane) {
        ttPane.style.pointerEvents = ptepSubMode === 'tabletotable' ? 'auto' : 'none';
        ttPane.style.opacity = ptepSubMode === 'tabletotable' ? '1' : '0';
      }
      if (paramPane) {
        paramPane.style.pointerEvents = ptepSubMode === 'parameter' ? 'auto' : 'none';
        paramPane.style.opacity = ptepSubMode === 'parameter' ? '1' : '0';
      }
    } catch (_e) {
      void _e;
    }
  }, [isPTEP, ptepSubMode]);

  // ======== DATP (DC&AC Trench Progress) Effects ========
  // Load DATP trench parts from localStorage
  useEffect(() => {
    if (!isDATP) return;
    try {
      const raw = localStorage.getItem(datpStorageKey);
      const parts = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parts)) {
        setDatpSelectedTrenchParts(parts);
      } else {
        setDatpSelectedTrenchParts([]);
      }
    } catch (_e) {
      void _e;
      setDatpSelectedTrenchParts([]);
    }
  }, [isDATP, datpStorageKey]);

  // Save DATP trench parts to localStorage
  useEffect(() => {
    if (!isDATP) return;
    try {
      localStorage.setItem(datpStorageKey, JSON.stringify(datpSelectedTrenchParts || []));
    } catch (_e) {
      void _e;
    }
  }, [isDATP, datpStorageKey, datpSelectedTrenchParts]);

  // Load MVFT COMMITTED trench parts from localStorage
  useEffect(() => {
    if (!isMVFT) return;
    try {
      const raw = localStorage.getItem(mvftStorageKey);
      const parts = raw ? JSON.parse(raw) : [];
      setMvftCommittedTrenchParts(Array.isArray(parts) ? parts : []);
    } catch (_e) {
      void _e;
      setMvftCommittedTrenchParts([]);
    }
  }, [isMVFT, mvftStorageKey]);

  // Load MVFT DRAFT trench parts from localStorage
  useEffect(() => {
    if (!isMVFT) return;
    try {
      const raw = localStorage.getItem(mvftDraftStorageKey);
      const parts = raw ? JSON.parse(raw) : [];
      setMvftSelectedTrenchParts(Array.isArray(parts) ? parts : []);
    } catch (_e) {
      void _e;
      setMvftSelectedTrenchParts([]);
    }
  }, [isMVFT, mvftDraftStorageKey]);

  // Save MVFT COMMITTED trench parts to localStorage
  useEffect(() => {
    if (!isMVFT) return;
    try {
      localStorage.setItem(mvftStorageKey, JSON.stringify(mvftCommittedTrenchParts || []));
    } catch (_e) {
      void _e;
    }
  }, [isMVFT, mvftStorageKey, mvftCommittedTrenchParts]);

  // Save MVFT DRAFT trench parts to localStorage
  useEffect(() => {
    if (!isMVFT) return;
    try {
      localStorage.setItem(mvftDraftStorageKey, JSON.stringify(mvftSelectedTrenchParts || []));
    } catch (_e) {
      void _e;
    }
  }, [isMVFT, mvftDraftStorageKey, mvftSelectedTrenchParts]);

  // DATP: Render selected trench PARTS as green overlay
  useEffect(() => {
    if (!isDATP) return;
    const map = mapRef.current;
    if (!map) return;
    try {
      if (!datpTrenchSelectedLayerRef.current) {
        datpTrenchSelectedLayerRef.current = L.layerGroup().addTo(map);
      }
      const lg = datpTrenchSelectedLayerRef.current;
      lg.clearLayers();
      const parts = datpSelectedTrenchPartsRef.current || [];
      parts.forEach((p) => {
        const coords = p?.coords;
        if (!Array.isArray(coords) || coords.length < 2) return;
        const line = L.polyline(coords, {
          color: datpCompletedLineColor,
          weight: 2.5,
          opacity: 1,
          interactive: false,
          pane: 'datpTrenchSelectedPane',
        });
        lg.addLayer(line);
      });
    } catch (_e) {
      void _e;
    }
  }, [isDATP, datpSelectedTrenchParts, datpCompletedLineColor]);

  // Render MVFT committed + draft trench parts (green overlays)
  useEffect(() => {
    if (!isMVFT) return;
    const map = mapRef.current;
    if (!map) return;
    try {
      if (!mvftTrenchCommittedLayerRef.current) {
        mvftTrenchCommittedLayerRef.current = L.layerGroup({ pane: 'mvftTrenchCommittedPane' }).addTo(map);
      }
      if (!mvftTrenchSelectedLayerRef.current) {
        mvftTrenchSelectedLayerRef.current = L.layerGroup({ pane: 'mvftTrenchSelectedPane' }).addTo(map);
      }

      const committedLg = mvftTrenchCommittedLayerRef.current;
      const selectedLg = mvftTrenchSelectedLayerRef.current;
      committedLg.clearLayers();
      selectedLg.clearLayers();

      const committed = mvftCommittedTrenchPartsRef.current || [];
      committed.forEach((p) => {
        if (!p?.coords?.length) return;
        const line = L.polyline(p.coords, {
          color: '#00ff00',
          weight: 2.2,
          opacity: 1,
          interactive: false,
          pane: 'mvftTrenchCommittedPane',
        });
        committedLg.addLayer(line);
      });

      const draft = mvftSelectedTrenchPartsRef.current || [];
      draft.forEach((p) => {
        if (!p?.coords?.length) return;
        const line = L.polyline(p.coords, {
          color: '#00ff00',
          weight: 2.2,
          opacity: 1,
          interactive: false,
          pane: 'mvftTrenchSelectedPane',
        });
        selectedLg.addLayer(line);
      });
    } catch (_e) {
      void _e;
    }
  }, [isMVFT, mvftSelectedTrenchParts, mvftCommittedTrenchParts, datpCompletedLineColor]);

  // Compute completed DATP trench meters
  const datpCompletedTrenchMeters = useMemo(() => {
    const parts = datpSelectedTrenchParts || [];
    let sum = 0;
    for (const p of parts) {
      const m = Number(p?.meters);
      if (Number.isFinite(m) && m > 0) sum += m;
    }
    return sum;
  }, [datpSelectedTrenchParts]);

  // MVFT meters
  const mvftDraftTrenchMeters = useMemo(() => {
    const parts = mvftSelectedTrenchParts || [];
    let sum = 0;
    for (const p of parts) {
      const m = Number(p?.meters);
      if (Number.isFinite(m) && m > 0) sum += m;
    }
    return sum;
  }, [mvftSelectedTrenchParts]);

  const mvftCommittedTrenchMeters = useMemo(() => {
    const parts = mvftCommittedTrenchParts || [];
    let sum = 0;
    for (const p of parts) {
      const m = Number(p?.meters);
      if (Number.isFinite(m) && m > 0) sum += m;
    }
    return sum;
  }, [mvftCommittedTrenchParts]);

  const mvftCompletedTrenchMeters = useMemo(() => mvftDraftTrenchMeters + mvftCommittedTrenchMeters, [mvftDraftTrenchMeters, mvftCommittedTrenchMeters]);

  // Compute completed parameter meters
  const ptepCompletedParameterMeters = useMemo(() => {
    const parts = ptepSelectedParameterParts || [];
    let sum = 0;
    for (const p of parts) {
      const m = Number(p?.meters);
      if (Number.isFinite(m) && m > 0) sum += m;
    }
    return sum;
  }, [ptepSelectedParameterParts]);

  // MC4: panel-end progress tracking (two ends per panel: left/right)
  const MC4_PANEL_STATES = {
    NONE: null,
    MC4: 'mc4',
    TERMINATED: 'terminated',
  };
  // MC4 selection mode:
  // - 'mc4': MC4 installation
  // - 'termination_panel': Cable termination (panel side) via panel ends
  // - 'termination_inv': Cable termination (inv. side) via inverter popup counts
  // Default to 'mc4' (matches prior behavior), but allow user to uncheck back to null.
  const [mc4SelectionMode, setMc4SelectionMode] = useState('mc4'); // null | 'mc4' | 'termination_panel' | 'termination_inv'
  const mc4SelectionModeRef = useRef(mc4SelectionMode);
  const mc4LastTerminationModeRef = useRef('termination_panel');
  useEffect(() => {
    mc4SelectionModeRef.current = mc4SelectionMode;
    if (mc4SelectionMode === 'termination_panel' || mc4SelectionMode === 'termination_inv') {
      mc4LastTerminationModeRef.current = mc4SelectionMode;
    }
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
  const mc4SubmittedStorageKey = `cew:mc4:submitted_counts:${mc4TodayYmd}`;
  const mc4InvTerminationStorageKey = `cew:mc4:inv_termination:${mc4TodayYmd}`;
  const [mc4PanelStates, setMc4PanelStates] = useState(() => ({})); // { [panelId]: { left, right } }
  const mc4PanelStatesRef = useRef(mc4PanelStates);
  const [mc4TotalStringsCsv, setMc4TotalStringsCsv] = useState(null); // number | null
  const [mc4SubmittedCounts, setMc4SubmittedCounts] = useState(() => ({ mc4: 0, termination_panel: 0, termination_inv: 0 }));
  const mc4SubmittedCountsRef = useRef(mc4SubmittedCounts);
  const mc4InvMaxByInvRef = useRef({}); // invIdNorm -> max STR number
  const [mc4InvTerminationByInv, setMc4InvTerminationByInv] = useState(() => ({})); // invIdNorm -> count
  const mc4InvTerminationByInvRef = useRef(mc4InvTerminationByInv);
  const [mc4InvPopup, setMc4InvPopup] = useState(null); // { invId, invIdNorm, draft, max, x, y } | null
  const mc4InvInputRef = useRef(null);
  const mc4HistoryRef = useRef({ actions: [], index: -1 });
  const [mc4HistoryTick, setMc4HistoryTick] = useState(0);
  const mc4EndsLayerRef = useRef(null); // L.LayerGroup

  useEffect(() => {
    mc4PanelStatesRef.current = mc4PanelStates;
  }, [mc4PanelStates]);

  useEffect(() => {
    mc4SubmittedCountsRef.current = mc4SubmittedCounts;
  }, [mc4SubmittedCounts]);

  useEffect(() => {
    mc4InvTerminationByInvRef.current = mc4InvTerminationByInv;
  }, [mc4InvTerminationByInv]);

  // ─────────────────────────────────────────────────────────────
  // DCTT: DC TERMINATION & TESTING PROGRESS - state + storage
  // Three sub-modes: 
  //   - 'termination': Cable Termination (Panel Side + Inv. Side)
  //   - 'testing': DC Testing (DCCT-style testing sub-mode)
  // ─────────────────────────────────────────────────────────────
  // DCTT main sub-mode selector
  const [dcttSubMode, setDcttSubMode] = useState(() => {
    try {
      const raw = localStorage.getItem('cew:dctt:submode');
      const v = String(raw || '').toLowerCase();
      return v === 'testing' ? 'testing' : 'termination';
    } catch (_e) {
      void _e;
      return 'termination';
    }
  }); // 'termination' | 'testing'
  const dcttSubModeRef = useRef(dcttSubMode);
  useEffect(() => {
    dcttSubModeRef.current = dcttSubMode;
    try {
      localStorage.setItem('cew:dctt:submode', String(dcttSubMode || 'termination'));
    } catch (_e) {
      void _e;
    }
  }, [dcttSubMode]);

  // DCTT selection mode (within termination sub-mode):
  // - 'termination_panel': Cable termination (panel side) via panel ends
  // - 'termination_inv': Cable termination (inv. side) via inverter popup counts
  // Default to 'termination_panel' (first sub-mode).
  const [dcttSelectionMode, setDcttSelectionMode] = useState('termination_panel'); // 'termination_panel' | 'termination_inv'
  const dcttSelectionModeRef = useRef(dcttSelectionMode);
  useEffect(() => {
    dcttSelectionModeRef.current = dcttSelectionMode;
  }, [dcttSelectionMode]);

  const [dcttToast, setDcttToast] = useState('');
  const dcttToastTimerRef = useRef(null);
  const showDcttToast = useCallback((msg) => {
    if (!msg) return;
    setDcttToast(msg);
    try {
      if (dcttToastTimerRef.current) clearTimeout(dcttToastTimerRef.current);
    } catch (_e) {
      void _e;
    }
    dcttToastTimerRef.current = setTimeout(() => setDcttToast(''), 2200);
  }, []);

  const dcttTodayYmd = getTodayYmd();
  const dcttPanelStatesStorageKey = `cew:dctt:panel_states:${dcttTodayYmd}`;
  const dcttSubmittedStorageKey = `cew:dctt:submitted_counts:${dcttTodayYmd}`;
  const dcttInvTerminationStorageKey = `cew:dctt:inv_termination:${dcttTodayYmd}`;
  const [dcttPanelStates, setDcttPanelStates] = useState(() => ({})); // { [panelId]: { left, right } }
  const dcttPanelStatesRef = useRef(dcttPanelStates);
  const [dcttTotalStringsCsv, setDcttTotalStringsCsv] = useState(null); // number | null
  const [dcttSubmittedCounts, setDcttSubmittedCounts] = useState(() => ({ termination_panel: 0, termination_inv: 0 }));
  const dcttSubmittedCountsRef = useRef(dcttSubmittedCounts);
  const dcttInvMaxByInvRef = useRef({}); // invIdNorm -> max STR number
  const [dcttInvTerminationByInv, setDcttInvTerminationByInv] = useState(() => ({})); // invIdNorm -> count
  const dcttInvTerminationByInvRef = useRef(dcttInvTerminationByInv);
  const [dcttInvPopup, setDcttInvPopup] = useState(null); // { invId, invIdNorm, draft, max, x, y } | null
  const dcttInvInputRef = useRef(null);
  const dcttHistoryRef = useRef({ actions: [], index: -1 });
  const [dcttHistoryTick, setDcttHistoryTick] = useState(0);
  const dcttEndsLayerRef = useRef(null); // L.LayerGroup
  const dcttInvLabelByIdRef = useRef({}); // invIdNorm -> L.TextLabel (for color updates)
  const dcttCommittedPanelIdsRef = useRef(new Set()); // panelIds submitted today (lock against right-click erase)

  // DCTT Testing sub-mode state (reuses DCCT logic)
  const [dcttTestData, setDcttTestData] = useState(() => ({})); // { [normalizedId]: 'passed' | 'failed' }
  const dcttTestDataRef = useRef(dcttTestData);
  useEffect(() => {
    dcttTestDataRef.current = dcttTestData || {};
  }, [dcttTestData]);
  const dcttTestRisoByIdRef = useRef({}); // CSV values per ID
  const dcttTestRowsRef = useRef([]); // original CSV rows for export parity
  const [dcttTestMapIds, setDcttTestMapIds] = useState(() => new Set());
  const dcttTestMapIdsRef = useRef(dcttTestMapIds);
  useEffect(() => {
    dcttTestMapIdsRef.current = dcttTestMapIds || new Set();
  }, [dcttTestMapIds]);
  const [dcttTestFilter, setDcttTestFilter] = useState(null); // 'passed' | 'failed' | 'not_tested' | null
  const dcttTestFilterRef = useRef(dcttTestFilter);
  useEffect(() => {
    dcttTestFilterRef.current = dcttTestFilter;
  }, [dcttTestFilter]);
  const [dcttTestCsvTotals, setDcttTestCsvTotals] = useState(() => ({ total: 0, passed: 0, failed: 0 }));
  const [dcttTestResultsDirty, setDcttTestResultsDirty] = useState(false);
  const dcttTestResultsSubmittedRef = useRef(null);
  const dcttTestImportFileInputRef = useRef(null);
  const [dcttTestPopup, setDcttTestPopup] = useState(null); // { idNorm, displayId, draftPlus, draftMinus, draftStatus, x, y } | null
  const dcttTestPopupRef = useRef(dcttTestPopup);
  useEffect(() => {
    dcttTestPopupRef.current = dcttTestPopup;
  }, [dcttTestPopup]);
  const dcttTestOverlayLayerRef = useRef(null); // L.LayerGroup
  const dcttTestOverlayLabelsByIdRef = useRef({});

  useEffect(() => {
    dcttPanelStatesRef.current = dcttPanelStates;
  }, [dcttPanelStates]);

  useEffect(() => {
    dcttSubmittedCountsRef.current = dcttSubmittedCounts;
  }, [dcttSubmittedCounts]);

  useEffect(() => {
    dcttInvTerminationByInvRef.current = dcttInvTerminationByInv;
  }, [dcttInvTerminationByInv]);

  // DCTT Testing: helper functions (same logic as DCCT)
  const dcttTestClearOverlays = useCallback(() => {
    try {
      const layer = dcttTestOverlayLayerRef.current;
      if (layer) layer.clearLayers();
    } catch (_e) {
      void _e;
    }
    dcttTestOverlayLabelsByIdRef.current = {};
  }, []);

  const dcttTestNormalizeStatus = (raw) => {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'passed' || v === 'pass') return 'passed';
    if (v === 'failed' || v === 'fail') return 'failed';
    return null;
  };

  const dcttTestNormalizeId = useCallback((raw) => {
    const rawText = String(raw ?? '').replace(/^\uFEFF/, '').trim();
    if (!rawText) return '';
    const compact = rawText.replace(/\s+/g, '').replace(/^['\"]+|['\"]+$/g, '');
    const low = compact.toLowerCase();
    const m = low.match(/^tx(\d+)[_\-]?inv(\d+)[_\-]?str(\d+)$/i) || low.match(/tx(\d+).*inv(\d+).*str(\d+)/i);
    if (m) return `tx${m[1]}-inv${m[2]}-str${m[3]}`;
    return normalizeId(rawText);
  }, []);

  const dcttTestFormatDisplayId = (idNorm, recOriginalId) => {
    const original = String(recOriginalId || '').trim();
    if (original) return original;
    return String(idNorm || '')
      .toUpperCase()
      .replace(/TX(\d+)INV(\d+)STR(\d+)/i, 'TX$1-INV$2-STR$3');
  };

  const dcttTestImportFromText = useCallback((text, source = 'import') => {
    try {
      setDcttTestFilter(null);
      dcttTestClearOverlays();

      const cleaned = String(text || '').replace(/^\uFEFF/, '');
      const parsed = Papa.parse(cleaned, {
        header: false,
        skipEmptyLines: true,
        delimiter: '',
      });
      if (!parsed.data || parsed.data.length < 2) {
        console.warn('DCTT Testing CSV has no data rows');
        setDcttTestData({});
        dcttTestRisoByIdRef.current = {};
        dcttTestRowsRef.current = [];
        // Treat manual import as an editable change-set; default CSV load should keep baseline clean.
        if (String(source || '') !== 'csv_load') {
          setDcttTestResultsDirty(true);
          dcttTestResultsSubmittedRef.current = null;
          try { localStorage.removeItem('cew:dctt:test_results_submitted'); } catch (_e) { void _e; }
          setDcttTestPopup(null);
          setStringMatchVersion((v) => v + 1);
        }
        return;
      }

      const headerRow = parsed.data[0] || [];
      const hNorm = headerRow.map((h) => String(h || '').trim().toLowerCase().replace(/[_\s\-]+/g, ''));
      const idxId = hNorm.findIndex((h) => h === 'id' || h === 'stringid' || h === 'string');
      const idxMinus = hNorm.findIndex((h) => h.includes('insulationresistance') && (h.includes('-') || h.includes('minus') || h.includes('(')));
      const idxPlus = hNorm.findIndex((h) => h.includes('insulationresistance') && (h.includes('+') || h.includes('plus') || h.includes('(')));
      const idxRemark = hNorm.findIndex((h) => h === 'remark' || h === 'remarks' || h === 'status' || h === 'result');
      const idxPlusFallback = hNorm.length > idxMinus && idxMinus >= 0 ? idxMinus + 1 : -1;

      const useIdxMinus = idxMinus >= 0 ? idxMinus : 1;
      const useIdxPlus = idxPlus >= 0 ? idxPlus : (idxPlusFallback >= 0 ? idxPlusFallback : 2);
      const useIdxRemark = idxRemark >= 0 ? idxRemark : 3;
      const useIdxId = idxId >= 0 ? idxId : 0;

      const risoById = {}; // normalizedId -> { plus, minus, status, remarkRaw, originalId }
      const rows = []; // preserve duplicates + original order

      for (let i = 1; i < parsed.data.length; i++) {
        const row = parsed.data[i];
        if (!row) continue;
        const rawId = String(row[useIdxId] ?? '').trim();
        if (!rawId) continue;

        const idNorm = dcttTestNormalizeId(rawId);
        if (!idNorm) continue;

        rows.push({ originalId: rawId, idNorm });

        const remarkRaw = String(row[useIdxRemark] ?? '').trim();
        const minus = String(row[useIdxMinus] ?? '').trim();
        const plus = String(row[useIdxPlus] ?? '').trim();
        let status = dcttTestNormalizeStatus(remarkRaw);
        if (!status) {
          const minusNum = parseFloat(minus);
          const plusNum = parseFloat(plus);
          if (Number.isFinite(minusNum) && Number.isFinite(plusNum)) {
            status = (minusNum > 0 && plusNum > 0) ? 'passed' : 'failed';
          }
        }

        const prev = risoById[idNorm];
        if (!prev) {
          risoById[idNorm] = {
            originalId: rawId,
            plus,
            minus,
            status,
            remarkRaw,
          };
        } else {
          // Prefer first originalId, but fill missing values if needed.
          risoById[idNorm] = {
            ...prev,
            plus: prev.plus && String(prev.plus).trim() !== '' ? prev.plus : plus,
            minus: prev.minus && String(prev.minus).trim() !== '' ? prev.minus : minus,
            status: prev.status != null ? prev.status : status,
            remarkRaw: prev.remarkRaw && String(prev.remarkRaw).trim() !== '' ? prev.remarkRaw : remarkRaw,
          };
        }
      }

      const testResults = {}; // normalizedId -> 'passed' | 'failed'
      let passed = 0;
      let failed = 0;
      Object.keys(risoById || {}).forEach((id) => {
        const st = dcttTestNormalizeStatus(risoById[id]?.status || risoById[id]?.remarkRaw);
        if (st === 'passed') {
          testResults[id] = 'passed';
          passed++;
        } else if (st === 'failed') {
          testResults[id] = 'failed';
          failed++;
        }
      });

      setDcttTestData(testResults);
      dcttTestRisoByIdRef.current = risoById;
      dcttTestRowsRef.current = rows;

      setDcttTestCsvTotals({ total: Object.keys(risoById || {}).length, passed, failed });
      setDcttTestPopup(null);
      setStringMatchVersion((v) => v + 1);

      // User import should require Submit before Export (DCCT parity).
      if (String(source || '') !== 'csv_load') {
        setDcttTestResultsDirty(true);
        dcttTestResultsSubmittedRef.current = null;
        try { localStorage.removeItem('cew:dctt:test_results_submitted'); } catch (_e) { void _e; }
      }
    } catch (err) {
      console.error('Error parsing DCTT Testing CSV:', err);
    }
  }, [dcttTestClearOverlays, dcttTestNormalizeId]);

  const dcttTestSubmitResults = useCallback(() => {
    if (!isDCTT) return;
    if (String(dcttSubModeRef.current || 'termination') !== 'testing') return;
    if (!dcttTestResultsDirty) return;
    const payload = {
      risoById: { ...(dcttTestRisoByIdRef.current || {}) },
      rows: Array.isArray(dcttTestRowsRef.current) ? dcttTestRowsRef.current : [],
      updatedAt: Date.now(),
      source: 'submit',
    };
    dcttTestResultsSubmittedRef.current = payload;
    try {
      localStorage.setItem('cew:dctt:test_results_submitted', JSON.stringify(payload));
    } catch (_e) {
      void _e;
    }
    setDcttTestResultsDirty(false);
  }, [isDCTT, dcttTestResultsDirty]);

  const dcttTestExportCsv = useCallback(() => {
    try {
      if (dcttTestResultsDirty) return;
      let submitted = dcttTestResultsSubmittedRef.current;
      if (!submitted) {
        try {
          const raw = localStorage.getItem('cew:dctt:test_results_submitted');
          if (raw) submitted = JSON.parse(raw);
        } catch (_e) {
          void _e;
        }
      }
      // If user never pressed Submit, we still export the currently loaded default dc_riso.csv.
      const fallbackRiso = dcttTestRisoByIdRef.current || {};
      const fallbackRows = Array.isArray(dcttTestRowsRef.current) ? dcttTestRowsRef.current : [];
      const risoData = (submitted && typeof submitted === 'object' && submitted.risoById && typeof submitted.risoById === 'object') ? (submitted.risoById || {}) : fallbackRiso;
      const submittedRows = (submitted && typeof submitted === 'object' && Array.isArray(submitted.rows) && submitted.rows.length > 0) ? submitted.rows : fallbackRows;
      const mapIds = dcttTestMapIdsRef.current || new Set();

      const header = 'ID,Insulation Resistance (-),Insulation Resistance (+),remark';
      const rows = [header];

      const pushed = new Set();
      if (submittedRows.length > 0) {
        for (const row of submittedRows) {
          const originalId = String(row?.originalId || '').trim();
          const idNorm = row?.idNorm ? String(row.idNorm) : dcttTestNormalizeId(originalId);
          if (!idNorm) continue;
          pushed.add(idNorm);

          const rec = risoData[idNorm] || {};
          const displayId = originalId || dcttTestFormatDisplayId(idNorm, rec.originalId);
          const minus = (rec.minus != null && String(rec.minus).trim() !== '') ? String(rec.minus).trim() : '0';
          const plus = (rec.plus != null && String(rec.plus).trim() !== '') ? String(rec.plus).trim() : '0';
          const status = dcttTestNormalizeStatus(rec.status || rec.remarkRaw);
          const remark = status === 'passed' ? 'PASSED' : status === 'failed' ? 'FAILED' : '';
          rows.push(`${displayId},${minus},${plus},${remark}`);
        }
      }

      const allIds = new Set([...Object.keys(risoData), ...mapIds]);
      const remaining = Array.from(allIds).filter((id) => !pushed.has(id));
      const sortedRemaining = remaining.sort((a, b) => {
        const parseId = (id) => {
          const match = String(id).match(/tx(\d+)-inv(\d+)-str(\d+)/i);
          if (match) return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
          return [0, 0, 0];
        };
        const [aTx, aInv, aStr] = parseId(a);
        const [bTx, bInv, bStr] = parseId(b);
        if (aTx !== bTx) return aTx - bTx;
        if (aInv !== bInv) return aInv - bInv;
        return aStr - bStr;
      });
      for (const idNorm of sortedRemaining) {
        const rec = risoData[idNorm] || {};
        const displayId = dcttTestFormatDisplayId(idNorm, rec.originalId);
        const minus = (rec.minus != null && String(rec.minus).trim() !== '') ? String(rec.minus).trim() : '0';
        const plus = (rec.plus != null && String(rec.plus).trim() !== '') ? String(rec.plus).trim() : '0';
        const status = dcttTestNormalizeStatus(rec.status || rec.remarkRaw);
        const remark = status === 'passed' ? 'PASSED' : status === 'failed' ? 'FAILED' : '';
        rows.push(`${displayId},${minus},${plus},${remark}`);
      }

      const csvContent = rows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dctt_test_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting DCTT Testing CSV:', err);
    }
  }, [dcttTestResultsDirty, dcttTestNormalizeId]);

  // DCTT Testing: load CSV on mount/mode change
  useEffect(() => {
    if (!isDCTT) return;
    let cancelled = false;
    (async () => {
      try {
        // Prefer previously submitted snapshot when available (DCCT parity).
        try {
          const rawSubmitted = localStorage.getItem('cew:dctt:test_results_submitted');
          if (rawSubmitted) {
            const parsed = JSON.parse(rawSubmitted);
            const rawRiso = parsed?.risoById && typeof parsed.risoById === 'object' ? parsed.risoById : {};
            const normalizedRisoById = {};
            Object.keys(rawRiso || {}).forEach((k) => {
              const rec = rawRiso[k] || {};
              const idNorm = dcttTestNormalizeId(rec?.originalId || k);
              if (!idNorm) return;
              normalizedRisoById[idNorm] = {
                ...rec,
                originalId: rec?.originalId != null ? rec.originalId : String(k || '').trim(),
              };
            });

            const rawRows = Array.isArray(parsed?.rows) ? parsed.rows : [];
            const normalizedRows = rawRows
              .map((r) => {
                const originalId = String(r?.originalId || '').trim();
                const idNorm = dcttTestNormalizeId(originalId || r?.idNorm);
                return idNorm ? { originalId, idNorm } : null;
              })
              .filter(Boolean);

            const testResults = {};
            let passedCount = 0;
            let failedCount = 0;
            Object.keys(normalizedRisoById || {}).forEach((id) => {
              const st = dcttTestNormalizeStatus(normalizedRisoById[id]?.status || normalizedRisoById[id]?.remarkRaw);
              if (st === 'passed') { testResults[id] = 'passed'; passedCount++; }
              else if (st === 'failed') { testResults[id] = 'failed'; failedCount++; }
            });

            dcttTestRisoByIdRef.current = normalizedRisoById;
            dcttTestRowsRef.current = normalizedRows;
            setDcttTestData(testResults);
            setDcttTestCsvTotals({ total: Object.keys(normalizedRisoById || {}).length, passed: passedCount, failed: failedCount });

            const normalizedPayload = {
              ...(parsed && typeof parsed === 'object' ? parsed : {}),
              risoById: normalizedRisoById,
              rows: normalizedRows,
            };
            dcttTestResultsSubmittedRef.current = normalizedPayload;
            try {
              localStorage.setItem('cew:dctt:test_results_submitted', JSON.stringify(normalizedPayload));
            } catch (_e) {
              void _e;
            }

            setDcttTestResultsDirty(false);
            setDcttTestPopup(null);
            setStringMatchVersion((v) => v + 1);
            return;
          }
        } catch (_e) {
          void _e;
        }

        // Load dc_riso.csv from DCTT folder
        const csvPath = '/DC_TERMINATION_and_TESTING PROGRESS/dc_riso.csv';
        const response = await fetch(csvPath);
        if (cancelled) return;
        if (!response.ok) {
          dcttTestRisoByIdRef.current = {};
          dcttTestRowsRef.current = [];
          setDcttTestData({});
          setDcttTestCsvTotals({ total: 0, passed: 0, failed: 0 });
          return;
        }
        const text = await response.text();
        if (cancelled) return;
        dcttTestImportFromText(text, 'csv_load');

        // Seed a baseline submitted snapshot from the shipped dc_riso.csv so Export
        // returns the default file output when the user hasn't submitted anything yet.
        const risoById = dcttTestRisoByIdRef.current || {};
        const baseRows = Array.isArray(dcttTestRowsRef.current) ? dcttTestRowsRef.current : [];
        const payload = {
          risoById: { ...(risoById || {}) },
          rows: baseRows,
          updatedAt: Date.now(),
          source: 'default',
        };
        dcttTestResultsSubmittedRef.current = payload;
        try {
          localStorage.setItem('cew:dctt:test_results_submitted', JSON.stringify(payload));
        } catch (_e) {
          void _e;
        }

        setDcttTestResultsDirty(false);
      } catch (_e) {
        console.error('Error loading DCTT Testing CSV:', _e);
      }
    })();
    return () => { cancelled = true; };
  }, [isDCTT, dcttTestImportFromText]);

  // DCTT Testing: persist dirty state warning
  useEffect(() => {
    if (!isDCTT) return;
    if (String(dcttSubModeRef.current || 'termination') !== 'testing') return;
    const handler = (e) => {
      if (dcttTestResultsDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDCTT, dcttTestResultsDirty]);

  const dcttGetPanelState = useCallback((panelId) => {
    const s = dcttPanelStatesRef.current?.[panelId];
    return s && typeof s === 'object' ? { left: s.left ?? null, right: s.right ?? null } : { left: null, right: null };
  }, []);

  // DCTT: cycle through states based on current selection mode
  // In DCTT, termination does NOT require MC4 state first - can directly mark as terminated
  const DCTT_PANEL_STATES = {
    NONE: null,
    TERMINATED: 'terminated',
  };

  const dcttCycle = useCallback((cur) => {
    // Termination (panel side): toggle between NONE and TERMINATED (no MC4 prerequisite)
    if (cur == null) return DCTT_PANEL_STATES.TERMINATED;
    if (cur === DCTT_PANEL_STATES.TERMINATED) return DCTT_PANEL_STATES.NONE;
    return cur;
  }, []);

  // dcttForwardOnly: for box selection - only advance state, never go back
  const dcttForwardOnly = useCallback((cur) => {
    // Set to TERMINATED if not already
    if (cur == null) return DCTT_PANEL_STATES.TERMINATED;
    if (cur === DCTT_PANEL_STATES.TERMINATED) return DCTT_PANEL_STATES.TERMINATED;
    return cur;
  }, []);

  const dcttApplyAction = useCallback((action, direction) => {
    if (!action?.changes?.length) return;
    setDcttPanelStates((prev) => {
      const out = { ...(prev || {}) };
      action.changes.forEach((c) => {
        if (!c?.id) return;
        // DCTT lock: once submitted, tables can ONLY be removed via History delete.
        // Block undo/redo from clearing or changing committed tables.
        const committed = dcttCommittedPanelIdsRef.current || new Set();
        if (committed.has(String(c.id))) return;
        const v = direction === 'undo' ? c.prev : c.next;
        if (!v || (v.left == null && v.right == null)) delete out[c.id];
        else out[c.id] = { left: v.left ?? null, right: v.right ?? null };
      });
      return out;
    });
  }, []);

  const dcttPushHistory = useCallback((changes) => {
    if (!changes?.length) return;
    const h = dcttHistoryRef.current;
    const nextActions = h.actions.slice(0, h.index + 1);
    nextActions.push({ changes, ts: Date.now() });
    h.actions = nextActions.slice(-80);
    h.index = h.actions.length - 1;
    setDcttHistoryTick((t) => t + 1);
  }, []);

  const dcttCanUndo = isDCTT && dcttHistoryRef.current.index >= 0;
  const dcttCanRedo = isDCTT && dcttHistoryRef.current.index < (dcttHistoryRef.current.actions.length - 1);
  const dcttUndo = useCallback(() => {
    const h = dcttHistoryRef.current;
    if (h.index < 0) return;
    const action = h.actions[h.index];
    dcttApplyAction(action, 'undo');
    h.index -= 1;
    setDcttHistoryTick((t) => t + 1);
  }, [dcttApplyAction]);

  const dcttRedo = useCallback(() => {
    const h = dcttHistoryRef.current;
    if (h.index >= h.actions.length - 1) return;
    const action = h.actions[h.index + 1];
    dcttApplyAction(action, 'redo');
    h.index += 1;
    setDcttHistoryTick((t) => t + 1);
  }, [dcttApplyAction]);

  const mc4GetPanelState = useCallback((panelId) => {
    const s = mc4PanelStatesRef.current?.[panelId];
    return s && typeof s === 'object' ? { left: s.left ?? null, right: s.right ?? null } : { left: null, right: null };
  }, []);

  // mc4Cycle: cycle through states - MC4 only has mc4 install mode now
  // (termination modes moved to DCTT module)
  const mc4Cycle = useCallback((cur) => {
    // MC4 mode: toggle between NONE and MC4 (blue)
    if (cur == null) return MC4_PANEL_STATES.MC4;
    if (cur === MC4_PANEL_STATES.MC4) return MC4_PANEL_STATES.NONE;
    // If already terminated, can't change in MC4 mode
    return cur;
  }, []);

  // mc4ForwardOnly: for box selection - only advance state, never go back
  const mc4ForwardOnly = useCallback((cur) => {
    // MC4 mode: set to MC4 (blue) if not already
    if (cur == null) return MC4_PANEL_STATES.MC4;
    return cur; // Don't change if already MC4 or TERMINATED
  }, []);

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

    dcttHistoryRef.current = { actions: [], index: -1 };
    setDcttHistoryTick((t) => t + 1);
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
      base[action.stationNorm] = clampMvtTerminationCount(action.stationNorm, action.prev ?? 0);
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
      base[action.stationNorm] = clampMvtTerminationCount(action.stationNorm, action.next ?? 0);
      return base;
    });
    setMvtTermHistoryTick((t) => t + 1);
  }, [setMvtTerminationByStation]);

  // PTEP: Undo/Redo functions for table-to-table
  const ptepTTCanUndo = isPTEP && ptepSubMode === 'tabletotable' && ptepTTHistoryRef.current.past.length > 0;
  const ptepTTCanRedo = isPTEP && ptepSubMode === 'tabletotable' && ptepTTHistoryRef.current.future.length > 0;
  const ptepTTUndo = useCallback(() => {
    const h = ptepTTHistoryRef.current;
    if (!h.past.length) return;
    const current = Array.from(ptepCompletedTableToTableRef.current || new Set()).sort();
    const previous = h.past[h.past.length - 1] || [];
    h.past = h.past.slice(0, -1);
    h.future = [current, ...h.future].slice(0, HISTORY_LIMIT);
    ptepTTHistorySuspendRef.current = true;
    ptepTTPrevSnapshotRef.current = previous;
    setPtepCompletedTableToTable(new Set(previous));
    setPtepTTHistoryTick((t) => t + 1);
    setTimeout(() => { ptepTTHistorySuspendRef.current = false; }, 0);
  }, [setPtepCompletedTableToTable]);

  const ptepTTRedo = useCallback(() => {
    const h = ptepTTHistoryRef.current;
    if (!h.future.length) return;
    const current = Array.from(ptepCompletedTableToTableRef.current || new Set()).sort();
    const next = h.future[0] || [];
    h.future = h.future.slice(1);
    h.past = [...h.past, current].slice(-HISTORY_LIMIT);
    ptepTTHistorySuspendRef.current = true;
    ptepTTPrevSnapshotRef.current = next;
    setPtepCompletedTableToTable(new Set(next));
    setPtepTTHistoryTick((t) => t + 1);
    setTimeout(() => { ptepTTHistorySuspendRef.current = false; }, 0);
  }, [setPtepCompletedTableToTable]);

  // PTEP: Undo/Redo functions for parameter
  const ptepParamCanUndo = isPTEP && ptepSubMode === 'parameter' && ptepParamHistoryRef.current.past.length > 0;
  const ptepParamCanRedo = isPTEP && ptepSubMode === 'parameter' && ptepParamHistoryRef.current.future.length > 0;
  const ptepParamUndo = useCallback(() => {
    const h = ptepParamHistoryRef.current;
    if (!h.past.length) return;
    const current = ptepSelectedParameterPartsRef.current || [];
    const previous = h.past[h.past.length - 1] || [];
    h.past = h.past.slice(0, -1);
    h.future = [current, ...h.future].slice(0, HISTORY_LIMIT);
    ptepParamHistorySuspendRef.current = true;
    ptepParamPrevSnapshotRef.current = previous;
    setPtepSelectedParameterParts(previous);
    setPtepParamHistoryTick((t) => t + 1);
    setTimeout(() => { ptepParamHistorySuspendRef.current = false; }, 0);
  }, [setPtepSelectedParameterParts]);

  const ptepParamRedo = useCallback(() => {
    const h = ptepParamHistoryRef.current;
    if (!h.future.length) return;
    const current = ptepSelectedParameterPartsRef.current || [];
    const next = h.future[0] || [];
    h.future = h.future.slice(1);
    h.past = [...h.past, current].slice(-HISTORY_LIMIT);
    ptepParamHistorySuspendRef.current = true;
    ptepParamPrevSnapshotRef.current = next;
    setPtepSelectedParameterParts(next);
    setPtepParamHistoryTick((t) => t + 1);
    setTimeout(() => { ptepParamHistorySuspendRef.current = false; }, 0);
  }, [setPtepSelectedParameterParts]);

  // DATP: Undo/Redo functions for trench parts
  const datpCanUndo = isDATP && datpHistoryRef.current.past.length > 0;
  const datpCanRedo = isDATP && datpHistoryRef.current.future.length > 0;
  const datpUndo = useCallback(() => {
    const h = datpHistoryRef.current;
    if (!h.past.length) return;
    const current = datpSelectedTrenchPartsRef.current || [];
    const previous = h.past[h.past.length - 1] || [];
    h.past = h.past.slice(0, -1);
    h.future = [current, ...h.future].slice(0, HISTORY_LIMIT);
    datpHistorySuspendRef.current = true;
    datpPrevSnapshotRef.current = previous;
    setDatpSelectedTrenchParts(previous);
    setDatpHistoryTick((t) => t + 1);
    setTimeout(() => { datpHistorySuspendRef.current = false; }, 0);
  }, [setDatpSelectedTrenchParts]);

  const datpRedo = useCallback(() => {
    const h = datpHistoryRef.current;
    if (!h.future.length) return;
    const current = datpSelectedTrenchPartsRef.current || [];
    const next = h.future[0] || [];
    h.future = h.future.slice(1);
    h.past = [...h.past, current].slice(-HISTORY_LIMIT);
    datpHistorySuspendRef.current = true;
    datpPrevSnapshotRef.current = next;
    setDatpSelectedTrenchParts(next);
    setDatpHistoryTick((t) => t + 1);
    setTimeout(() => { datpHistorySuspendRef.current = false; }, 0);
  }, [setDatpSelectedTrenchParts]);

  // MVFT: Undo/Redo functions for trench parts
  const mvftCanUndo = isMVFT && mvftHistoryRef.current.past.length > 0;
  const mvftCanRedo = isMVFT && mvftHistoryRef.current.future.length > 0;
  const mvftUndo = useCallback(() => {
    const h = mvftHistoryRef.current;
    if (!h.past.length) return;
    const current = mvftSelectedTrenchPartsRef.current || [];
    const previous = h.past[h.past.length - 1] || [];
    h.past = h.past.slice(0, -1);
    h.future = [current, ...h.future].slice(0, HISTORY_LIMIT);
    mvftHistorySuspendRef.current = true;
    mvftPrevSnapshotRef.current = previous;
    setMvftSelectedTrenchParts(previous);
    setMvftHistoryTick((t) => t + 1);
    setTimeout(() => { mvftHistorySuspendRef.current = false; }, 0);
  }, [setMvftSelectedTrenchParts]);

  const mvftRedo = useCallback(() => {
    const h = mvftHistoryRef.current;
    if (!h.future.length) return;
    const current = mvftSelectedTrenchPartsRef.current || [];
    const next = h.future[0] || [];
    h.future = h.future.slice(1);
    h.past = [...h.past, current].slice(-HISTORY_LIMIT);
    mvftHistorySuspendRef.current = true;
    mvftPrevSnapshotRef.current = next;
    setMvftSelectedTrenchParts(next);
    setMvftHistoryTick((t) => t + 1);
    setTimeout(() => { mvftHistorySuspendRef.current = false; }, 0);
  }, [setMvftSelectedTrenchParts]);

  const globalCanUndo = noteMode
    ? canUndoNotes
    : (isDCTT ? dcttCanUndo
      : isMC4 ? mc4CanUndo
        : isLVTT ? lvttCanUndo
          : isMVT ? mvtCanUndo
            : isDATP ? datpCanUndo
              : isMVFT ? mvftCanUndo
                : isPTEP ? (ptepSubMode === 'tabletotable' ? ptepTTCanUndo : ptepParamCanUndo)
                  : isLV ? lvInvCanUndo
                    : isMVF ? mvfPartsCanUndo
                      : selectionCanUndo);

  const globalCanRedo = noteMode
    ? canRedoNotes
    : (isDCTT ? dcttCanRedo
      : isMC4 ? mc4CanRedo
        : isLVTT ? lvttCanRedo
          : isMVT ? mvtCanRedo
            : isDATP ? datpCanRedo
              : isMVFT ? mvftCanRedo
                : isPTEP ? (ptepSubMode === 'tabletotable' ? ptepTTCanRedo : ptepParamCanRedo)
                  : isLV ? lvInvCanRedo
                    : isMVF ? mvfPartsCanRedo
                      : selectionCanRedo);

  const globalUndo = useCallback(() => {
    if (noteMode) return void undoNotes();
    if (isDCTT) return void dcttUndo();
    if (isMC4) return void mc4Undo();
    if (isLVTT) return void lvttUndo();
    if (isMVT) return void mvtUndo();
    if (isDATP) return void datpUndo();
    if (isMVFT) return void mvftUndo();
    if (isPTEP) return void (ptepSubModeRef.current === 'tabletotable' ? ptepTTUndo() : ptepParamUndo());
    if (isLV) return void lvInvUndo();
    if (isMVF) return void mvfPartsUndo();
    return void selectionUndo();
  }, [noteMode, undoNotes, isDCTT, dcttUndo, isMC4, mc4Undo, isLVTT, lvttUndo, isMVT, mvtUndo, isDATP, datpUndo, isMVFT, mvftUndo, isPTEP, ptepTTUndo, ptepParamUndo, isLV, lvInvUndo, isMVF, mvfPartsUndo, selectionUndo]);

  const globalRedo = useCallback(() => {
    if (noteMode) return void redoNotes();
    if (isDCTT) return void dcttRedo();
    if (isMC4) return void mc4Redo();
    if (isLVTT) return void lvttRedo();
    if (isMVT) return void mvtRedo();
    if (isDATP) return void datpRedo();
    if (isMVFT) return void mvftRedo();
    if (isPTEP) return void (ptepSubModeRef.current === 'tabletotable' ? ptepTTRedo() : ptepParamRedo());
    if (isLV) return void lvInvRedo();
    if (isMVF) return void mvfPartsRedo();
    return void selectionRedo();
  }, [noteMode, redoNotes, isDCTT, dcttRedo, isMC4, mc4Redo, isLVTT, lvttRedo, isMVT, mvtRedo, isDATP, datpRedo, isMVFT, mvftRedo, isPTEP, ptepTTRedo, ptepParamRedo, isLV, lvInvRedo, isMVF, mvfPartsRedo, selectionRedo]);

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
      const raw = localStorage.getItem(mc4SubmittedStorageKey);
      const obj = raw ? JSON.parse(raw) : null;
      const next = {
        mc4: Math.max(0, Number(obj?.mc4 ?? 0) || 0),
        // Back-compat: older builds used key name 'termination'
        termination_panel: Math.max(0, Number(obj?.termination_panel ?? obj?.termination ?? 0) || 0),
        termination_inv: Math.max(0, Number(obj?.termination_inv ?? 0) || 0),
      };
      setMc4SubmittedCounts(next);
      mc4SubmittedCountsRef.current = next;
    } catch (_e) {
      void _e;
      const next = { mc4: 0, termination_panel: 0, termination_inv: 0 };
      setMc4SubmittedCounts(next);
      mc4SubmittedCountsRef.current = next;
    }
  }, [isMC4, mc4SubmittedStorageKey]);

  useEffect(() => {
    if (!isMC4) return;
    try {
      const raw = localStorage.getItem(mc4InvTerminationStorageKey);
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === 'object') {
        setMc4InvTerminationByInv(obj);
        mc4InvTerminationByInvRef.current = obj;
      } else {
        setMc4InvTerminationByInv({});
        mc4InvTerminationByInvRef.current = {};
      }
    } catch (_e) {
      void _e;
      setMc4InvTerminationByInv({});
      mc4InvTerminationByInvRef.current = {};
    }
  }, [isMC4, mc4InvTerminationStorageKey]);

  useEffect(() => {
    if (!isMC4) return;
    try {
      localStorage.setItem(mc4InvTerminationStorageKey, JSON.stringify(mc4InvTerminationByInv || {}));
    } catch (_e) {
      void _e;
    }
  }, [isMC4, mc4InvTerminationStorageKey, mc4InvTerminationByInv]);

  useEffect(() => {
    if (!isMC4) return;
    try {
      localStorage.setItem(mc4PanelStatesStorageKey, JSON.stringify(mc4PanelStates || {}));
    } catch (_e) {
      void _e;
    }
  }, [isMC4, mc4PanelStatesStorageKey, mc4PanelStates]);

  // ─────────────────────────────────────────────────────────────
  // DCTT: localStorage load/save effects
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDCTT) return;
    try {
      const raw = localStorage.getItem(dcttPanelStatesStorageKey);
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === 'object') setDcttPanelStates(obj);
      else setDcttPanelStates({});
    } catch (_e) {
      void _e;
      setDcttPanelStates({});
    }
    dcttHistoryRef.current = { actions: [], index: -1 };
    setDcttHistoryTick((t) => t + 1);
  }, [isDCTT, dcttPanelStatesStorageKey]);

  useEffect(() => {
    if (!isDCTT) return;
    try {
      const raw = localStorage.getItem(dcttSubmittedStorageKey);
      const obj = raw ? JSON.parse(raw) : null;
      const next = {
        termination_panel: Math.max(0, Number(obj?.termination_panel ?? 0) || 0),
        termination_inv: Math.max(0, Number(obj?.termination_inv ?? 0) || 0),
      };
      setDcttSubmittedCounts(next);
      dcttSubmittedCountsRef.current = next;
    } catch (_e) {
      void _e;
      const next = { termination_panel: 0, termination_inv: 0 };
      setDcttSubmittedCounts(next);
      dcttSubmittedCountsRef.current = next;
    }
  }, [isDCTT, dcttSubmittedStorageKey]);

  useEffect(() => {
    if (!isDCTT) return;
    try {
      const raw = localStorage.getItem(dcttInvTerminationStorageKey);
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === 'object') {
        setDcttInvTerminationByInv(obj);
        dcttInvTerminationByInvRef.current = obj;
      } else {
        setDcttInvTerminationByInv({});
        dcttInvTerminationByInvRef.current = {};
      }
    } catch (_e) {
      void _e;
      setDcttInvTerminationByInv({});
      dcttInvTerminationByInvRef.current = {};
    }
  }, [isDCTT, dcttInvTerminationStorageKey]);

  useEffect(() => {
    if (!isDCTT) return;
    try {
      localStorage.setItem(dcttInvTerminationStorageKey, JSON.stringify(dcttInvTerminationByInv || {}));
    } catch (_e) {
      void _e;
    }
  }, [isDCTT, dcttInvTerminationStorageKey, dcttInvTerminationByInv]);

  useEffect(() => {
    if (!isDCTT) return;
    try {
      localStorage.setItem(dcttPanelStatesStorageKey, JSON.stringify(dcttPanelStates || {}));
    } catch (_e) {
      void _e;
    }
  }, [isDCTT, dcttPanelStatesStorageKey, dcttPanelStates]);

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

  // DCTT: render green dot markers at panel ends for terminated panels
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!isDCTT || dcttSelectionMode !== 'termination_panel') {
      if (dcttEndsLayerRef.current) {
        try { dcttEndsLayerRef.current.remove(); } catch (_e) { void _e; }
      }
      dcttEndsLayerRef.current = null;
      return;
    }

    let layer = dcttEndsLayerRef.current;
    if (!layer) {
      // Create a custom pane for DCTT markers that doesn't capture mouse events
      if (!map.getPane('dcttmarkers')) {
        const pane = map.createPane('dcttmarkers');
        pane.style.pointerEvents = 'none';
        pane.style.zIndex = '650'; // Above polygons but below popups
      }
      layer = L.layerGroup({ pane: 'dcttmarkers' });
      dcttEndsLayerRef.current = layer;
      layer.addTo(map);
    }
    layer.clearLayers();

    const states = dcttPanelStatesRef.current || {};
    const panels = polygonById.current || {};

    // Zoom-based radius: scale markers based on zoom level
    const zoom = map.getZoom();
    const baseRadius = 4;
    const radius = Math.max(1.5, Math.min(8, baseRadius * Math.pow(1.2, zoom - 20)));

    const mk = (pos, st) => {
      const isTerm = st === 'terminated';
      if (!isTerm) return null;
      const fill = '#00aa00'; // green for terminated
      const stroke = '#007700';
      return L.circleMarker(pos, {
        radius: radius,
        color: stroke,
        weight: 1.5,
        fillColor: fill,
        fillOpacity: 0.9,
        opacity: 1,
        interactive: false,
        pane: 'dcttmarkers',
      });
    };

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
      if (st.left) {
        const m = mk(ends.leftPos, st.left);
        if (m) { layer.addLayer(m); }
      }
      if (st.right) {
        const m = mk(ends.rightPos, st.right);
        if (m) { layer.addLayer(m); }
      }
    });
  }, [isDCTT, dcttSelectionMode, dcttHistoryTick, dcttPanelStates]);

  // DCTT: update markers on zoom change
  useEffect(() => {
    if (!isDCTT || dcttSelectionMode !== 'termination_panel') return;
    const map = mapRef.current;
    if (!map) return;
    const onZoom = () => {
      setDcttHistoryTick((t) => t + 0.001);
    };
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [isDCTT, dcttSelectionMode]);

  // DCTT: keep panel polygon styles in sync with termination state
  // (so selected/terminated tables show as green, not only as green end-dots)
  useEffect(() => {
    if (!isDCTT) return;
    const panels = polygonById.current || {};
    const states = dcttPanelStatesRef.current || {};
    const unselectedColor = FULL_GEOJSON_BASE_COLOR;
    const unselectedWeight = FULL_GEOJSON_BASE_WEIGHT;

    const highlighted = historySelectedRecordId
      ? new Set(editingPolygonIds)
      : null;

    Object.keys(panels).forEach((panelId) => {
      if (highlighted && highlighted.has(panelId)) return; // let history highlight effect own styling
      const info = panels[panelId];
      const layer = info?.layer;
      if (!layer || typeof layer.setStyle !== 'function') return;
      const st = states[panelId];
      const isTerminated = st?.left === DCTT_PANEL_STATES.TERMINATED || st?.right === DCTT_PANEL_STATES.TERMINATED;
      try {
        layer.setStyle(
          isTerminated
            ? { color: '#22c55e', weight: 1.5, fill: false, fillOpacity: 0 }
            : { color: unselectedColor, weight: unselectedWeight, fill: false, fillOpacity: 0 }
        );
      } catch (_e) {
        void _e;
      }
    });
  }, [isDCTT, dcttPanelStates, dcttHistoryTick, historySelectedRecordId, editingPolygonIds]);

  // DCTT: fallback single-click handler (map-level hit test)
  // Some environments/layers can miss per-polygon click events while box selection still works.
  // This ensures a normal click behaves like box selection in termination_panel mode.
  useEffect(() => {
    if (!isDCTT) return;
    if (String(dcttSelectionMode || 'termination_panel') !== 'termination_panel') return;
    if (noteMode) return;
    const map = mapRef.current;
    if (!map) return;

    const pointInPoly = (pt, poly) => {
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

    const ringToPoints = (layer) => {
      if (!layer || typeof layer.getLatLngs !== 'function') return null;
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

    const onMapClick = (evt) => {
      try {
        // Do not interfere with history editing mode.
        if (window.__historySelectedRecordId) return;
      } catch (_e) {
        void _e;
      }

      // Re-check live mode at click time.
      if (!isDCTTRef.current) return;
      if (String(dcttSubModeRef.current || 'termination') === 'testing') return;
      if (dcttSelectionModeRef.current !== 'termination_panel') return;
      const latlng = evt?.latlng;
      if (!latlng) return;

      const clickPt = map.latLngToLayerPoint(latlng);
      const panels = polygonById.current || {};

      // Hit-test only panel polygons (full.geojson tables use the "polygon_" prefix).
      for (const [panelId, info] of Object.entries(panels)) {
        if (!String(panelId).startsWith('polygon_')) continue;
        const layer = info?.layer;
        if (!layer || typeof layer.getBounds !== 'function') continue;
        try {
          const b = layer.getBounds();
          if (!b || !b.isValid?.() || !b.contains(latlng)) continue;
        } catch (_e) {
          void _e;
          continue;
        }
        const poly = ringToPoints(layer);
        if (!poly) continue;
        if (!pointInPoly(clickPt, poly)) continue;

        const prev = dcttGetPanelState(panelId);
        const next = { left: DCTT_PANEL_STATES.TERMINATED, right: DCTT_PANEL_STATES.TERMINATED };
        setDcttPanelStates((s) => ({ ...(s || {}), [panelId]: next }));
        dcttPushHistory([{ id: panelId, prev, next }]);
        return;
      }
    };

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
  }, [isDCTT, dcttSelectionMode, noteMode]);

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

  // DCTT: compute completed inverter IDs (for inv_id label coloring + history highlighting)
  // NOTE: Must be declared before any hook deps that reference it (avoid TDZ).
  const dcttCompletedInvIds = useMemo(() => {
    if (!isDCTT) return new Set();
    const byInv = dcttInvTerminationByInv || {};
    const maxByInv = dcttInvMaxByInvRef.current || {};
    const completed = new Set();
    for (const [invNorm, count] of Object.entries(byInv)) {
      const max = Math.max(0, Number(maxByInv[invNorm] ?? 0) || 0);
      const n = Math.max(0, Number(count) || 0);
      if (max > 0 && n >= max) {
        completed.add(invNorm);
      }
    }
    return completed;
  }, [isDCTT, dcttInvTerminationByInv]);

  // DCTT: keep inv_id label colors in sync with completion state (when termination count reaches max)
  useEffect(() => {
    if (!isDCTT) return;
    const labels = dcttInvLabelByIdRef.current || {};
    // Use same styling as LV for green completed state
    const invDoneTextColor = 'rgba(11,18,32,0.98)';
    const invDoneBgColor = 'rgba(34,197,94,0.92)';
    const invDoneBgStrokeColor = 'rgba(255,255,255,0.70)';
    const invDoneBgStrokeWidth = 2;
    const invDoneBgPaddingX = 4;
    const invDoneBgPaddingY = 2;
    const invDoneBgCornerRadius = 3;

    Object.keys(labels).forEach((invIdNorm) => {
      const lbl = labels[invIdNorm];
      if (!lbl) return;
      const done = dcttCompletedInvIds.has(invIdNorm);

      let changed = false;
      if (done) {
        // Green background styling for completed
        if (lbl.options.textColor !== invDoneTextColor) { lbl.options.textColor = invDoneTextColor; changed = true; }
        if (lbl.options.bgColor !== invDoneBgColor) { lbl.options.bgColor = invDoneBgColor; changed = true; }
        if (lbl.options.bgStrokeColor !== invDoneBgStrokeColor) { lbl.options.bgStrokeColor = invDoneBgStrokeColor; changed = true; }
        if (lbl.options.bgStrokeWidth !== invDoneBgStrokeWidth) { lbl.options.bgStrokeWidth = invDoneBgStrokeWidth; changed = true; }
        if (lbl.options.bgPaddingX !== invDoneBgPaddingX) { lbl.options.bgPaddingX = invDoneBgPaddingX; changed = true; }
        if (lbl.options.bgPaddingY !== invDoneBgPaddingY) { lbl.options.bgPaddingY = invDoneBgPaddingY; changed = true; }
        if (lbl.options.bgCornerRadius !== invDoneBgCornerRadius) { lbl.options.bgCornerRadius = invDoneBgCornerRadius; changed = true; }
      } else {
        // Default white text, no background
        if (lbl.options.textColor !== 'rgba(255,255,255,0.98)') { lbl.options.textColor = 'rgba(255,255,255,0.98)'; changed = true; }
        if (lbl.options.bgColor != null) { lbl.options.bgColor = null; changed = true; }
        if (lbl.options.bgStrokeColor != null) { lbl.options.bgStrokeColor = null; changed = true; }
        if (lbl.options.bgStrokeWidth !== 0) { lbl.options.bgStrokeWidth = 0; changed = true; }
        if (lbl.options.bgPaddingX !== 0) { lbl.options.bgPaddingX = 0; changed = true; }
        if (lbl.options.bgPaddingY !== 0) { lbl.options.bgPaddingY = 0; changed = true; }
        if (lbl.options.bgCornerRadius !== 0) { lbl.options.bgCornerRadius = 0; changed = true; }
      }

      if (changed) lbl.redraw?.();
    });
  }, [isDCTT, dcttCompletedInvIds]);

  // LV: When an inv_id is selected (done), also color its nearest LV box geometry green.
  useEffect(() => {
    if (!isLV) return;
    const boxDefaultColor = activeGeojsonFiles?.find?.((f) => f?.name === 'lv_box')?.color || 'rgba(250,204,21,0.7)';
    const boxDefaultWeight = Number(activeGeojsonFiles?.find?.((f) => f?.name === 'lv_box')?.weight) || 2;

    const doneColor = 'rgba(34,197,94,0.95)';
    const doneWeight = Math.max(2.2, boxDefaultWeight);

    const boxMap = lvBoxLayersByInvIdRef.current || {};
    // Fast reset: set all boxes to default
    (lvAllBoxLayersRef.current || []).forEach((layer) => {
      if (layer?.setStyle) {
        try { layer.setStyle({ color: boxDefaultColor, weight: boxDefaultWeight, fill: false, fillOpacity: 0 }); } catch (_e) { void _e; }
      }
    });
    // Apply green to selected inv boxes
    lvCompletedInvIds.forEach((invIdNorm) => {
      const layers = boxMap[invIdNorm] || [];
      layers.forEach((layer) => {
        if (layer?.setStyle) {
          try { layer.setStyle({ color: doneColor, weight: doneWeight, fill: false, fillOpacity: 0 }); } catch (_e) { void _e; }
        }
      });
    });
  }, [isLV, lvCompletedInvIds, activeMode]);

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

      // Clear canvas before redrawing to prevent ghost text artifacts on zoom/pan
      try {
        const renderer = stringTextRendererRef.current;
        if (renderer) {
          // Try Leaflet's _clear method first
          if (typeof renderer._clear === 'function') {
            renderer._clear();
          }
          // Also manually clear the canvas context if available
          const ctx = renderer._ctx;
          const container = renderer._container;
          if (ctx && container) {
            ctx.clearRect(0, 0, container.width, container.height);
          }
        }
      } catch (_e) {
        void _e;
      }

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
            if (!u || u === 'N/A' || u === 'NA') return 'N/A';
            if (u === 'PASS') return 'PASS';
            if (u.startsWith('FAIL')) return 'FAIL';
            return 'FAIL';
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
      // MVT: keep label sizing consistent with other modules (avoid oversized SS/subs_text + TEST_RESULTS)
      const mvtBaseSizeLocal = Number(stringTextBaseSizeCfg);

      // DCCT: Get test data and filter state for coloring
      const dcctTestResults = isDCCT ? (dcctTestDataRef.current || {}) : null;
      const dcctActiveFilter = isDCCT ? dcctFilterRef.current : null;
      const dcctMapIdsSet = isDCCT ? (dcctMapIdsRef.current || new Set()) : null;

      // MVT/LVTT: filters for testing-mode label highlighting
      const mvtActiveFilter = isMVT ? mvtTestFilterRef.current : null;

      // LVTT: max inverter count per SS/SUB comes from LV cable pulling CSV (TXn -> max INVn)
      const lvttMaxInvForSubNorm = (subNorm) => {
        const m = String(subNorm || '').match(/^(ss|sub)(\d{2})$/i);
        if (!m) return 0;
        const tx = parseInt(m[2], 10);
        if (!Number.isFinite(tx) || tx <= 0) return 0;
        const dict = lvttTxInvMaxByTxRef.current || {};
        return Math.max(0, Number(dict?.[tx] ?? dict?.[String(tx)] ?? 0) || 0);
      };

      for (let k = 0; k < runTotal; k++) {
        if (count >= maxCount) break;
        const idx = cursorCandidates ? cursorCandidates[k] : (iterateIndices ? iterateIndices[k] : k);
        const pt = points[idx];
        if (!pt) continue;
        if (!bounds.contains([pt.lat, pt.lng])) continue;

        // MVT: substation label color depends on mode (termination counters vs testing results).
        let nextText = pt.text;
        let nextTextColor = stringTextColorCfg;
        let nextOpacity = 1.0;

        if (isMVT) {
          const raw = String(pt.text || '').trim();
          const stationKey = mvtCanonicalTerminationStationNorm(raw);
          const mode = String(mvtSubModeRef.current || 'termination');
          if (stationKey && isMvtTerminationStationNorm(stationKey)) {
            // MVT: CSS is not part of MV testing; keep it WHITE in testing mode.
            if (stationKey === 'css' && mode === 'testing') {
              nextTextColor = 'rgba(255,255,255,0.98)';
            } else
              if (mode === 'termination' && mvtCountsByStation) {
                const max = mvtTerminationMaxForNorm(stationKey);
                const terminated = clampMvtTerminationCount(stationKey, mvtCountsByStation[stationKey] ?? 0);
                // MVT rule: max/max => GREEN, otherwise WHITE (not red)
                nextTextColor = (max > 0 && terminated === max) ? 'rgba(34,197,94,0.98)' : 'rgba(255,255,255,0.98)';
              } else if (mode === 'testing' && mvtTestStatusByStation) {
                const st = mvtTestStatusByStation.statusOf(raw);
                if (!st?.hasTested) nextTextColor = 'rgba(148,163,184,0.98)';
                else if (st?.allPass) nextTextColor = 'rgba(34,197,94,0.98)';
                else nextTextColor = 'rgba(220,38,38,0.98)';

                // Filter highlighting (DCCT-style): when active, recolor matches and dim non-matches
                if (mvtActiveFilter) {
                  const l1s = String(st?.phases?.L1?.status || 'N/A').trim().toUpperCase();
                  const l2s = String(st?.phases?.L2?.status || 'N/A').trim().toUpperCase();
                  const l3s = String(st?.phases?.L3?.status || 'N/A').trim().toUpperCase();
                  const hasPass = l1s === 'PASS' || l2s === 'PASS' || l3s === 'PASS';
                  const hasFail = l1s === 'FAIL' || l2s === 'FAIL' || l3s === 'FAIL' || l1s === 'FAILED' || l2s === 'FAILED' || l3s === 'FAILED';
                  const hasNA = (!l1s || l1s === 'N/A') || (!l2s || l2s === 'N/A') || (!l3s || l3s === 'N/A');
                  const matches = mvtActiveFilter === 'passed' ? hasPass : mvtActiveFilter === 'failed' ? hasFail : hasNA;
                  if (matches) {
                    nextTextColor = mvtActiveFilter === 'passed'
                      ? 'rgba(34,197,94,0.98)'
                      : mvtActiveFilter === 'failed'
                        ? 'rgba(220,38,38,0.98)'
                        : 'rgba(148,163,184,0.98)';
                  } else {
                    nextTextColor = 'rgba(148,163,184,0.18)';
                    nextOpacity = 0.18;
                  }
                }
              }
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
            nextTextColor = 'rgba(255,255,255,0.98)'; // White (not tested)
          }

          // Apply filter: dim labels that don't match the active filter
          // NOTE: In DCCT we keep other labels stable; counter click only highlights the counter itself.
        }

        // DCTT Testing Mode: Color labels based on CSV existence + remark (PASSED/FAILED)
        // Spec:
        // - Passed: CSV remark PASSED
        // - Failed: CSV remark FAILED
        // - Not Tested: string_text ID exists on map but is missing in CSV entirely
        if (isDCTT && String(dcttSubModeRef.current || 'termination') === 'testing') {
          const norm = pt.stringId || dcttTestNormalizeId(pt.text);
          const rec = (dcttTestRisoByIdRef.current || {})?.[norm] || null;
          const st = rec ? (dcttTestNormalizeStatus(rec.status || rec.remarkRaw) || null) : null;

          const status = st === 'passed' ? 'passed' : st === 'failed' ? 'failed' : 'not_tested';

          if (status === 'passed') nextTextColor = 'rgba(5,150,105,0.96)';
          else if (status === 'failed') nextTextColor = 'rgba(239,68,68,0.98)';
          else nextTextColor = 'rgba(255,255,255,0.98)';

          const dcttActiveFilter = dcttTestFilterRef.current;
          if (dcttActiveFilter) {
            if (status === dcttActiveFilter) {
              nextOpacity = 1.0;
            } else {
              // Match Failed/Passed filter behavior: non-matching labels dim to a single neutral dark tone.
              nextTextColor = 'rgba(148,163,184,0.18)';
              nextOpacity = 0.18;
            }
          }
        }

        // LVTT: SS/SUB labels show completion by color (GREEN=done/max, RED=not complete)
        // and are underlined to represent clickability (we removed numeric counters under the text).
        if (isLVTT) {
          const raw = String(pt.text || '').trim();
          const subNorm = lvttCanonicalSubNorm(raw);
          if (subNorm) {
            const maxInv = lvttMaxInvForSubNorm(subNorm);
            if (maxInv > 0) {
              const stored = Number(lvttSubTerminationBySubRef.current?.[subNorm] ?? 0);
              const done = Math.max(0, Math.min(maxInv, Number.isFinite(stored) ? stored : 0));
              // LVTT should match MC4-style: uncompleted = white, completed = green.
              nextTextColor = done >= maxInv ? 'rgba(34,197,94,0.98)' : 'rgba(255,255,255,0.98)';
            } else {
              // Unknown max (missing TX mapping) => neutral gray
              nextTextColor = 'rgba(148,163,184,0.98)';
            }

            // If a history record is selected, highlight its SS/SUB items in orange.
            const historyHighlighted =
              Boolean(historyOpenRef.current) &&
              Boolean(historySelectedRecordIdRef.current) &&
              Boolean(lvttHistoryHighlightSubSetRef.current?.has(subNorm));
            if (historyHighlighted) {
              nextTextColor = 'rgba(11,18,32,0.98)';
            }
          }
        }

        // DCTT Testing: check if in testing mode
        const isDcttTestingMode = isDCTT && String(dcttSubModeRef.current || 'termination') === 'testing';

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
            // MVT: SS labels clickable; LVTT: SS/SUB labels clickable; DCTT testing: string labels clickable
            interactive: isMVT || isLVTT || isDcttTestingMode,
            radius: (isMVT || isLVTT || isDcttTestingMode) ? 22 : 0,
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
              const modeNow = String(mvtSubModeRef.current || 'termination');
              const stationLabel = String(label._mvtStationLabel || '').trim();
              const stationNorm = String(label._mvtStationNorm || '');

              if (!stationNorm) return;

              const oe = evt?.originalEvent;
              const x = oe?.clientX ?? 0;
              const y = oe?.clientY ?? 0;

              if (modeNow === 'termination') {
                const lockedNow = Boolean(label._mvtLocked);
                if (lockedNow) return;
                const cur = clampMvtTerminationCount(stationNorm, mvtTerminationByStationRef.current?.[stationNorm] ?? 0);
                setMvtTermPopup({
                  stationLabel: stationLabel || stationNorm,
                  stationNorm,
                  draft: cur,
                  x,
                  y,
                });
                return;
              }

              if (modeNow === 'testing') {
                // Lookup fromKey directly from CSV ref to ensure latest data.
                const csv = mvtTestCsvByFromRef.current || {};
                const normSt = normalizeId(stationLabel || stationNorm);
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
                for (const k of candKeys) {
                  if (csv[k]) { fromKey = k; break; }
                }
                if (!fromKey) {
                  const preferred = candKeys.find((k) => /^sub\d{2}$/i.test(k)) || candKeys[0] || '';
                  fromKey = preferred;
                }
                setMvtTestPanel(null);
                setMvtTestPopup({ stationLabel: stationLabel || stationNorm, fromKey, x, y });
              }
            });

            label.on('mouseover', () => {
              try { if (!label._mvtLocked) map.getContainer().style.cursor = 'pointer'; } catch (_e) { void _e; }
            });
            label.on('mouseout', () => {
              try { map.getContainer().style.cursor = ''; } catch (_e) { void _e; }
            });

            // Mark so pooled labels reused across modules still get MVT handlers.
            label._mvtHandlersBound = true;
          }

          if (isLVTT) {
            label.on('click', (evt) => {
              try {
                if (evt?.originalEvent) {
                  evt.originalEvent.stopImmediatePropagation?.();
                  L.DomEvent.stopPropagation(evt.originalEvent);
                  L.DomEvent.preventDefault(evt.originalEvent);
                }
              } catch (_e) { void _e; }

              if (String(lvttSubModeRef.current || 'termination') !== 'termination') return;
              const subNorm = String(label._lvttSubNorm || '');
              const maxInv = Number(label._lvttSubMax || 0);
              if (!subNorm || !(maxInv > 0)) return;
              const curRaw = Number(lvttSubTerminationBySubRef.current?.[subNorm] ?? 0);
              const cur = Math.max(0, Math.min(maxInv, Number.isFinite(curRaw) ? curRaw : 0));
              const oe = evt?.originalEvent;
              const x = oe?.clientX ?? 0;
              const y = oe?.clientY ?? 0;
              setLvttPopup({
                mode: 'sub_termination',
                subId: String(label._lvttSubId || ''),
                subNorm,
                max: maxInv,
                draft: cur,
                x,
                y,
              });
            });

            label.on('mouseover', () => {
              try { map.getContainer().style.cursor = 'pointer'; } catch (_e) { void _e; }
            });
            label.on('mouseout', () => {
              try { map.getContainer().style.cursor = ''; } catch (_e) { void _e; }
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
          {
            const stationKey = mvtCanonicalTerminationStationNorm(raw);
            if (stationKey && isMvtTerminationStationNorm(stationKey)) {
              const modeNow = String(mvtSubModeRef.current || 'termination');
              const termMode = modeNow === 'termination';
              const testMode = modeNow === 'testing';

              // If this label instance came from the pool (created in another module),
              // it won't have the MVT click handler. Bind it lazily here.
              if (!label._mvtHandlersBound) {
                label.on('click', (evt) => {
                  try {
                    if (evt?.originalEvent) {
                      evt.originalEvent.stopImmediatePropagation?.();
                      L.DomEvent.stopPropagation(evt.originalEvent);
                      L.DomEvent.preventDefault(evt.originalEvent);
                    }
                  } catch (_e) { void _e; }
                  const modeNow2 = String(mvtSubModeRef.current || 'termination');
                  const stationLabel2 = String(label._mvtStationLabel || '').trim();
                  const stationNorm2 = String(label._mvtStationNorm || '');
                  if (!stationNorm2) return;
                  const oe = evt?.originalEvent;
                  const x = oe?.clientX ?? 0;
                  const y = oe?.clientY ?? 0;
                  if (modeNow2 === 'termination') {
                    const lockedNow2 = Boolean(label._mvtLocked);
                    if (lockedNow2) return;
                    const cur2 = clampMvtTerminationCount(stationNorm2, mvtTerminationByStationRef.current?.[stationNorm2] ?? 0);
                    setMvtTermPopup({
                      stationLabel: stationLabel2 || stationNorm2,
                      stationNorm: stationNorm2,
                      draft: cur2,
                      x,
                      y,
                    });
                    return;
                  }
                  if (modeNow2 === 'testing') {
                    const csv = mvtTestCsvByFromRef.current || {};
                    const normSt = normalizeId(stationLabel2 || stationNorm2);
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
                    for (const k of candKeys) {
                      if (csv[k]) { fromKey = k; break; }
                    }
                    if (!fromKey) {
                      const preferred = candKeys.find((k) => /^sub\d{2}$/i.test(k)) || candKeys[0] || '';
                      fromKey = preferred;
                    }
                    setMvtTestPanel(null);
                    setMvtTestPopup({ stationLabel: stationLabel2 || stationNorm2, fromKey, x, y });
                  }
                });

                label.on('mouseover', () => {
                  try { if (!label._mvtLocked) map.getContainer().style.cursor = 'pointer'; } catch (_e) { void _e; }
                });
                label.on('mouseout', () => {
                  try { map.getContainer().style.cursor = ''; } catch (_e) { void _e; }
                });
                label._mvtHandlersBound = true;
              }

              // MVT: CSS is excluded from MV testing. Keep it WHITE and non-interactive in testing mode.
              if (stationKey === 'css' && testMode) {
                label._mvtStationNorm = '';
                label._mvtStationLabel = raw;
                label._mvtLocked = false;
                if (label.options.radius !== 0) { label.options.radius = 0; needsRedraw = true; }
                if (label.options.interactive !== false) { label.options.interactive = false; needsRedraw = true; }
                if (label.options.underline) { label.options.underline = false; needsRedraw = true; }
                if (label.options.underlineColor) { label.options.underlineColor = null; needsRedraw = true; }
                if (label.options.textBaseSize !== mvtBaseSizeLocal) { label.options.textBaseSize = mvtBaseSizeLocal; needsRedraw = true; }
                const desiredTextColor = historyHighlighted ? 'rgba(11,18,32,0.98)' : 'rgba(255,255,255,0.98)';
                if (label.options.textColor !== desiredTextColor) { label.options.textColor = desiredTextColor; needsRedraw = true; }
                // Keep history highlight behavior consistent if user opens history.
                if (historyHighlighted) {
                  if (label.options.bgColor !== 'rgba(249,115,22,1)') { label.options.bgColor = 'rgba(249,115,22,1)'; needsRedraw = true; }
                  if (label.options.bgPaddingX !== 4) { label.options.bgPaddingX = 4; needsRedraw = true; }
                  if (label.options.bgPaddingY !== 2) { label.options.bgPaddingY = 2; needsRedraw = true; }
                  if (label.options.bgCornerRadius !== 3) { label.options.bgCornerRadius = 3; needsRedraw = true; }
                } else {
                  if (label.options.bgColor != null) { label.options.bgColor = null; needsRedraw = true; }
                  if (label.options.bgPaddingX !== 0) { label.options.bgPaddingX = 0; needsRedraw = true; }
                  if (label.options.bgPaddingY !== 0) { label.options.bgPaddingY = 0; needsRedraw = true; }
                  if (label.options.bgCornerRadius !== 0) { label.options.bgCornerRadius = 0; needsRedraw = true; }
                }
              } else {
                const max = mvtTerminationMaxForNorm(stationKey);
                const terminated = clampMvtTerminationCount(stationKey, mvtTerminationByStationRef.current?.[stationKey] ?? 0);
                const locked = (max > 0 && terminated === max);

                let baseTextColor = locked ? 'rgba(34,197,94,0.98)' : 'rgba(255,255,255,0.98)';
                if (testMode && mvtTestStatusByStation) {
                  const st = mvtTestStatusByStation.statusOf(raw);
                  if (!st?.hasTested) baseTextColor = 'rgba(148,163,184,0.98)';
                  else if (st?.allPass) baseTextColor = 'rgba(34,197,94,0.98)';
                  else baseTextColor = 'rgba(220,38,38,0.98)';
                }

                const historyHighlighted =
                  Boolean(historyOpenRef.current) &&
                  Boolean(historySelectedRecordIdRef.current) &&
                  Boolean(mvtHistoryHighlightStationSetRef.current?.has(stationKey));
                const highlightBgColor = 'rgba(249,115,22,1)'; // #f97316
                const highlightTextColor = 'rgba(11,18,32,0.98)';
                label._mvtStationNorm = stationKey;
                label._mvtStationLabel = raw;
                label._mvtLocked = locked;
                if (label.options.radius !== ((termMode || testMode) ? 22 : 0)) { label.options.radius = (termMode || testMode) ? 22 : 0; needsRedraw = true; }
                if (label.options.interactive !== (termMode || testMode)) { label.options.interactive = (termMode || testMode); needsRedraw = true; }
                if (label.options.textBaseSize !== mvtBaseSizeLocal) { label.options.textBaseSize = mvtBaseSizeLocal; needsRedraw = true; }
                // MVT: clickability is represented by underlined station labels (no extra numeric overlay labels).
                if (label.options.underline !== (termMode || testMode)) { label.options.underline = (termMode || testMode); needsRedraw = true; }
                if ((termMode || testMode) && label.options.underlineColor !== label.options.textColor) { label.options.underlineColor = label.options.textColor; needsRedraw = true; }
                // MVT station labels: base color (white/green) OR history-highlight (orange)
                {
                  const desiredTextColor = historyHighlighted ? highlightTextColor : baseTextColor;
                  if (label.options.textColor !== desiredTextColor) { label.options.textColor = desiredTextColor; needsRedraw = true; }
                  // Keep underline color in sync with the resolved text color (including history highlight override).
                  if ((termMode || testMode) && label.options.underlineColor !== desiredTextColor) { label.options.underlineColor = desiredTextColor; needsRedraw = true; }
                  if (historyHighlighted) {
                    if (label.options.bgColor !== highlightBgColor) { label.options.bgColor = highlightBgColor; needsRedraw = true; }
                    if (label.options.bgPaddingX !== 4) { label.options.bgPaddingX = 4; needsRedraw = true; }
                    if (label.options.bgPaddingY !== 2) { label.options.bgPaddingY = 2; needsRedraw = true; }
                    if (label.options.bgCornerRadius !== 3) { label.options.bgCornerRadius = 3; needsRedraw = true; }
                  } else {
                    if (label.options.bgColor != null) { label.options.bgColor = null; needsRedraw = true; }
                    if (label.options.bgPaddingX !== 0) { label.options.bgPaddingX = 0; needsRedraw = true; }
                    if (label.options.bgPaddingY !== 0) { label.options.bgPaddingY = 0; needsRedraw = true; }
                    if (label.options.bgCornerRadius !== 0) { label.options.bgCornerRadius = 0; needsRedraw = true; }
                  }
                }
              }
            } else {
              label._mvtStationNorm = '';
              label._mvtStationLabel = '';
              label._mvtLocked = false;
              if (label.options.radius !== 0) { label.options.radius = 0; needsRedraw = true; }
              if (label.options.interactive !== false) { label.options.interactive = false; needsRedraw = true; }
              if (label.options.underline) { label.options.underline = false; needsRedraw = true; }
              if (label.options.underlineColor) { label.options.underlineColor = null; needsRedraw = true; }
              if (label.options.textBaseSize !== stringTextBaseSizeCfg) { label.options.textBaseSize = stringTextBaseSizeCfg; needsRedraw = true; }
              // Clear background when pooled label is reused for non-SS text
              if (label.options.bgColor != null) { label.options.bgColor = null; needsRedraw = true; }
              if (label.options.bgPaddingX !== 0) { label.options.bgPaddingX = 0; needsRedraw = true; }
              if (label.options.bgPaddingY !== 0) { label.options.bgPaddingY = 0; needsRedraw = true; }
              if (label.options.bgCornerRadius !== 0) { label.options.bgCornerRadius = 0; needsRedraw = true; }
            }
          }
        }

        // LVTT: update per-draw metadata for SS/SUB labels and keep underline + history highlight in sync.
        if (isLVTT) {
          const raw = String(pt.text || '').trim();
          const subNorm = lvttCanonicalSubNorm(raw);
          if (subNorm) {
            // LVTT: match SS/SUB label sizing to CSS level (no downscale)
            const lvttSubTextBaseSizeLocal = Math.max(1, Number(stringTextBaseSizeCfg));
            const maxInv = lvttMaxInvForSubNorm(subNorm);
            const historyHighlighted =
              Boolean(historyOpenRef.current) &&
              Boolean(historySelectedRecordIdRef.current) &&
              Boolean(lvttHistoryHighlightSubSetRef.current?.has(subNorm));
            const highlightBgColor = 'rgba(249,115,22,1)'; // #f97316
            const highlightTextColor = 'rgba(11,18,32,0.98)';

            label._lvttSubNorm = subNorm;
            label._lvttSubId = raw;
            label._lvttSubMax = maxInv;
            if (label.options.interactive !== true) { label.options.interactive = true; needsRedraw = true; }
            if (label.options.radius !== 22) { label.options.radius = 22; needsRedraw = true; }
            if (label.options.underline !== true) { label.options.underline = true; needsRedraw = true; }
            if (label.options.textBaseSize !== lvttSubTextBaseSizeLocal) { label.options.textBaseSize = lvttSubTextBaseSizeLocal; needsRedraw = true; }

            // Underline should match current text color (including history highlight override).
            if (label.options.underlineColor !== label.options.textColor) { label.options.underlineColor = label.options.textColor; needsRedraw = true; }

            // Orange background highlight when a history record is selected.
            if (historyHighlighted) {
              if (label.options.bgColor !== highlightBgColor) { label.options.bgColor = highlightBgColor; needsRedraw = true; }
              if (label.options.bgPaddingX !== 4) { label.options.bgPaddingX = 4; needsRedraw = true; }
              if (label.options.bgPaddingY !== 2) { label.options.bgPaddingY = 2; needsRedraw = true; }
              if (label.options.bgCornerRadius !== 3) { label.options.bgCornerRadius = 3; needsRedraw = true; }
              // Ensure highlighted text stays readable.
              if (label.options.textColor !== highlightTextColor) { label.options.textColor = highlightTextColor; needsRedraw = true; }
            } else {
              if (label.options.bgColor != null) { label.options.bgColor = null; needsRedraw = true; }
              if (label.options.bgPaddingX !== 0) { label.options.bgPaddingX = 0; needsRedraw = true; }
              if (label.options.bgPaddingY !== 0) { label.options.bgPaddingY = 0; needsRedraw = true; }
              if (label.options.bgCornerRadius !== 0) { label.options.bgCornerRadius = 0; needsRedraw = true; }
            }
          } else {
            label._lvttSubNorm = '';
            label._lvttSubId = '';
            label._lvttSubMax = 0;
            if (label.options.underline) { label.options.underline = false; needsRedraw = true; }
            if (label.options.underlineColor) { label.options.underlineColor = null; needsRedraw = true; }
            if (label.options.interactive !== false) { label.options.interactive = false; needsRedraw = true; }
            if (label.options.radius !== 0) { label.options.radius = 0; needsRedraw = true; }

            // Revert pooled labels back to default sizing when reused for non-SUB text.
            if (label.options.textBaseSize !== stringTextBaseSizeCfg) { label.options.textBaseSize = stringTextBaseSizeCfg; needsRedraw = true; }

            // Clear history highlight background when pooled label is reused.
            if (label.options.bgColor != null) { label.options.bgColor = null; needsRedraw = true; }
            if (label.options.bgPaddingX !== 0) { label.options.bgPaddingX = 0; needsRedraw = true; }
            if (label.options.bgPaddingY !== 0) { label.options.bgPaddingY = 0; needsRedraw = true; }
            if (label.options.bgCornerRadius !== 0) { label.options.bgCornerRadius = 0; needsRedraw = true; }
          }
        }

        // DCTT Testing Mode: setup string text label click handler
        if (isDCTT && String(dcttSubModeRef.current || 'termination') === 'testing') {
          const rawText = String(pt.text || '').trim();
          const stringIdNorm = pt.stringId || dcttTestNormalizeId(rawText);
          const selectedIdNorm = String(dcttTestPopupRef.current?.idNorm || '');
          const isSelected = Boolean(selectedIdNorm) && selectedIdNorm === String(stringIdNorm || '');

          // Bind click handler if not already bound
          if (!label._dcttTestHandlersBound) {
            label.on('click', (evt) => {
              try {
                if (evt?.originalEvent) {
                  evt.originalEvent.stopImmediatePropagation?.();
                  L.DomEvent.stopPropagation(evt.originalEvent);
                  L.DomEvent.preventDefault(evt.originalEvent);
                }
              } catch (_e) { void _e; }

              // Only active in testing mode
              if (String(dcttSubModeRef.current || 'termination') !== 'testing') return;

              const idNorm = label._dcttStringIdNorm;
              if (!idNorm) return;

              const oe = evt?.originalEvent;
              const x = oe?.clientX ?? 0;
              const y = oe?.clientY ?? 0;

              // Get existing riso data
              const rec = dcttTestRisoByIdRef.current?.[idNorm] || null;
              const isInCsv = rec !== null;
              const plus = rec?.plus != null ? String(rec.plus).trim() : '';
              const minus = rec?.minus != null ? String(rec.minus).trim() : '';
              const plusVal = plus || (isInCsv ? '999' : '0');
              const minusVal = minus || (isInCsv ? '999' : '0');
              const st = dcttTestNormalizeStatus(rec?.status || rec?.remarkRaw) || null;
              const displayId = dcttTestFormatDisplayId(idNorm, rec?.originalId);

              setDcttTestPopup((prev) => {
                if (prev && prev.idNorm === idNorm) return null;
                return {
                  idNorm,
                  displayId,
                  draftPlus: plusVal,
                  draftMinus: minusVal,
                  draftStatus: st,
                  x,
                  y,
                };
              });
            });

            label.on('mouseover', () => {
              try { map.getContainer().style.cursor = 'pointer'; } catch (_e) { void _e; }
            });
            label.on('mouseout', () => {
              try { map.getContainer().style.cursor = ''; } catch (_e) { void _e; }
            });

            label._dcttTestHandlersBound = true;
          }

          // Store metadata for click handler
          label._dcttStringIdNorm = stringIdNorm;
          label._dcttDisplayId = rawText;

          // Update label styling for testing mode
          if (label.options.interactive !== true) { label.options.interactive = true; needsRedraw = true; }
          if (label.options.radius !== 22) { label.options.radius = 22; needsRedraw = true; }
          if (label.options.underline !== true) { label.options.underline = true; needsRedraw = true; }
          if (label.options.underlineColor !== label.options.textColor) { label.options.underlineColor = label.options.textColor; needsRedraw = true; }
          // Make the clicked/active string label more visually distinct.
          if (label.options.underlineWidthFactor !== (isSelected ? 1.8 : 1)) { label.options.underlineWidthFactor = isSelected ? 1.8 : 1; needsRedraw = true; }
          if (isSelected) {
            if (label.options.bgColor !== 'rgba(11,18,32,0.85)') { label.options.bgColor = 'rgba(11,18,32,0.85)'; needsRedraw = true; }
            if (label.options.bgPaddingX !== 4) { label.options.bgPaddingX = 4; needsRedraw = true; }
            if (label.options.bgPaddingY !== 2) { label.options.bgPaddingY = 2; needsRedraw = true; }
            if (label.options.bgCornerRadius !== 3) { label.options.bgCornerRadius = 3; needsRedraw = true; }
            const desiredStrokeFactor = Math.max(0.5, Number(stringTextStrokeWidthFactorCfg) || 1) * 1.35;
            if (label.options.textStrokeWidthFactor !== desiredStrokeFactor) { label.options.textStrokeWidthFactor = desiredStrokeFactor; needsRedraw = true; }
          } else {
            if (label.options.bgColor != null) { label.options.bgColor = null; needsRedraw = true; }
            if (label.options.bgPaddingX !== 0) { label.options.bgPaddingX = 0; needsRedraw = true; }
            if (label.options.bgPaddingY !== 0) { label.options.bgPaddingY = 0; needsRedraw = true; }
            if (label.options.bgCornerRadius !== 0) { label.options.bgCornerRadius = 0; needsRedraw = true; }
            const desiredStrokeFactor = Math.max(0.5, Number(stringTextStrokeWidthFactorCfg) || 1);
            if (label.options.textStrokeWidthFactor !== desiredStrokeFactor) { label.options.textStrokeWidthFactor = desiredStrokeFactor; needsRedraw = true; }
          }
        } else if (isDCTT) {
          // Not in testing mode - reset interactive state
          label._dcttStringIdNorm = '';
          label._dcttDisplayId = '';
          if (label.options.underline) { label.options.underline = false; needsRedraw = true; }
          if (label.options.underlineColor) { label.options.underlineColor = null; needsRedraw = true; }
          if (label.options.underlineWidthFactor !== 1) { label.options.underlineWidthFactor = 1; needsRedraw = true; }
          if (label.options.interactive !== false) { label.options.interactive = false; needsRedraw = true; }
          if (label.options.radius !== 0) { label.options.radius = 0; needsRedraw = true; }
          // Clear selection highlight styles when leaving testing mode.
          if (label.options.bgColor != null) { label.options.bgColor = null; needsRedraw = true; }
          if (label.options.bgPaddingX !== 0) { label.options.bgPaddingX = 0; needsRedraw = true; }
          if (label.options.bgPaddingY !== 0) { label.options.bgPaddingY = 0; needsRedraw = true; }
          if (label.options.bgCornerRadius !== 0) { label.options.bgCornerRadius = 0; needsRedraw = true; }
          const desiredStrokeFactor = Math.max(0.5, Number(stringTextStrokeWidthFactorCfg) || 1);
          if (label.options.textStrokeWidthFactor !== desiredStrokeFactor) { label.options.textStrokeWidthFactor = desiredStrokeFactor; needsRedraw = true; }
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

      // MVT termination mode: DO NOT render separate numeric counter labels next to SS/CSS.
      // Counts are edited via clicking the underlined SS/CSS label itself (LVTT-style).
      clearMvtCounterLabelsNow();

      // MVT: MV_TESTING uses the existing substation labels directly; no extra TEST_RESULTS label.

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

  // MVT: when CSV loads/changes, force label recompute so SS/SUB colors use latest L1/L2/L3 values.
  useEffect(() => {
    if (!isMVT) return;
    // Wait until map + string layer exist
    if (!mapRef.current || !stringTextLayerRef.current) return;
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isMVT, mvtCsvVersion, scheduleStringTextLabelUpdate]);

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

  // MVT: switching sub-modes changes which auxiliary labels are shown (termination counters only).
  useEffect(() => {
    if (!isMVT) return;
    setMvtTermPopup(null);
    setMvtTestPopup(null);
    if (String(mvtSubMode || 'termination') === 'testing') clearMvtCounterLabelsNow();
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isMVT, mvtSubMode, scheduleStringTextLabelUpdate, clearMvtCounterLabelsNow]);

  // DCCT: refresh labels when filter or test data changes
  useEffect(() => {
    if (!isDCCT) return;
    if (!mapRef.current || !stringTextLayerRef.current) return;
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isDCCT, dcctFilter, dcctTestData, dcctMapIds, scheduleStringTextLabelUpdate]);

  // DCTT Testing: refresh labels when test data, filter, or submode changes
  useEffect(() => {
    if (!isDCTT) return;
    if (!mapRef.current || !stringTextLayerRef.current) return;
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isDCTT, dcttSubMode, dcttTestData, dcttTestFilter, dcttTestMapIds, scheduleStringTextLabelUpdate]);

  // DCTT Testing: refresh labels when popup selection changes (clicked label highlight)
  useEffect(() => {
    if (!isDCTT) return;
    if (String(dcttSubMode || 'termination') !== 'testing') return;
    if (!mapRef.current || !stringTextLayerRef.current) return;
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isDCTT, dcttSubMode, dcttTestPopup, scheduleStringTextLabelUpdate]);

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

  const clearLvttSubCounterLabelsNow = useCallback(() => {
    const layer = lvttSubCounterLayerRef.current;
    if (!layer) return;
    const pool = lvttSubCounterLabelPoolRef.current;
    const prevActive = lvttSubCounterLabelActiveCountRef.current;
    for (let i = 0; i < prevActive; i++) {
      const lbl = pool[i];
      if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
    }
    lvttSubCounterLabelActiveCountRef.current = 0;
    try {
      lvttSubCounterRendererRef.current?._clear?.();
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
      if (obj && typeof obj === 'object') {
        const cleaned = {};
        for (const [k, v] of Object.entries(obj || {})) {
          const kk = mvtCanonicalTerminationStationNorm(k);
          if (!isMvtTerminationStationNorm(kk)) continue;
          const vv = clampMvtTerminationCount(kk, v);
          // If both padded/unpadded existed, keep the larger progress.
          cleaned[kk] = Math.max(Number(cleaned[kk] || 0), vv);
        }
        setMvtTerminationByStation(cleaned);
      }
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

  // LVTT: load/save SUB counters
  useEffect(() => {
    if (!isLVTT) {
      setLvttSubTerminationBySub({});
      return;
    }
    try {
      const raw = localStorage.getItem('cew:lvtt:sub_counts');
      const obj = raw ? JSON.parse(raw) : {};
      if (obj && typeof obj === 'object') setLvttSubTerminationBySub(obj);
      else setLvttSubTerminationBySub({});
    } catch (_e) {
      void _e;
      setLvttSubTerminationBySub({});
    }
  }, [isLVTT]);

  useEffect(() => {
    if (!isLVTT) return;
    try {
      localStorage.setItem('cew:lvtt:sub_counts', JSON.stringify(lvttSubTerminationBySub || {}));
    } catch (_e) {
      void _e;
    }
  }, [isLVTT, lvttSubTerminationBySub]);

  // MVT: load circuit test status CSV (grouped by `from`, phase L1/L2/L3 taken ONLY from that row group).
  useEffect(() => {
    if (!isMVT) {
      mvtTestCsvByFromRef.current = {};
      mvtTestToByFromRef.current = {};
      mvtTestResultsSubmittedRef.current = null;
      setMvtTestResultsDirty(false);
      setMvtTestPanel(null);
      setMvtTestPopup(null);
      setMvtCsvTotals({ total: 0, fromRows: 0, toRows: 0 });
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
      if (lines.length <= 1) return { byFrom: {}, toByFrom: {}, fromRows: 0, toRows: 0 };
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
      const toByFrom = {};
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
          if (rawTo && !toByFrom[fromKey]) toByFrom[fromKey] = String(rawTo || '').trim();
          if (!out[fromKey]) out[fromKey] = {};
          out[fromKey][phaseKey] = {
            // Show only the numeric test value (no unit like GΩ / G?)
            value: rawVal ? `${rawVal}` : '',
            status,
          };
        }
        return { byFrom: out, toByFrom, fromRows, toRows };
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
        if (rawTo && !toByFrom[fromKey]) toByFrom[fromKey] = String(rawTo || '').trim();
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
      return { byFrom: out, toByFrom, fromRows, toRows, _meta: { textLen: rawText.length, rawLines: rawLinesArr.length, filteredLines: lines.length, keys: Object.keys(out).length } };
    };

    // Prefer user's last submitted MV_TESTING data (if any)
    // This makes the app behave as-if the directory CSV contained those values.
    try {
      const saved = localStorage.getItem('cew:mvt:test_results_submitted');
      if (saved) {
        const obj = JSON.parse(saved);
        if (obj && typeof obj === 'object' && obj.byFrom && typeof obj.byFrom === 'object') {
          mvtTestCsvByFromRef.current = obj.byFrom || {};
          mvtTestToByFromRef.current = (obj.toByFrom && typeof obj.toByFrom === 'object') ? obj.toByFrom : {};
          mvtTestResultsSubmittedRef.current = obj;
          setMvtTestResultsDirty(false);
          setMvtCsvVersion((v) => v + 1);
          lastStringLabelKeyRef.current = '';
          scheduleStringTextLabelUpdate();
          return () => { cancelled = true; };
        }
      }
    } catch (_e) {
      void _e;
    }

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
      mvtTestToByFromRef.current = parsed.toByFrom || {};
      mvtTestResultsSubmittedRef.current = {
        byFrom: parsed.byFrom || {},
        toByFrom: parsed.toByFrom || {},
        updatedAt: new Date().toISOString(),
        source: 'default',
      };
      setMvtTestResultsDirty(false);
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
      // Force a redraw so SS/SUB colors reflect the loaded CSV immediately.
      lastStringLabelKeyRef.current = '';
      scheduleStringTextLabelUpdate();
    })();

    return () => {
      cancelled = true;
    };
  }, [isMVT, scheduleStringTextLabelUpdate]);

  const mvtUpdateTestPhase = useCallback((fromKeyRaw, phaseRaw, patch) => {
    const fromKey = normalizeId(fromKeyRaw);
    const phase = String(phaseRaw || '').trim().toUpperCase();
    if (!fromKey) return;
    if (phase !== 'L1' && phase !== 'L2' && phase !== 'L3') return;
    const byFrom = mvtTestCsvByFromRef.current || {};
    if (!byFrom[fromKey] || typeof byFrom[fromKey] !== 'object') byFrom[fromKey] = {};
    const prev = (byFrom[fromKey][phase] && typeof byFrom[fromKey][phase] === 'object')
      ? byFrom[fromKey][phase]
      : { value: '', status: 'N/A' };
    const next = {
      value: prev?.value != null ? String(prev.value) : '',
      status: prev?.status != null ? String(prev.status) : 'N/A',
      ...(patch && typeof patch === 'object' ? patch : {}),
    };
    const su = String(next.status || '').trim().toUpperCase();
    if (!su || su === 'N/A' || su === 'NA') next.status = 'N/A';
    else if (su === 'PASS') next.status = 'PASS';
    else next.status = 'failed';
    byFrom[fromKey][phase] = next;
    mvtTestCsvByFromRef.current = byFrom;
    setMvtTestResultsDirty(true);
    setMvtCsvVersion((v) => v + 1);
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [scheduleStringTextLabelUpdate]);

  const mvtImportTestResultsFromText = useCallback((csvText) => {
    const rawText = String(csvText || '');
    const rawLinesArr = rawText.split(/\r?\n/);
    const lines = rawLinesArr.map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      alert('CSV looks empty or invalid.');
      return;
    }
    const first = String(lines[0] || '');
    const sep = (first.includes(';') && first.split(';').length > first.split(',').length) ? ';' : ',';
    const headerRaw = first.split(sep).map((h) => h.replace(/^\uFEFF/, '').trim());
    const header = headerRaw.map((h) => h.toLowerCase());
    const fromIdx = header.findIndex((h) => h === 'from');
    const phaseIdx = header.findIndex((h) => h === 'phase');
    const remarksIdx = header.findIndex((h) => h === 'remarks' || h === 'result' || h === 'status');
    const valueIdx = header.findIndex((h) => h.includes('gω') || h.includes('gohm') || h.includes('value') || h === 'l1' || h === 'l2' || h === 'l3');
    const toIdx = header.findIndex((h) => h === 'to');

    const out = {};
    const toByFrom = {};
    let fromRows = 0;
    let toRows = 0;

    const normStatus = (s) => {
      const raw = String(s || '').trim();
      const u = raw.toUpperCase();
      if (!u || u === 'N/A' || u === 'NA') return 'N/A';
      if (u === 'PASS') return 'PASS';
      if (u.startsWith('FAIL')) return 'failed';
      return 'failed';
    };

    if (phaseIdx >= 0) {
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
        if (!fromKey) continue;
        if (phaseKey !== 'L1' && phaseKey !== 'L2' && phaseKey !== 'L3') continue;
        fromRows += 1;
        if (toKey) toRows += 1;
        if (rawTo && !toByFrom[fromKey]) toByFrom[fromKey] = String(rawTo || '').trim();
        if (!out[fromKey]) out[fromKey] = {};
        out[fromKey][phaseKey] = { value: rawVal ? `${rawVal}` : '', status: normStatus(rawRemarks) };
      }
    } else {
      const l1Idx = header.findIndex((h) => h === 'l1' || h.startsWith('l1'));
      const l2Idx = header.findIndex((h) => h === 'l2' || h.startsWith('l2'));
      const l3Idx = header.findIndex((h) => h === 'l3' || h.startsWith('l3'));
      const findPhaseStatusIdx = (phase) => {
        const p = phase.toLowerCase();
        return header.findIndex((h) => (h.startsWith(p) && (h.includes('remark') || h.includes('status') || h.includes('result'))));
      };
      const l1StatusIdx = findPhaseStatusIdx('L1');
      const l2StatusIdx = findPhaseStatusIdx('L2');
      const l3StatusIdx = findPhaseStatusIdx('L3');
      const mkVal = (parts, idx) => {
        const v = idx >= 0 ? parts[idx] : '';
        const s = String(v || '').trim();
        return s ? `${s}` : '';
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
        if (rawTo && !toByFrom[fromKey]) toByFrom[fromKey] = String(rawTo || '').trim();
        if (!out[fromKey]) out[fromKey] = {};
        const s1 = l1StatusIdx >= 0 ? normStatus(parts[l1StatusIdx]) : 'N/A';
        const s2 = l2StatusIdx >= 0 ? normStatus(parts[l2StatusIdx]) : 'N/A';
        const s3 = l3StatusIdx >= 0 ? normStatus(parts[l3StatusIdx]) : 'N/A';
        out[fromKey].L1 = { value: mkVal(parts, l1Idx), status: s1 };
        out[fromKey].L2 = { value: mkVal(parts, l2Idx), status: s2 };
        out[fromKey].L3 = { value: mkVal(parts, l3Idx), status: s3 };
      }
    }

    mvtTestCsvByFromRef.current = out;
    mvtTestToByFromRef.current = toByFrom;
    setMvtTestResultsDirty(true);
    setMvtTestPopup(null);
    setMvtCsvTotals({ total: (fromRows + toRows) * 3, fromRows, toRows });
    setMvtCsvVersion((v) => v + 1);
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [scheduleStringTextLabelUpdate]);

  const mvtSubmitTestResults = useCallback(() => {
    const byFrom = mvtTestCsvByFromRef.current || {};
    const toByFrom = mvtTestToByFromRef.current || {};
    const payload = {
      byFrom,
      toByFrom,
      updatedAt: new Date().toISOString(),
      source: 'user',
    };
    try {
      localStorage.setItem('cew:mvt:test_results_submitted', JSON.stringify(payload));
    } catch (_e) {
      void _e;
    }
    mvtTestResultsSubmittedRef.current = payload;
    setMvtTestResultsDirty(false);
    setMvtTestFilter(null);
    setMvtCsvVersion((v) => v + 1);
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
    alert('Test results submitted successfully!');
  }, [scheduleStringTextLabelUpdate]);

  const mvtExportTestResultsCsv = useCallback(() => {
    if (mvtTestResultsDirty) {
      alert('Please submit test results before exporting.');
      return;
    }
    const payload = mvtTestResultsSubmittedRef.current;
    if (!payload || !payload.byFrom) {
      alert('No submitted test results to export.');
      return;
    }
    const byFrom = payload.byFrom || {};
    const toByFrom = payload.toByFrom || {};
    const rows = ['from,to,phase,L1 (GΩ),remarks'];
    const keys = Object.keys(byFrom).sort();
    const displayFrom = (k) => {
      const norm = normalizeId(k);
      if (norm === 'css') return 'CSS';
      const m = norm.match(/^(ss|sub)(\d{1,2})$/i);
      if (m) {
        const nn = String(parseInt(m[2], 10)).padStart(2, '0');
        return `SUB${nn}`;
      }
      return String(k || '').toUpperCase();
    };
    keys.forEach((fromKey) => {
      const row = byFrom[fromKey] || {};
      const toRaw = String(toByFrom[fromKey] || '').trim();
      (['L1', 'L2', 'L3']).forEach((ph) => {
        const obj = row?.[ph] || { value: '', status: 'N/A' };
        const val = String(obj?.value || '').trim();
        const status = String(obj?.status || 'N/A').trim();
        rows.push(`${displayFrom(fromKey)},${toRaw},${ph},${val},${status}`);
      });
    });
    const csvContent = rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mv_circuits_test_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [mvtTestResultsDirty]);

  const mvtExportFilteredTestResultsCsv = useCallback(() => {
    try {
      if (mvtTestResultsDirty) return;
      const activeFilter = mvtTestFilterRef.current;
      if (!activeFilter) return;

      let submitted = mvtTestResultsSubmittedRef.current;
      if (!submitted) {
        try {
          const raw = localStorage.getItem('cew:mvt:test_results_submitted');
          if (raw) submitted = JSON.parse(raw);
        } catch (_e) {
          void _e;
        }
      }
      const byFrom = (submitted && typeof submitted === 'object') ? (submitted.byFrom || {}) : {};
      const toByFrom = (submitted && typeof submitted === 'object') ? (submitted.toByFrom || {}) : {};

      const classify = (stRaw) => {
        const u = String(stRaw || '').trim().toUpperCase();
        if (u === 'PASS') return 'passed';
        if (u === 'FAIL' || u === 'FAILED' || u.startsWith('FAIL')) return 'failed';
        return 'not_tested';
      };

      // For NOT TESTED, include stations present on the map even if missing in CSV (exclude CSS)
      const mapStations = new Set();
      if (activeFilter === 'not_tested') {
        const pts = mvtStationPointsRef.current || [];
        pts.forEach((pt) => {
          const raw = String(pt?.stationLabel || pt?.label || pt?.text || '').trim();
          const stationNorm = mvtCanonicalTerminationStationNorm(raw);
          if (!stationNorm) return;
          if (!isMvtTerminationStationNorm(stationNorm)) return;
          if (stationNorm === 'css') return;
          mapStations.add(stationNorm);
        });
      }

      const keys = activeFilter === 'not_tested'
        ? Array.from(new Set([...Object.keys(byFrom || {}), ...Array.from(mapStations)])).sort()
        : Object.keys(byFrom || {}).sort();

      const displayFrom = (k) => {
        const norm = normalizeId(k);
        const m = norm.match(/^(ss|sub)(\d{1,2})$/i);
        if (m) {
          const nn = String(parseInt(m[2], 10)).padStart(2, '0');
          return `SUB${nn}`;
        }
        return String(k || '').toUpperCase();
      };

      const rows = ['from,to,phase,L1 (GΩ),remarks'];
      keys.forEach((fromKey) => {
        const row = byFrom?.[fromKey] || {};
        const toRaw = String(toByFrom?.[fromKey] || '').trim();
        (['L1', 'L2', 'L3']).forEach((ph) => {
          const obj = row?.[ph] || { value: '', status: 'N/A' };
          const val = String(obj?.value || '').trim();
          const st = String(obj?.status || 'N/A').trim();
          const bucket = classify(st);
          if (activeFilter === 'passed' && bucket !== 'passed') return;
          if (activeFilter === 'failed' && bucket !== 'failed') return;
          if (activeFilter === 'not_tested' && bucket !== 'not_tested') return;
          rows.push(`${displayFrom(fromKey)},${toRaw},${ph},${val},${st}`);
        });
      });

      const csvContent = rows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const tag = String(activeFilter).toLowerCase();
      link.download = `mv_circuits_test_${tag}_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting filtered MVT CSV:', err);
    }
  }, [mvtTestResultsDirty]);

  const lvttComputeTestTotals = useCallback((byInv) => {
    const rows = byInv && typeof byInv === 'object' ? byInv : {};
    let total = 0;
    let passed = 0;
    let failed = 0;
    Object.keys(rows).forEach((invKey) => {
      const obj = rows?.[invKey] || {};
      (['L1', 'L2', 'L3']).forEach((ph) => {
        if (!obj || !Object.prototype.hasOwnProperty.call(obj, ph)) return;
        total += 1;
        const st = String(obj?.[ph]?.status || 'N/A').trim().toUpperCase();
        if (st === 'PASS') passed += 1;
        else if (st === 'FAILED' || st === 'FAIL') failed += 1;
      });
    });
    return { total, passed, failed };
  }, []);

  const lvttImportTestResultsFromText = useCallback((csvText) => {
    const rawText = String(csvText || '');
    const rawLinesArr = rawText.split(/\r?\n/);
    const lines = rawLinesArr.map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) {
      lvttTestCsvByInvRef.current = {};
      setLvttCsvTotals({ total: 0, passed: 0, failed: 0 });
      setLvttTestResultsDirty(true);
      setLvttPopup(null);
      setLvttCsvVersion((v) => v + 1);
      return;
    }

    const first = String(lines[0] || '');
    const sep = (first.includes(';') && first.split(';').length > first.split(',').length) ? ';' : ',';
    const headerRaw = first
      .split(sep)
      .map((h) => h.replace(/^\uFEFF/, '').trim());
    const header = headerRaw.map((h) => h.toLowerCase());

    const invIdIdx = header.findIndex((h) => h === 'ind_id' || h === 'inv_id' || h === 'id');
    const phaseIdx = header.findIndex((h) => h === 'phase');
    const valueIdx = header.findIndex((h) => h === 'value' || h.includes('gω') || h.includes('gohm'));
    const remarksIdx = header.findIndex((h) => h === 'remarks' || h === 'result' || h === 'status');

    const normStatus = (s) => {
      const raw = String(s || '').trim();
      const u = raw.toUpperCase();
      if (!u) return 'N/A';
      if (u === 'N/A' || u === 'NA') return 'N/A';
      if (u === 'PASS') return 'PASS';
      if (u.startsWith('FAIL')) return 'FAILED';
      return 'FAILED';
    };

    const out = {};
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

      if (!out[invKey]) out[invKey] = {};
      out[invKey][phaseKey] = {
        value: rawValue || '',
        status: normStatus(rawRemarks),
      };
    }

    lvttTestCsvByInvRef.current = out;
    lvttTestResultsSubmittedRef.current = null;
    setLvttTestResultsDirty(true);
    setLvttPopup(null);
    setLvttCsvTotals(lvttComputeTestTotals(out));
    setLvttCsvVersion((v) => v + 1);
  }, [lvttComputeTestTotals]);

  const lvttUpdateTestPhase = useCallback((invNorm, phase, patch) => {
    const invKey = normalizeId(invNorm);
    const ph = String(phase || '').trim().toUpperCase();
    if (!invKey) return;
    if (ph !== 'L1' && ph !== 'L2' && ph !== 'L3') return;

    const byInv = lvttTestCsvByInvRef.current || {};
    if (!byInv[invKey]) byInv[invKey] = {};
    const prev = byInv[invKey]?.[ph] && typeof byInv[invKey][ph] === 'object' ? byInv[invKey][ph] : { value: '', status: 'N/A' };
    const next = { ...prev, ...(patch || {}) };
    const statusU = String(next.status || 'N/A').trim().toUpperCase();
    if (statusU === 'PASS') next.status = 'PASS';
    else if (statusU === 'FAIL' || statusU === 'FAILED') next.status = 'FAILED';
    else next.status = 'N/A';

    byInv[invKey][ph] = next;
    lvttTestCsvByInvRef.current = byInv;
    lvttTestResultsSubmittedRef.current = null;
    setLvttTestResultsDirty(true);
    setLvttCsvTotals(lvttComputeTestTotals(byInv));
    setLvttCsvVersion((v) => v + 1);
  }, [lvttComputeTestTotals]);

  const lvttSubmitTestResults = useCallback(() => {
    const byInv = lvttTestCsvByInvRef.current || {};
    const payload = {
      byInv,
      updatedAt: new Date().toISOString(),
      source: 'user',
    };
    try {
      localStorage.setItem('cew:lvtt:test_results_submitted', JSON.stringify(payload));
    } catch (_e) {
      void _e;
    }
    lvttTestResultsSubmittedRef.current = payload;
    setLvttTestResultsDirty(false);
    setLvttTestFilter(null);
    setLvttCsvTotals(lvttComputeTestTotals(byInv));
    setLvttCsvVersion((v) => v + 1);
    alert('Test results submitted successfully!');
  }, [lvttComputeTestTotals]);

  const lvttExportTestResultsCsv = useCallback(() => {
    if (lvttTestResultsDirty) {
      alert('Please submit test results before exporting.');
      return;
    }

    // Prefer submitted snapshot (user edits), but if there is none and we have a default
    // CSV loaded from disk, export that as well.
    const payload = lvttTestResultsSubmittedRef.current;
    const byInv = (payload && payload.byInv && typeof payload.byInv === 'object')
      ? (payload.byInv || {})
      : (lvttTestCsvByInvRef.current || {});

    if (!byInv || Object.keys(byInv).length === 0) {
      alert('No test results to export.');
      return;
    }

    const rows = ['ind_id,phase,value,remarks'];
    const keys = Object.keys(byInv).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
    const displayInv = (invNorm) => {
      const meta = lvttInvMetaByNormRef.current?.[normalizeId(invNorm)] || null;
      const display = String(meta?.displayId || '').trim();
      if (display) return display;
      return String(invNorm || '').toUpperCase();
    };
    keys.forEach((invKey) => {
      const row = byInv[invKey] || {};
      (['L1', 'L2', 'L3']).forEach((ph) => {
        const obj = row?.[ph] || { value: '', status: 'N/A' };
        const val = String(obj?.value || '').trim();
        const status = String(obj?.status || 'N/A').trim();
        rows.push(`${displayInv(invKey)},${ph},${val},${status}`);
      });
    });
    const csvContent = rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lv_testing_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [lvttTestResultsDirty]);

  const lvttExportFilteredTestResultsCsv = useCallback(() => {
    try {
      if (lvttTestResultsDirty) return;
      const activeFilter = lvttTestFilterRef.current;
      if (!activeFilter) return;

      let submitted = lvttTestResultsSubmittedRef.current;
      if (!submitted) {
        try {
          const raw = localStorage.getItem('cew:lvtt:test_results_submitted');
          if (raw) submitted = JSON.parse(raw);
        } catch (_e) {
          void _e;
        }
      }

      // Prefer submitted snapshot; fall back to the currently loaded CSV.
      const byInv = (submitted && typeof submitted === 'object' && submitted.byInv && typeof submitted.byInv === 'object')
        ? (submitted.byInv || {})
        : (lvttTestCsvByInvRef.current || {});
      const metaKeys = Object.keys(lvttInvMetaByNormRef.current || {});

      const classify = (stRaw) => {
        const u = String(stRaw || '').trim().toUpperCase();
        if (u === 'PASS') return 'passed';
        if (u === 'FAIL' || u === 'FAILED' || u.startsWith('FAIL')) return 'failed';
        return 'not_tested';
      };

      const keys = activeFilter === 'not_tested'
        ? Array.from(new Set([...Object.keys(byInv || {}), ...metaKeys]))
          .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }))
        : Object.keys(byInv || {}).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));

      const displayInv = (invNorm) => {
        const meta = lvttInvMetaByNormRef.current?.[normalizeId(invNorm)] || null;
        const display = String(meta?.displayId || '').trim();
        if (display) return display;
        return String(invNorm || '').toUpperCase();
      };

      const rows = ['ind_id,phase,value,remarks'];
      keys.forEach((invKey) => {
        const row = byInv?.[invKey] || {};
        (['L1', 'L2', 'L3']).forEach((ph) => {
          const obj = row?.[ph] || { value: '', status: 'N/A' };
          const val = String(obj?.value || '').trim();
          const st = String(obj?.status || 'N/A').trim();
          const bucket = classify(st);
          if (activeFilter === 'passed' && bucket !== 'passed') return;
          if (activeFilter === 'failed' && bucket !== 'failed') return;
          if (activeFilter === 'not_tested' && bucket !== 'not_tested') return;
          rows.push(`${displayInv(invKey)},${ph},${val},${st}`);
        });
      });

      if (rows.length <= 1) {
        alert('No matching test results to export for the selected filter.');
        return;
      }

      const csvContent = rows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const tag = String(activeFilter).toLowerCase();
      link.download = `lv_testing_${tag}_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting filtered LVTT CSV:', err);
    }
  }, [lvttTestResultsDirty]);

  // LVTT: load inverter test status CSV (grouped by `ind_id`, phase L1/L2/L3 rows per inverter).
  useEffect(() => {
    if (!isLVTT) {
      lvttTestCsvByInvRef.current = {};
      lvttInvMetaByNormRef.current = {};
      setLvttPopup(null);
      setLvttCsvTotals({ total: 0, passed: 0, failed: 0 });
      setLvttTestResultsDirty(false);
      lvttTestResultsSubmittedRef.current = null;
      setLvttCsvVersion((v) => v + 1);
      clearLvttTermCounterLabelsNow();
      return;
    }

    // Prefer the last submitted snapshot (if any)
    try {
      const raw = localStorage.getItem('cew:lvtt:test_results_submitted');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.byInv && typeof parsed.byInv === 'object') {
        lvttTestCsvByInvRef.current = parsed.byInv;
        lvttTestResultsSubmittedRef.current = parsed;
        setLvttTestResultsDirty(false);
        setLvttPopup(null);
        setLvttCsvTotals(lvttComputeTestTotals(parsed.byInv));
        setLvttCsvVersion((v) => v + 1);
        return;
      }
    } catch (_e) {
      void _e;
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
      setLvttTestResultsDirty(false);
      lvttTestResultsSubmittedRef.current = null;
      setLvttCsvVersion((v) => v + 1);
      // eslint-disable-next-line no-console
      console.log('[LVTT CSV] loaded', { inverters: Object.keys(lvttTestCsvByInvRef.current).length, passed: parsed.passed, failed: parsed.failed });
    })();

    return () => {
      cancelled = true;
    };
  }, [isLVTT, clearLvttTermCounterLabelsNow, lvttComputeTestTotals]);

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

      const activeFilter = lvttTestFilterRef.current;

      if (mode === 'termination') {
        const terminated = Math.max(0, Math.min(3, Number(lvttTerminationByInvRef.current?.[invNorm] ?? 0)));
        const locked = terminated === 3;
        // LVTT should match MC4-style: uncompleted = white, completed = green.
        nextColor = locked ? 'rgba(34,197,94,0.98)' : 'rgba(255,255,255,0.98)';
      } else {
        const testData = lvttTestCsvByInvRef.current?.[invNorm];
        const l1 = String(testData?.L1?.status || 'N/A').trim().toUpperCase();
        const l2 = String(testData?.L2?.status || 'N/A').trim().toUpperCase();
        const l3 = String(testData?.L3?.status || 'N/A').trim().toUpperCase();
        const anyFail = l1 === 'FAILED' || l2 === 'FAILED' || l3 === 'FAILED' || l1 === 'FAIL' || l2 === 'FAIL' || l3 === 'FAIL';
        const allPass = l1 === 'PASS' && l2 === 'PASS' && l3 === 'PASS';
        if (anyFail) nextColor = 'rgba(239,68,68,0.98)';
        else if (allPass) nextColor = 'rgba(34,197,94,0.98)';

        // Filter highlighting (DCCT-style): recolor matches and dim non-matches
        if (activeFilter) {
          const hasPass = l1 === 'PASS' || l2 === 'PASS' || l3 === 'PASS';
          const hasFail = anyFail;
          const hasNA = (l1 === 'N/A') || (l2 === 'N/A') || (l3 === 'N/A');
          const matches = activeFilter === 'passed' ? hasPass : activeFilter === 'failed' ? hasFail : hasNA;
          if (matches) {
            nextColor = activeFilter === 'passed'
              ? 'rgba(34,197,94,0.98)'
              : activeFilter === 'failed'
                ? 'rgba(239,68,68,0.98)'
                : 'rgba(148,163,184,0.98)';
          } else {
            nextColor = 'rgba(148,163,184,0.18)';
          }
        }
      }

      let redraw = false;
      if (lbl.options.text !== nextText) { lbl.options.text = nextText; redraw = true; }
      if (lbl.options.textColor !== nextColor) { lbl.options.textColor = nextColor; redraw = true; }
      // LVTT: show clickability by underlining the INV ID text (we no longer render separate 0/3 counters).
      if (lbl.options.underline !== true) { lbl.options.underline = true; redraw = true; }
      if (lbl.options.underlineColor !== nextColor) { lbl.options.underlineColor = nextColor; redraw = true; }
      lbl._lvttLocked = mode === 'termination' && nextColor === 'rgba(34,197,94,0.98)';
      if (redraw) lbl.redraw?.();
    };

    Object.keys(labels).forEach((k) => updateOne(k, labels[k]));
  }, [isLVTT, lvttSubMode, lvttTerminationByInv, lvttCsvTotals, lvttTestFilter]);

  // MVT: repaint SS/SUB labels when filter toggles (testing mode)
  useEffect(() => {
    if (!isMVT) return;
    if (String(mvtSubModeRef.current || 'termination') !== 'testing') return;
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isMVT, mvtTestFilter, scheduleStringTextLabelUpdate]);

  // LVTT: repaint SS/SUB labels when manual sub completion or TX->INV max mapping changes.
  useEffect(() => {
    if (!isLVTT) return;
    if (String(lvttSubModeRef.current || 'termination') !== 'termination') return;
    lastStringLabelKeyRef.current = '';
    scheduleStringTextLabelUpdate();
  }, [isLVTT, lvttSubTerminationBySub, lvttTxInvMaxVersion, scheduleStringTextLabelUpdate]);

  // LVTT: fallback hit-test for SS/SUB label clicks.
  // Canvas renderers can stack; only the top canvas receives DOM events, so per-label click handlers
  // can become unreliable. We detect clicks near SS/SUB label positions and open the same popup.
  useEffect(() => {
    if (!isLVTT || !mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const maxInvForSubNorm = (subNorm) => {
      const m = String(subNorm || '').match(/^(ss|sub)(\d{2})$/i);
      if (!m) return 0;
      const tx = parseInt(m[2], 10);
      if (!Number.isFinite(tx) || tx <= 0) return 0;
      const dict = lvttTxInvMaxByTxRef.current || {};
      return Math.max(0, Number(dict?.[tx] ?? dict?.[String(tx)] ?? 0) || 0);
    };

    const onMapClick = (evt) => {
      try {
        if (String(lvttSubModeRef.current || 'termination') !== 'termination') return;
        const clickP = evt?.containerPoint;
        if (!clickP) return;

        // If the click is near an inverter ID label, let its own handler win.
        try {
          const metaByNorm = lvttInvMetaByNormRef.current || {};
          const keys = Object.keys(metaByNorm);
          if (keys.length) {
            let bestInv = Infinity;
            const invThreshold = 26;
            for (const invNorm of keys) {
              const meta = metaByNorm[invNorm];
              if (!meta) continue;
              const lat = Number(meta.lat);
              const lng = Number(meta.lng);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
              const p = map.latLngToContainerPoint([lat, lng]);
              const d = p.distanceTo(clickP);
              if (d < bestInv) bestInv = d;
            }
            if (bestInv <= invThreshold) return;
          }
        } catch (_e) {
          void _e;
        }

        const pts = stringTextPointsRef.current || [];
        if (!pts.length) return;

        let best = null;
        let bestD = Infinity;
        const threshold = 28; // px

        for (let i = 0; i < pts.length; i++) {
          const pt = pts[i];
          const raw = String(pt?.text || '').trim();
          if (!raw) continue;
          const subNorm = lvttCanonicalSubNorm(raw);
          if (!subNorm) continue;
          const maxInv = maxInvForSubNorm(subNorm);
          if (!(maxInv > 0)) continue;
          const lat = Number(pt?.lat);
          const lng = Number(pt?.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const p = map.latLngToContainerPoint([lat, lng]);
          const d = p.distanceTo(clickP);
          if (d < bestD) {
            bestD = d;
            best = { raw, subNorm, maxInv };
          }
        }

        if (!best || !(bestD <= threshold)) return;

        const curRaw = Number(lvttSubTerminationBySubRef.current?.[best.subNorm] ?? 0);
        const cur = Math.max(0, Math.min(best.maxInv, Number.isFinite(curRaw) ? curRaw : 0));
        const oe = evt?.originalEvent;
        const x = oe?.clientX ?? 0;
        const y = oe?.clientY ?? 0;
        setLvttPopup({
          mode: 'sub_termination',
          subId: String(best.raw || ''),
          subNorm: best.subNorm,
          max: best.maxInv,
          draft: cur,
          x,
          y,
        });
      } catch (_e) {
        void _e;
      }
    };

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
  }, [isLVTT, mapReady, stringMatchVersion, lvttTxInvMaxVersion, lvttSubTerminationBySub, lvttSubMode, lvttCanonicalSubNorm]);

  // MVT: fallback hit-test for SS/SUB/CSS label clicks in termination mode.
  // Canvas renderers can stack; only the top canvas receives DOM events, so per-label click handlers
  // can become unreliable. Detect clicks near station label positions and open the same popup.
  useEffect(() => {
    if (!isMVT || !mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const canonicalStationNorm = (raw) => {
      const norm = normalizeId(raw);
      if (!norm) return '';
      if (norm === 'css') return 'css';
      const m = norm.match(/^(ss|sub)(\d{1,2})$/i);
      if (!m) return '';
      const prefix = String(m[1] || '').toLowerCase();
      const nn = String(parseInt(m[2], 10)).padStart(2, '0');
      return `${prefix}${nn}`;
    };

    const isStationNorm = (stationNorm) => {
      const norm = canonicalStationNorm(stationNorm);
      if (norm === 'css') return true;
      const m = norm.match(/^(ss|sub)(\d{2})$/i);
      if (!m) return false;
      const n = parseInt(m[2], 10);
      return Number.isFinite(n) && n >= 1 && n <= 6;
    };

    const onMapClick = (evt) => {
      try {
        if (noteMode) return;
        if (String(mvtSubModeRef.current || 'termination') !== 'termination') return;
        const clickP = evt?.containerPoint;
        if (!clickP) return;

        const pts = stringTextPointsRef.current || [];
        if (!pts.length) return;

        let best = null;
        let bestD = Infinity;
        const threshold = 28; // px (match LVTT feel)

        for (let i = 0; i < pts.length; i++) {
          const pt = pts[i];
          const raw = String(pt?.text || '').trim();
          if (!raw) continue;
          const stationNorm = canonicalStationNorm(raw);
          if (!(stationNorm && isStationNorm(stationNorm))) continue;

          const max = mvtTerminationMaxForNorm(stationNorm);
          if (!(max > 0)) continue;
          const cur = clampMvtTerminationCount(stationNorm, mvtTerminationByStationRef.current?.[stationNorm] ?? 0);
          const locked = max > 0 && cur === max;
          if (locked) continue;

          const lat = Number(pt?.lat);
          const lng = Number(pt?.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const p = map.latLngToContainerPoint([lat, lng]);
          const d = p.distanceTo(clickP);
          if (d < bestD) {
            bestD = d;
            best = { stationLabel: raw, stationNorm, cur };
          }
        }

        if (!best || !(bestD <= threshold)) return;

        const oe = evt?.originalEvent;
        const x = oe?.clientX ?? 0;
        const y = oe?.clientY ?? 0;
        setMvtTermPopup({
          stationLabel: String(best.stationLabel || '').trim() || best.stationNorm,
          stationNorm: best.stationNorm,
          draft: best.cur,
          x,
          y,
        });
      } catch (_e) {
        void _e;
      }
    };

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
  }, [isMVT, mapReady, noteMode, mvtSubMode]);

  // LVTT: we no longer render numeric counters on the map (0/3, 0/26).
  // Clickability is represented by underlined INV + SS/SUB labels.
  useEffect(() => {
    if (!isLVTT) return;
    clearLvttTermCounterLabelsNow();
  }, [isLVTT, lvttSubMode, clearLvttTermCounterLabelsNow]);

  useEffect(() => {
    if (!isLVTT) return;
    clearLvttSubCounterLabelsNow();
  }, [isLVTT, lvttSubMode, clearLvttSubCounterLabelsNow]);

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
  const { dailyLog, addRecord, updateRecord, deleteRecord } = useDailyLog(activeMode?.key || 'DC');
  const { exportToExcel } = useChartExport();

  // DCTT: panel-side submitted/committed set (derived from history for "delete-only-via-history")
  const dcttCommittedPanelIds = useMemo(() => {
    if (!isDCTT) return new Set();
    const out = new Set();
    const today = String(dcttTodayYmd || '');
    (dailyLog || []).forEach((r) => {
      if (!r) return;
      if (String(r.date || '') !== today) return;
      const ids = r.selectedPolygonIds;
      if (!Array.isArray(ids) || ids.length === 0) return;
      ids.forEach((id) => {
        const s = String(id || '');
        if (s) out.add(s);
      });
    });
    return out;
  }, [dailyLog, isDCTT, dcttTodayYmd]);

  useEffect(() => {
    dcttCommittedPanelIdsRef.current = dcttCommittedPanelIds;
  }, [dcttCommittedPanelIds]);

  // Initialize editing state when a history record is selected
  useEffect(() => {
    if (historySelectedRecordId) {
      const record = dailyLog.find((r) => r.id === historySelectedRecordId);
      if (record) {
        setEditingPolygonIds([...(record.selectedPolygonIds || [])]);
        setEditingAmountState(record.total_cable || 0);
        window.__editingAmount = record.total_cable || 0;
      }
    } else {
      setEditingPolygonIds([]);
      setEditingAmountState(0);
      window.__editingAmount = 0;
    }
  }, [historySelectedRecordId, dailyLog]);

  // Calculate editingAmount from editingPolygonIds (auto-updates when selection changes)
  const editingAmount = useMemo(() => {
    if (!historySelectedRecordId || editingPolygonIds.length === 0) return 0;

    // LV: selection list contains inv_id norms; calculate meters using CSV lengthData.
    if (isLV) {
      return editingPolygonIds.reduce((sum, invIdNorm) => {
        const data = lengthData[normalizeId(invIdNorm)];
        if (!data?.plus?.length) return sum;
        return sum + data.plus.reduce((a, b) => a + b, 0);
      }, 0);
    }

    // For DC module, calculate based on string lengths
    if (isDC) {
      const stringIds = new Set();
      editingPolygonIds.forEach((pid) => {
        const pInfo = polygonById.current[pid];
        if (pInfo && pInfo.stringId) {
          stringIds.add(normalizeId(pInfo.stringId));
        }
      });
      let plus = 0;
      let minus = 0;
      stringIds.forEach((stringId) => {
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
      return plus + minus;
    }

    // MVFT: selection list contains trench PART ids; calculate meters from committed parts.
    if (isMVFT) {
      const ids = new Set(editingPolygonIds.map((x) => String(x)));
      const committed = mvftCommittedTrenchPartsRef.current || mvftCommittedTrenchParts || [];
      return committed.reduce((sum, p) => {
        const id = String(p?.id || '');
        if (!id || !ids.has(id)) return sum;
        const m = Number(p?.meters);
        return sum + (Number.isFinite(m) ? m : 0);
      }, 0);
    }

    // For other modules, just count polygons
    return editingPolygonIds.length;
  }, [historySelectedRecordId, editingPolygonIds, isLV, isDC, isMVFT, lengthData, mvftCommittedTrenchParts]);

  // History Record Selection: Highlight selected record on map
  useEffect(() => {
    // MVF: highlight trench parts and segments in orange
    if (isMVF) {
      const map = mapRef.current;
      if (!map) return;

      // Create or clear history highlight layer
      if (!mvfHistoryHighlightLayerRef.current) {
        mvfHistoryHighlightLayerRef.current = L.layerGroup().addTo(map);
      }
      mvfHistoryHighlightLayerRef.current.clearLayers();

      // If no record selected, we're done
      if (!historySelectedRecordId) {
        return;
      }

      // Find the selected record and get its IDs
      const record = dailyLog.find((r) => r.id === historySelectedRecordId);
      if (!record) return;

      const idsToHighlight = record.selectedPolygonIds || [];
      if (idsToHighlight.length === 0) return;

      // Separate segment IDs from part IDs
      const segmentKeys = new Set();
      const partIds = new Set();
      idsToHighlight.forEach((id) => {
        if (String(id).startsWith('segment:')) {
          segmentKeys.add(String(id).replace('segment:', ''));
        } else {
          partIds.add(String(id));
        }
      });

      // Highlight segments: use mvfSegmentLinesByKeyRef to find the segment polylines
      const segmentLines = mvfSegmentLinesByKeyRef.current || {};
      segmentKeys.forEach((segKey) => {
        const lines = segmentLines[segKey];
        if (!lines || !Array.isArray(lines)) return;
        lines.forEach((lineLayer) => {
          if (!lineLayer || typeof lineLayer.getLatLngs !== 'function') return;
          try {
            const latlngs = lineLayer.getLatLngs();
            const orangeLine = L.polyline(latlngs, {
              color: '#f97316', // orange
              weight: 5,
              opacity: 1,
            });
            mvfHistoryHighlightLayerRef.current.addLayer(orangeLine);
          } catch (_e) {
            void _e;
          }

          // 0b) Termination: fallback hit-test against active SS/CSS text labels
          // (stationPointsRef may be empty depending on data source, but label pool is always present).
          try {
            if (String(mvtSubModeRef.current || 'termination') === 'termination') {
              const pool = stringTextLabelPoolRef.current || [];
              const active = stringTextLabelActiveCountRef.current || 0;
              let best = null;
              let bestD = Infinity;
              for (let i = 0; i < active; i++) {
                const lbl = pool[i];
                if (!lbl || !lbl._mvtStationNorm) continue;
                const d = distToLabelPx(lbl);
                if (d < hitRadius && d < bestD) { bestD = d; best = lbl; }
              }
              if (best) {
                const stationLabel = String(best._mvtStationLabel || '').trim();
                const stationNorm = String(best._mvtStationNorm || '');
                const lockedNow = Boolean(best._mvtLocked);
                if (stationNorm && !lockedNow) {
                  const x = e?.clientX ?? 0;
                  const y = e?.clientY ?? 0;
                  const cur = clampMvtTerminationCount(stationNorm, mvtTerminationByStationRef.current?.[stationNorm] ?? 0);
                  setMvtTermPopup({
                    stationLabel: stationLabel || stationNorm,
                    stationNorm,
                    draft: cur,
                    x,
                    y,
                  });
                  draggingRef.current = null;
                  return;
                }
              }
            }
          } catch (_e) {
            void _e;
          }
        });
      });

      // Highlight trench parts from committed parts
      const committed = mvfCommittedTrenchPartsRef.current || [];
      committed.forEach((part) => {
        const partId = String(part?.id || '');
        if (!partIds.has(partId)) return;

        const coords = part?.coords;
        if (!coords || !Array.isArray(coords) || coords.length < 2) return;

        try {
          const latlngs = coords.map((c) => [c[1], c[0]]); // GeoJSON is [lng, lat], Leaflet is [lat, lng]
          const line = L.polyline(latlngs, {
            color: '#f97316', // orange
            weight: 4,
            opacity: 1,
          });
          mvfHistoryHighlightLayerRef.current.addLayer(line);
        } catch (_e) {
          void _e;
        }
      });

      return;
    }

    // MVFT: highlight submitted trench parts in orange (LV-like record selection)
    if (isMVFT) {
      const map = mapRef.current;
      if (!map) return;

      if (!mvftHistoryHighlightLayerRef.current) {
        mvftHistoryHighlightLayerRef.current = L.layerGroup({ pane: 'mvftHistoryHighlightPane' }).addTo(map);
      }
      const lg = mvftHistoryHighlightLayerRef.current;
      lg.clearLayers();

      if (!historySelectedRecordId) return;

      const record = dailyLog.find((r) => r.id === historySelectedRecordId);
      if (!record) return;

      const ids = Array.isArray(record.selectedPolygonIds) ? record.selectedPolygonIds.map(String) : [];
      if (ids.length === 0) return;
      const idsToHighlight = new Set(ids);

      const committed = mvftCommittedTrenchPartsRef.current || mvftCommittedTrenchParts || [];
      committed.forEach((part) => {
        const partId = String(part?.id || '');
        if (!idsToHighlight.has(partId)) return;
        const coords = part?.coords;
        if (!Array.isArray(coords) || coords.length < 2) return;
        try {
          const line = L.polyline(coords, {
            color: '#f97316',
            weight: 3.2,
            opacity: 1,
            interactive: false,
            pane: 'mvftHistoryHighlightPane',
          });
          lg.addLayer(line);
        } catch (_e) {
          void _e;
        }
      });

      return;
    }

    // MC4: highlight inv_id labels (orange) when selecting a history record that contains inverter IDs.
    // NOTE: MC4 panel-side/MC4-install use panel IDs, so we only activate this when IDs look like TX..-INV..
    if (isMC4) {
      const labels = lvInvLabelByIdRef.current || {};
      const looksLikeInvId = (id) => {
        const s = String(id || '').toLowerCase();
        if (!s) return false;
        return /tx\s*\d+/.test(s) && /inv\s*\d+/.test(s);
      };

      const invIdsToHighlight = historySelectedRecordId
        ? new Set(editingPolygonIds.map(normalizeId).filter(looksLikeInvId))
        : new Set();

      // Default styling from config
      const invBgColor = activeMode?.invIdTextBgColor || null;
      const invBgStrokeColor = activeMode?.invIdTextBgStrokeColor || null;
      const invBgStrokeWidth = typeof activeMode?.invIdTextBgStrokeWidth === 'number' ? activeMode.invIdTextBgStrokeWidth : 0;

      // Cleanup previous highlights (restore to normal state)
      prevHistoryMc4InvHighlightRef.current.forEach((invIdNorm) => {
        if (invIdsToHighlight.has(invIdNorm)) return;
        const lbl = labels[invIdNorm];
        if (!lbl) return;
        lbl.options.textColor = 'rgba(255,255,255,0.98)';
        lbl.options.textColorNoBg = null;
        lbl.options.bgColor = invBgColor;
        lbl.options.bgStrokeColor = invBgStrokeColor;
        lbl.options.bgStrokeWidth = invBgStrokeWidth;
        lbl.redraw?.();
      });

      // If this record doesn't contain inverter IDs, allow normal polygon highlighting to run.
      if (!historySelectedRecordId || invIdsToHighlight.size === 0) {
        prevHistoryMc4InvHighlightRef.current = new Set();
      } else {
        // Apply orange highlight
        const highlightTextColor = activeMode?.invIdHighlightTextColor || 'rgba(255,255,255,0.98)';
        const highlightBgColor = activeMode?.invIdHighlightBgColor || 'rgba(249, 115, 22, 1)';
        const highlightBgStrokeColor = activeMode?.invIdHighlightBgStrokeColor || 'rgba(255,255,255,0.9)';
        const highlightBgStrokeWidth = activeMode?.invIdHighlightBgStrokeWidth || 2.5;

        invIdsToHighlight.forEach((invIdNorm) => {
          const lbl = labels[invIdNorm];
          if (!lbl) return;
          lbl.options.textColor = highlightTextColor;
          lbl.options.textColorNoBg = null;
          lbl.options.bgColor = highlightBgColor;
          lbl.options.bgStrokeColor = highlightBgStrokeColor;
          lbl.options.bgStrokeWidth = highlightBgStrokeWidth;
          lbl.redraw?.();
        });

        prevHistoryMc4InvHighlightRef.current = invIdsToHighlight;
        return;
      }
    }

    // DCTT: highlight inv_id labels (for termination_inv mode) OR panel polygons (for termination_panel mode)
    if (isDCTT) {
      const labels = dcttInvLabelByIdRef.current || {};
      const panels = polygonById.current || {};
      const looksLikeInvId = (id) => {
        const s = String(id || '').toLowerCase();
        if (!s) return false;
        return /tx\s*\d+/.test(s) && /inv\s*\d+/.test(s);
      };

      // Determine what kind of IDs are in the history record
      const invIdsToHighlight = historySelectedRecordId
        ? new Set(editingPolygonIds.map(normalizeId).filter(looksLikeInvId))
        : new Set();
      const panelIdsToHighlight = historySelectedRecordId
        ? new Set(editingPolygonIds.filter((id) => !looksLikeInvId(id)))
        : new Set();

      // Default styling from config
      const invBgColor = activeMode?.invIdTextBgColor || null;
      const invBgStrokeColor = activeMode?.invIdTextBgStrokeColor || null;
      const invBgStrokeWidth = typeof activeMode?.invIdTextBgStrokeWidth === 'number' ? activeMode.invIdTextBgStrokeWidth : 0;

      // Cleanup previous inv_id highlights (restore to normal/done state)
      prevHistoryDcttInvHighlightRef.current.forEach((invIdNorm) => {
        if (invIdsToHighlight.has(invIdNorm)) return;
        const lbl = labels[invIdNorm];
        if (!lbl) return;
        const done = dcttCompletedInvIds?.has(invIdNorm);
        lbl.options.textColor = done ? (activeMode?.invIdDoneTextColor || 'rgba(34,197,94,1)') : 'rgba(255,255,255,0.98)';
        lbl.options.textColorNoBg = done ? (activeMode?.invIdDoneTextColorNoBg || null) : null;
        lbl.options.bgColor = done ? (activeMode?.invIdDoneBgColor || null) : invBgColor;
        lbl.options.bgStrokeColor = done ? (activeMode?.invIdDoneBgStrokeColor || null) : invBgStrokeColor;
        lbl.options.bgStrokeWidth = done ? (activeMode?.invIdDoneBgStrokeWidth || 0) : invBgStrokeWidth;
        lbl.redraw?.();
      });

      // Cleanup previous panel highlights (restore to terminated or unselected style)
      const unselectedColor = FULL_GEOJSON_BASE_COLOR;
      const unselectedWeight = FULL_GEOJSON_BASE_WEIGHT;
      prevHistoryDcttPanelHighlightRef.current.forEach((panelId) => {
        if (panelIdsToHighlight.has(panelId)) return;
        const polygonInfo = panels[panelId];
        if (polygonInfo && polygonInfo.layer && polygonInfo.layer.setStyle) {
          const st = dcttPanelStatesRef.current?.[panelId];
          const isTerminated = st?.left === DCTT_PANEL_STATES.TERMINATED || st?.right === DCTT_PANEL_STATES.TERMINATED;
          polygonInfo.layer.setStyle(
            isTerminated
              ? { color: '#22c55e', weight: 1.5, fill: false, fillOpacity: 0 }
              : { color: unselectedColor, weight: unselectedWeight, fill: false, fillOpacity: 0 }
          );
        }
      });

      // If no record selected, cleanup is done
      if (!historySelectedRecordId) {
        prevHistoryDcttInvHighlightRef.current = new Set();
        prevHistoryDcttPanelHighlightRef.current = new Set();
        return;
      }

      // Apply orange highlight to inv_id labels
      if (invIdsToHighlight.size > 0) {
        const highlightTextColor = activeMode?.invIdHighlightTextColor || 'rgba(255,255,255,0.98)';
        const highlightBgColor = activeMode?.invIdHighlightBgColor || 'rgba(249, 115, 22, 1)';
        const highlightBgStrokeColor = activeMode?.invIdHighlightBgStrokeColor || 'rgba(255,255,255,0.9)';
        const highlightBgStrokeWidth = activeMode?.invIdHighlightBgStrokeWidth || 2.5;

        invIdsToHighlight.forEach((invIdNorm) => {
          const lbl = labels[invIdNorm];
          if (!lbl) return;
          lbl.options.textColor = highlightTextColor;
          lbl.options.textColorNoBg = null;
          lbl.options.bgColor = highlightBgColor;
          lbl.options.bgStrokeColor = highlightBgStrokeColor;
          lbl.options.bgStrokeWidth = highlightBgStrokeWidth;
          lbl.redraw?.();
        });
      }

      // Apply orange highlight to panel polygons
      if (panelIdsToHighlight.size > 0) {
        panelIdsToHighlight.forEach((panelId) => {
          const polygonInfo = panels[panelId];
          if (polygonInfo && polygonInfo.layer && polygonInfo.layer.setStyle) {
            polygonInfo.layer.setStyle({
              color: '#f97316',
              weight: 1.8,
              fill: false,
              fillOpacity: 0,
            });
          }
        });
      }

      prevHistoryDcttInvHighlightRef.current = invIdsToHighlight;
      prevHistoryDcttPanelHighlightRef.current = panelIdsToHighlight;
      return;
    }

    // LV: highlight inv_id labels (orange)
    if (isLV) {
      const labels = lvInvLabelByIdRef.current || {};
      // When historySelectedRecordId is null, we must cleanup ALL previous highlights
      const idsToHighlight = historySelectedRecordId ? new Set(editingPolygonIds.map(normalizeId)) : new Set();

      // Default styling from config
      const invBgColor = activeMode?.invIdTextBgColor || null;
      const invBgStrokeColor = activeMode?.invIdTextBgStrokeColor || null;
      const invBgStrokeWidth = typeof activeMode?.invIdTextBgStrokeWidth === 'number' ? activeMode.invIdTextBgStrokeWidth : 0;
      const invDoneTextColor = activeMode?.invIdDoneTextColor || 'rgba(11,18,32,0.98)';
      const invDoneTextColorNoBg = activeMode?.invIdDoneTextColorNoBg || 'rgba(34,197,94,0.98)';
      const invDoneBgColor = activeMode?.invIdDoneBgColor || 'rgba(34,197,94,0.92)';
      const invDoneBgStrokeColor = activeMode?.invIdDoneBgStrokeColor || 'rgba(255,255,255,0.70)';
      const invDoneBgStrokeWidth = typeof activeMode?.invIdDoneBgStrokeWidth === 'number' ? activeMode.invIdDoneBgStrokeWidth : 2;

      // Cleanup previous highlights (restore to normal/done state)
      prevHistoryInvHighlightRef.current.forEach((invIdNorm) => {
        if (idsToHighlight.has(invIdNorm)) return; // Will be re-highlighted below
        const lbl = labels[invIdNorm];
        if (!lbl) return;
        // Restore based on completion state (green if done)
        const done = lvCompletedInvIdsRef.current?.has(invIdNorm);

        lbl.options.textColor = done ? invDoneTextColor : 'rgba(255,255,255,0.98)';
        lbl.options.textColorNoBg = done ? invDoneTextColorNoBg : null;
        lbl.options.bgColor = done ? invDoneBgColor : invBgColor;
        lbl.options.bgStrokeColor = done ? invDoneBgStrokeColor : invBgStrokeColor;
        lbl.options.bgStrokeWidth = done ? invDoneBgStrokeWidth : invBgStrokeWidth;
        lbl.redraw?.();
      });

      // If no record is selected, we're done (cleanup completed above)
      if (!historySelectedRecordId || idsToHighlight.size === 0) {
        prevHistoryInvHighlightRef.current = new Set();
        return;
      }

      // Apply orange highlight - use config values or visible defaults
      const highlightTextColor = activeMode?.invIdHighlightTextColor || 'rgba(255,255,255,0.98)';
      const highlightBgColor = activeMode?.invIdHighlightBgColor || 'rgba(249, 115, 22, 1)';
      const highlightBgStrokeColor = activeMode?.invIdHighlightBgStrokeColor || 'rgba(255,255,255,0.9)';
      const highlightBgStrokeWidth = activeMode?.invIdHighlightBgStrokeWidth || 2.5;

      idsToHighlight.forEach((invIdNorm) => {
        const lbl = labels[invIdNorm];
        if (!lbl) return;
        lbl.options.textColor = highlightTextColor;
        lbl.options.textColorNoBg = null;
        lbl.options.bgColor = highlightBgColor;
        lbl.options.bgStrokeColor = highlightBgStrokeColor;
        lbl.options.bgStrokeWidth = highlightBgStrokeWidth;
        lbl.redraw?.();
      });

      prevHistoryInvHighlightRef.current = idsToHighlight;
      return;
    }

    // MVT (MV_TERMINATION): persistently highlight station labels/counters (orange)
    // IMPORTANT: This must be driven by render-time logic, otherwise any label refresh will reset styles.
    if (isMVT) {
      const shouldHighlight =
        Boolean(historyOpenRef.current) &&
        Boolean(historySelectedRecordId) &&
        String(mvtSubMode || 'termination') === 'termination';

      const idsToHighlight = shouldHighlight
        ? new Set(editingPolygonIds.map((x) => mvtCanonicalTerminationStationNorm(x)).filter(Boolean))
        : new Set();

      mvtHistoryHighlightStationSetRef.current = idsToHighlight;

      // Force a redraw so labels/counters apply the highlight immediately.
      try {
        lastStringLabelKeyRef.current = '';
        scheduleStringTextLabelUpdate();
      } catch (_e) { void _e; }
      return;
    }

    // LVTT: highlight SS/SUB labels (orange) when selecting a history record
    // IMPORTANT: This is render-time (string label) highlight, so we store a Set and force a redraw.
    if (isLVTT) {
      const shouldHighlight = Boolean(historyOpenRef.current) && Boolean(historySelectedRecordId);
      const idsToHighlight = shouldHighlight
        ? new Set(editingPolygonIds.map((x) => lvttCanonicalSubNorm(x)).filter(Boolean))
        : new Set();

      lvttHistoryHighlightSubSetRef.current = idsToHighlight;

      try {
        lastStringLabelKeyRef.current = '';
        scheduleStringTextLabelUpdate();
      } catch (_e) {
        void _e;
      }
      return;
    }

    const panels = polygonById.current || {};
    const polygonIdsToHighlight = new Set(editingPolygonIds);

    const unselectedColor = FULL_GEOJSON_BASE_COLOR;
    const unselectedWeight = FULL_GEOJSON_BASE_WEIGHT;

    if (!historySelectedRecordId || editingPolygonIds.length === 0) {
      // Clean up previous highlights when no record is selected
      prevHistoryHighlightRef.current.forEach((polygonId) => {
        const polygonInfo = panels[polygonId];
        if (polygonInfo && polygonInfo.layer && polygonInfo.layer.setStyle) {
          // Restore to committed (green) or unselected style
          const isCommitted = (committedPolygonsRef.current || committedPolygons).has(polygonId);
          polygonInfo.layer.setStyle(
            isCommitted
              ? { color: '#22c55e', weight: 1.5, fill: false, fillOpacity: 0 }
              : { color: unselectedColor, weight: unselectedWeight, fill: false, fillOpacity: 0 }
          );
        }
      });
      if (!historySelectedRecordId) {
        prevHistoryHighlightRef.current = new Set();
        return;
      }
    }

    // Clean up polygons that are no longer in highlight set
    prevHistoryHighlightRef.current.forEach((polygonId) => {
      if (!polygonIdsToHighlight.has(polygonId)) {
        const polygonInfo = panels[polygonId];
        if (polygonInfo && polygonInfo.layer && polygonInfo.layer.setStyle) {
          const isCommitted = (committedPolygonsRef.current || committedPolygons).has(polygonId);
          polygonInfo.layer.setStyle(
            isCommitted
              ? { color: '#22c55e', weight: 1.5, fill: false, fillOpacity: 0 }
              : { color: unselectedColor, weight: unselectedWeight, fill: false, fillOpacity: 0 }
          );
        }
      }
    });

    // Apply orange highlight to editing polygons
    polygonIdsToHighlight.forEach((polygonId) => {
      const polygonInfo = panels[polygonId];
      if (polygonInfo && polygonInfo.layer && polygonInfo.layer.setStyle) {
        polygonInfo.layer.setStyle({
          color: '#f97316',
          weight: 1.8,
          fill: false,
          fillOpacity: 0,
        });
      }
    });

    prevHistoryHighlightRef.current = polygonIdsToHighlight;
  }, [historySelectedRecordId, editingPolygonIds, committedPolygons, isLV, isMC4, isDCTT, isMVF, isMVFT, dailyLog, activeMode, lvCompletedInvIds, mvftCommittedTrenchParts, dcttCompletedInvIds, dcttPanelStates]);

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
        try {
          const oe = e?.originalEvent;
          if (oe) {
            L.DomEvent.stopPropagation(oe);
            L.DomEvent.preventDefault(oe);
          }
        } catch (_e) {
          void _e;
        }
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
        try {
          const oe = e?.originalEvent;
          if (oe) {
            L.DomEvent.stopPropagation(oe);
            L.DomEvent.preventDefault(oe);
          }
        } catch (_e) {
          void _e;
        }
      });

      marker.addTo(mapRef.current);
      noteMarkersRef.current[note.id] = marker;
    });
  }, [notes, selectedNotes, noteMode]);

  // ─────────────────────────────────────────────────────────────────
  // PUNCH LIST: Render punch markers on map (contractor-colored)
  // Including isometric punches placed randomly inside their table polygon
  // ─────────────────────────────────────────────────────────────────
  // Store stable random positions for isometric punches
  const plIsoPunchPositionsRef = useRef({}); // punchId -> {lat, lng}

  useEffect(() => {
    if (!mapRef.current) return;
    if (!isPL) {
      // Not PUNCH_LIST mode: clear any punch markers
      Object.values(plPunchMarkersRef.current).forEach(m => m.remove());
      plPunchMarkersRef.current = {};
      return;
    }

    const escapeHtml = (s) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    // Helper: Generate random point inside polygon bounds with margin
    const getRandomPointInPolygonBounds = (layer, seed) => {
      try {
        const bounds = layer.getBounds();
        if (!bounds) return null;
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        // Add margin (10% inward from edges)
        const latRange = ne.lat - sw.lat;
        const lngRange = ne.lng - sw.lng;
        const margin = 0.15;
        const minLat = sw.lat + latRange * margin;
        const maxLat = ne.lat - latRange * margin;
        const minLng = sw.lng + lngRange * margin;
        const maxLng = ne.lng - lngRange * margin;
        // Use seed for pseudo-random but stable position
        const seededRandom = (s) => {
          const x = Math.sin(s) * 10000;
          return x - Math.floor(x);
        };
        const lat = minLat + seededRandom(seed) * (maxLat - minLat);
        const lng = minLng + seededRandom(seed * 2 + 1) * (maxLng - minLng);
        return { lat, lng };
      } catch (_e) {
        return null;
      }
    };

    // Build tableId -> layer lookup
    const tableIdToLayer = {};
    Object.entries(polygonById.current).forEach(([uniqueId, info]) => {
      if (info?.layer?.feature?.properties?.tableId) {
        const tableId = info.layer.feature.properties.tableId;
        tableIdToLayer[tableId] = info.layer;
      }
    });

    // Clear existing punch markers
    Object.values(plPunchMarkersRef.current).forEach(m => m.remove());
    plPunchMarkersRef.current = {};

    // Create markers for all punch points
    plPunches.forEach((punch, punchIndex) => {
      const contractor = plGetContractor(punch.contractorId);
      // Use green for completed punches, otherwise contractor color
      const color = punch.completed ? PUNCH_COMPLETED_COLOR : (contractor?.color || '#888888');

      // Determine lat/lng: if isometric punch (lat=0, lng=0, has tableId), use random point in table polygon
      let markerLat = punch.lat;
      let markerLng = punch.lng;

      const isIsoPunch = punch.tableId && punch.isoX != null && punch.isoY != null && punch.lat === 0 && punch.lng === 0;
      if (isIsoPunch) {
        // Check if we already have a stable position for this punch
        if (plIsoPunchPositionsRef.current[punch.id]) {
          const pos = plIsoPunchPositionsRef.current[punch.id];
          markerLat = pos.lat;
          markerLng = pos.lng;
        } else {
          // Generate new random position inside table polygon
          const tableLayer = tableIdToLayer[punch.tableId];
          if (tableLayer) {
            // Use punch id hash as seed for stable random position
            let seed = 0;
            for (let i = 0; i < punch.id.length; i++) {
              seed = ((seed << 5) - seed) + punch.id.charCodeAt(i);
              seed = seed & seed;
            }
            const randomPos = getRandomPointInPolygonBounds(tableLayer, seed);
            if (randomPos) {
              markerLat = randomPos.lat;
              markerLng = randomPos.lng;
              plIsoPunchPositionsRef.current[punch.id] = randomPos;
            } else {
              // Fallback: use table center
              try {
                const center = tableLayer.getBounds().getCenter();
                markerLat = center.lat;
                markerLng = center.lng;
                plIsoPunchPositionsRef.current[punch.id] = { lat: markerLat, lng: markerLng };
              } catch (_e) {
                return; // Skip this punch if we can't place it
              }
            }
          } else {
            return; // Skip: no table layer found
          }
        }
      }

      // Skip if no valid position
      if (!markerLat || !markerLng) return;

      const isSelected = plSelectedPunches.has(punch.id);
      const isEditing = plEditingPunch?.id === punch.id;
      // Use permanent punch number (never changes even when other punches deleted)
      const punchNumber = punch.punchNumber || (punchIndex + 1);

      // FLEXIBLE FILTER: Wildcard matching (AND with defaults) - calculate BEFORE icon
      const matchContractor = !plSelectedContractorId || punch.contractorId === plSelectedContractorId;
      const matchDiscipline = !plSelectedDisciplineFilter || punch.discipline === plSelectedDisciplineFilter;
      const isVisible = matchContractor && matchDiscipline;

      // VISIBILITY STYLE: Apply to ROOT div (entire marker fades)
      // Visible: Opaque, Clickable, On Top
      // Hidden: Transparent (0.45), Grayscale (0.5), UNCLICKABLE (pointer-events: none), At Bottom
      const styleString = isVisible
        ? 'opacity: 1; filter: none; pointer-events: auto; z-index: 100;'
        : 'opacity: 0.45; filter: grayscale(0.5); pointer-events: none; z-index: 0;';

      const dotIcon = L.divIcon({
        className: 'custom-punch-pin',
        html: `
          <div class="punch-dot-hit ${isSelected ? 'selected' : ''} ${isEditing ? 'editing' : ''}" style="--punch-color: ${color}; ${styleString}">
            <div class="punch-dot-core" style="background:${color};${isSelected ? 'box-shadow: 0 0 0 4px rgba(255,255,255,0.6), 0 0 12px rgba(255,255,255,0.4);' : ''}"></div>
            <span class="punch-number">${punchNumber}</span>
          </div>
        `,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -9]
      });

      const marker = L.marker([markerLat, markerLng], {
        icon: dotIcon,
        interactive: isVisible, // Only interactive if visible
        riseOnHover: isVisible,
        draggable: false, // We handle drag manually for better control
        pane: 'plPunchMarkerPane' // Custom pane with pointer-events fix
      });

      // Also apply to marker element for Leaflet layer consistency
      marker.on('add', () => {
        try {
          const el = marker.getElement();
          if (el) {
            el.style.opacity = isVisible ? '1' : '0.45';
            el.style.filter = isVisible ? 'none' : 'grayscale(0.5)';
            el.style.pointerEvents = isVisible ? 'auto' : 'none';
            el.style.zIndex = isVisible ? '100' : '0';
          }
        } catch (_e) { void _e; }
      });

      // Tooltip
      const hasText = Boolean(punch.text?.trim());
      const hasPhoto = Boolean(punch.photoDataUrl);
      if (hasText || hasPhoto || contractor || punch.tableId) {
        let tooltipContent = '';
        // Show tableId for isometric punches
        if (punch.tableId) {
          tooltipContent += `<span style="color:#fbbf24;font-size:10px">[${escapeHtml(punch.tableId)}]</span> `;
        }
        if (contractor) {
          tooltipContent += `<strong style="color:${color}">[${escapeHtml(contractor.name)}]</strong>`;
        }
        if (hasText) {
          const compact = punch.text.replace(/\s+/g, ' ').trim();
          const snippet = compact.length > 60 ? `${compact.slice(0, 60)}…` : compact;
          tooltipContent += (tooltipContent ? ' ' : '') + escapeHtml(snippet);
        }
        if (!tooltipContent && hasPhoto) {
          tooltipContent = 'Fotoğraf var';
        }
        if (tooltipContent) {
          marker.bindTooltip(tooltipContent, {
            direction: 'top',
            opacity: 0.98,
            className: 'punch-tooltip',
            offset: [0, -9],
            sticky: false
          });
          marker.on('mouseover', () => {
            if (!plDraggingPunchRef.current) marker.openTooltip();
          });
          marker.on('mouseout', () => marker.closeTooltip());
        }
      }

      // Variables for drag detection
      let mouseDownTime = 0;
      let mouseDownPos = null;
      let isDragging = false;
      const DRAG_THRESHOLD = 150; // ms to start drag
      const MOVE_THRESHOLD = 5; // pixels to detect movement

      // Mousedown: start potential drag
      marker.on('mousedown', (e) => {
        try {
          const oe = e?.originalEvent;
          if (oe) {
            L.DomEvent.stopPropagation(oe);
            L.DomEvent.preventDefault(oe);
          }
          // Only left click for drag
          if (oe?.button !== 0) return;

          mouseDownTime = Date.now();
          mouseDownPos = { x: oe.clientX, y: oe.clientY };
          isDragging = false;

          // Start drag after threshold
          const dragStartTimer = setTimeout(() => {
            if (mouseDownPos) {
              isDragging = true;
              plDraggingPunchRef.current = {
                punchId: punch.id,
                marker: marker,
                startLatLng: marker.getLatLng()
              };
              marker.closeTooltip?.();
              // Visual feedback
              marker.getElement()?.classList.add('dragging');
            }
          }, DRAG_THRESHOLD);

          // Store timer ref for cleanup
          marker._dragStartTimer = dragStartTimer;
        } catch (_e) {
          void _e;
        }
      });

      // Click: select or open edit (if not dragging)
      marker.on('click', (e) => {
        try {
          const oe = e?.originalEvent;
          if (oe) {
            L.DomEvent.stopPropagation(oe);
            L.DomEvent.preventDefault(oe);
          }
        } catch (_e) {
          void _e;
        }

        // Clear drag timer
        if (marker._dragStartTimer) {
          clearTimeout(marker._dragStartTimer);
          marker._dragStartTimer = null;
        }

        // If we were dragging, don't process click
        if (isDragging || plDraggingPunchRef.current) {
          isDragging = false;
          return;
        }

        markerClickedRef.current = true;
        marker.closeTooltip?.();

        // Shift+click: toggle selection
        const shiftKey = e?.originalEvent?.shiftKey;
        if (shiftKey) {
          setPlSelectedPunches(prev => {
            const next = new Set(prev);
            if (next.has(punch.id)) {
              next.delete(punch.id);
            } else {
              next.add(punch.id);
            }
            return next;
          });
        } else {
          // Normal click: if table punch, open isometric; else open edit popup
          if (punch.tableId) {
            setPlIsometricTableId(punch.tableId);
            setPlIsometricOpen(true);
          } else {
            // No table - open edit popup directly
            // Get screen position from click event for dynamic popup positioning
            const clickX = e?.originalEvent?.clientX || window.innerWidth / 2;
            const clickY = e?.originalEvent?.clientY || window.innerHeight / 2;
            setPlPopupPosition({ x: clickX, y: clickY });
            setPlEditingPunch(punch);
            setPlPunchText(punch.text || '');
            setPlPunchContractorId(punch.contractorId);
            setPlPunchDiscipline(punch.discipline || '');
            setPlPunchPhotoDataUrl(punch.photoDataUrl || null);
            setPlPunchPhotoName(punch.photoName || '');
          }
        }

        setTimeout(() => {
          markerClickedRef.current = false;
        }, 200);
      });

      marker.addTo(mapRef.current);
      plPunchMarkersRef.current[punch.id] = marker;
    });
  }, [isPL, plPunches, plContractors, plGetContractor, plSelectedPunches, plEditingPunch, plSelectedContractorId, plSelectedDisciplineFilter]);

  // Handle punch drag - global mousemove and mouseup
  useEffect(() => {
    if (!isPL) return;

    const handleMouseMove = (e) => {
      if (!plDraggingPunchRef.current) return;
      const { marker } = plDraggingPunchRef.current;
      if (!marker || !mapRef.current) return;

      try {
        const newLatLng = mapRef.current.mouseEventToLatLng(e);
        marker.setLatLng(newLatLng);
      } catch (_e) {
        void _e;
      }
    };

    const handleMouseUp = (e) => {
      if (!plDraggingPunchRef.current) return;
      const { punchId, marker, startLatLng } = plDraggingPunchRef.current;

      try {
        marker.getElement()?.classList.remove('dragging');
        const newLatLng = marker.getLatLng();

        // Only update if actually moved
        if (newLatLng.lat !== startLatLng.lat || newLatLng.lng !== startLatLng.lng) {
          plMovePunch(punchId, newLatLng);
        }
      } catch (_e) {
        void _e;
      }

      plDraggingPunchRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPL, plMovePunch]);

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
        // Also clear punch selection
        if (isPL) {
          setPlSelectedPunches(new Set());
        }
      }

      // Delete selected notes
      if (e.key === 'Delete' && noteMode && selectedNotes.size > 0 && !isPL) {
        const toDelete = new Set(selectedNotes);
        setNotes(prev => prev.filter(n => !toDelete.has(n.id)));
        setSelectedNotes(new Set());
      }

      // Delete selected punches (PUNCH_LIST mode)
      if (e.key === 'Delete' && isPL && noteMode && plSelectedPunches.size > 0) {
        e.preventDefault();
        plDeleteSelectedPunches();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [noteMode, selectedNotes, globalUndo, globalRedo, setNotes, isPL, plSelectedPunches, plDeleteSelectedPunches]);

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
              if (isMC4) setMc4TotalStringsCsv(0);
              if (isDCTT) setDcttTotalStringsCsv(0);
            } else {
              const header = (lines[0] || '').toLowerCase();
              const hasHeader = header.includes('id') && header.includes('length');
              const start = hasHeader ? 1 : 0;
              // IMPORTANT: spec says "CSV contains 9056 strings" => count rows (not unique IDs).
              // (In the uploaded file each ID appears twice, so unique IDs would be 4528.)
              const rowCount = Math.max(0, lines.length - start);
              if (isMC4) setMc4TotalStringsCsv(rowCount);
              if (isDCTT) setDcttTotalStringsCsv(rowCount);

              // Build inverter max STR index map (TXn-INVn-STRk) -> max k
              const invMax = {};
              const rx = /^(TX\d+)[-_\s]*INV\s*(\d+)[-_\s]*STR\s*(\d+)$/i;
              for (let i = start; i < lines.length; i++) {
                const line = lines[i];
                if (!line) continue;
                const parts = line.split(',');
                const idRaw = String(parts?.[0] || '').trim();
                if (!idRaw) continue;
                const m = idRaw.match(rx);
                if (!m) continue;
                const tx = String(m[1] || '').replace(/\s+/g, '').toUpperCase();
                const invNum = String(m[2] || '').trim();
                const strNum = parseInt(String(m[3] || '0'), 10);
                if (!tx || !invNum || !Number.isFinite(strNum) || strNum <= 0) continue;
                const invId = `${tx}-INV${invNum}`;
                const invNorm = normalizeId(invId);
                const prev = Number(invMax[invNorm] || 0) || 0;
                if (strNum > prev) invMax[invNorm] = strNum;
              }
              if (isMC4) mc4InvMaxByInvRef.current = invMax;
              if (isDCTT) dcttInvMaxByInvRef.current = invMax;
            }
          } catch (_e) {
            void _e;
            if (isMC4) {
              setMc4TotalStringsCsv(null);
              mc4InvMaxByInvRef.current = {};
            }
            if (isDCTT) {
              setDcttTotalStringsCsv(null);
              dcttInvMaxByInvRef.current = {};
            }
          }
          // This mode doesn't use lengthData totals.
          setLengthData({});
          setTotalPlus(0);
          setTotalMinus(0);
          setMvfSegments([]);
          mvfSegmentLenByKeyRef.current = {};
          // Reset selection when switching modules (avoids mismatched IDs)
          // Keep committed polygons locked unless their history record is deleted.
          setSelectedPolygons(new Set(committedPolygonsRef.current || []));
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
          // Prefer submitted snapshot when available (submit-gated export behavior).
          try {
            const rawSubmitted = localStorage.getItem('cew:dcct:test_results_submitted');
            if (rawSubmitted) {
              const parsed = JSON.parse(rawSubmitted);
              const rawRiso = parsed?.risoById && typeof parsed.risoById === 'object' ? parsed.risoById : {};
              const normalizedRisoById = {};
              Object.keys(rawRiso || {}).forEach((k) => {
                const rec = rawRiso[k] || {};
                const idNorm = dcctNormalizeId(rec?.originalId || k);
                if (!idNorm) return;
                normalizedRisoById[idNorm] = {
                  ...rec,
                  originalId: rec?.originalId != null ? rec.originalId : String(k || '').trim(),
                };
              });

              const rawRows = Array.isArray(parsed?.rows) ? parsed.rows : [];
              const normalizedRows = rawRows
                .map((r) => {
                  const originalId = String(r?.originalId || '').trim();
                  const idNorm = dcctNormalizeId(originalId || r?.idNorm);
                  return idNorm ? { originalId, idNorm } : null;
                })
                .filter(Boolean);
              dcctRowsRef.current = normalizedRows;

              const testResults = {};
              let passedCount = 0;
              let failedCount = 0;
              Object.keys(normalizedRisoById || {}).forEach((id) => {
                const st = dcctNormalizeStatus(normalizedRisoById[id]?.status || normalizedRisoById[id]?.remarkRaw);
                if (st === 'passed') { testResults[id] = 'passed'; passedCount++; }
                else if (st === 'failed') { testResults[id] = 'failed'; failedCount++; }
              });
              dcctRisoByIdRef.current = normalizedRisoById;
              setDcctTestData(testResults);
              setDcctCsvTotals({ total: Object.keys(normalizedRisoById || {}).length, passed: passedCount, failed: failedCount });
              const normalizedPayload = {
                ...(parsed && typeof parsed === 'object' ? parsed : {}),
                risoById: normalizedRisoById,
                rows: normalizedRows,
              };
              dcctTestResultsSubmittedRef.current = normalizedPayload;
              try {
                localStorage.setItem('cew:dcct:test_results_submitted', JSON.stringify(normalizedPayload));
              } catch (_e) {
                void _e;
              }
              setDcctTestResultsDirty(false);
              setStringMatchVersion((v) => v + 1);
              // DCCT doesn't use lengthData
              setLengthData({});
              setTotalPlus(0);
              setTotalMinus(0);
              setMvfSegments([]);
              mvfSegmentLenByKeyRef.current = {};
              setSelectedPolygons(new Set(committedPolygonsRef.current || []));
              setCompletedPlus(0);
              setCompletedMinus(0);
              return;
            }
          } catch (_e) {
            void _e;
          }
          if (lines.length <= 1) {
            setDcctTestData({});
            setDcctCsvTotals({ total: 0, passed: 0, failed: 0 });
            dcctRisoByIdRef.current = {};
            dcctRowsRef.current = [];
            setDcctTestResultsDirty(false);
            dcctTestResultsSubmittedRef.current = null;
            return;
          }

          const header = (lines[0] || '').split(',').map((h) => h.trim().toLowerCase());
          const idIdx = header.findIndex((h) => h === 'id');
          const remarkIdx = header.findIndex((h) => h === 'remark');
          const minusIdx = header.findIndex((h) => h.includes('insulation') && h.includes('(-'));
          const plusIdx = header.findIndex((h) => h.includes('insulation') && h.includes('(+)'));

          const risoById = {}; // normalizedId -> { plus, minus, status, remarkRaw, originalId }
          const dcctRows = []; // preserve duplicates + original order

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line || !line.trim()) continue;
            const parts = line.split(',');
            const rawId = idIdx >= 0 ? parts[idIdx] : parts[0];
            const rawRemark = remarkIdx >= 0 ? parts[remarkIdx] : parts[parts.length - 1];
            const rawMinus = minusIdx >= 0 ? parts[minusIdx] : (parts.length >= 2 ? parts[1] : '');
            const rawPlus = plusIdx >= 0 ? parts[plusIdx] : (parts.length >= 3 ? parts[2] : '');

            const id = dcctNormalizeId(rawId);
            const originalId = String(rawId || '').trim(); // Preserve original format
            const remarkRaw = String(rawRemark || '').trim();

            if (!id) continue;

            dcctRows.push({ originalId, idNorm: id });

            const nextPlus = String(rawPlus ?? '').trim();
            const nextMinus = String(rawMinus ?? '').trim();
            const nextStatus = dcctNormalizeStatus(remarkRaw);

            const prev = risoById[id];
            if (!prev) {
              risoById[id] = {
                plus: nextPlus,
                minus: nextMinus,
                status: nextStatus,
                remarkRaw,
                originalId,
              };
            } else {
              risoById[id] = {
                ...prev,
                plus: prev.plus && String(prev.plus).trim() !== '' ? prev.plus : nextPlus,
                minus: prev.minus && String(prev.minus).trim() !== '' ? prev.minus : nextMinus,
                status: prev.status != null ? prev.status : nextStatus,
                remarkRaw: prev.remarkRaw && String(prev.remarkRaw).trim() !== '' ? prev.remarkRaw : remarkRaw,
              };
            }
          }

          const testResults = {}; // normalizedId -> 'passed' | 'failed'
          let passedCount = 0;
          let failedCount = 0;
          Object.keys(risoById || {}).forEach((id) => {
            const st = dcctNormalizeStatus(risoById[id]?.status || risoById[id]?.remarkRaw);
            if (st === 'passed') { testResults[id] = 'passed'; passedCount++; }
            else if (st === 'failed') { testResults[id] = 'failed'; failedCount++; }
          });

          setDcctTestData(testResults);
          dcctRisoByIdRef.current = risoById;
          dcctRowsRef.current = dcctRows;
          setDcctCsvTotals({ total: Object.keys(risoById || {}).length, passed: passedCount, failed: failedCount });
          setDcctTestResultsDirty(false);

          // Seed a baseline submitted snapshot from the shipped dc_riso.csv so Export
          // returns the default file output when the user hasn't submitted anything yet.
          const payload = {
            risoById: { ...(risoById || {}) },
            rows: Array.isArray(dcctRows) ? dcctRows : [],
            updatedAt: Date.now(),
            source: 'default',
          };
          dcctTestResultsSubmittedRef.current = payload;
          try {
            localStorage.setItem('cew:dcct:test_results_submitted', JSON.stringify(payload));
          } catch (_e) {
            void _e;
          }

          // DCCT doesn't use lengthData
          setLengthData({});
          setTotalPlus(0);
          setTotalMinus(0);
          setMvfSegments([]);
          mvfSegmentLenByKeyRef.current = {};
          // Keep committed polygons locked unless their history record is deleted.
          setSelectedPolygons(new Set(committedPolygonsRef.current || []));
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
        // Keep committed polygons locked unless their history record is deleted.
        setSelectedPolygons(new Set(committedPolygonsRef.current || []));
        setCompletedPlus(0);
        setCompletedMinus(0);
      })
      .catch((err) => console.error('CSV yüklenemedi:', err));
  }, [activeMode]);

  // Calculate counters when selection changes
  useEffect(() => {
    // Weighted counters (module-specific): sum per-polygon workUnits instead of CSV meters.
    // Used by MODULE_INSTALLATION_PROGRES_TRACKING.
    if (activeMode?.workUnitWeights) {
      let units = 0;
      const seen = new Set();
      selectedPolygons.forEach((polygonId) => {
        const polygonInfo = polygonById.current?.[polygonId];
        const key = String(polygonInfo?.dedupeKey || polygonId);
        if (seen.has(key)) return;
        seen.add(key);
        units += Number(polygonInfo?.workUnits) || 0;
      });
      setCompletedPlus(units);
      setCompletedMinus(0);
      return;
    }
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
        const keepFillForHover = !!isPL;
        // IMPORTANT: when unselecting, restore the exact base style used by the layer
        // so it doesn't appear "whiter" after toggling.
        const unselectedColor = FULL_GEOJSON_BASE_COLOR;
        const unselectedWeight = FULL_GEOJSON_BASE_WEIGHT;
        polygonInfo.layer.setStyle(
          isSelected
            ? {
              color: '#22c55e',
              weight: 2,
              fill: keepFillForHover,
              fillOpacity: 0
            }
            : {
              color: unselectedColor,
              weight: unselectedWeight,
              fill: keepFillForHover,
              fillOpacity: 0
            }
        );

        // PUNCH_LIST: never allow selection updates to disable hover interactivity.
        if (isPL) {
          try {
            polygonInfo.layer.options.interactive = true;
          } catch (_e) {
            void _e;
          }
        }
      }
    });

    // Save current selection for next comparison
    prevSelectedRef.current = new Set(currentSelected);
  }, [isDCCT, isPL, selectedPolygons]);

  // DCCT: color full-table polygon outlines based on CSV test result (same tone as ID labels).
  useEffect(() => {
    if (!isDCCT) return;

    const results = dcctTestDataRef.current || {};
    const panels = polygonById.current || {};

    // DCCT stroke tuning: keep outlines readable but not overly thick.
    const defaultStyle = {
      color: FULL_GEOJSON_BASE_COLOR,
      weight: FULL_GEOJSON_BASE_WEIGHT,
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
          weight = FULL_GEOJSON_BASE_WEIGHT;
        } else if (status === 'failed') {
          color = 'rgba(239,68,68,0.98)';
          weight = FULL_GEOJSON_BASE_WEIGHT;
        }

        // Apply filter highlight/dim
        let opacity = 1.0;
        if (activeFilter) {
          const matches = activeFilter === status;
          if (matches) {
            // Highlight matching tables
            weight = 1.85;
            opacity = 1.0;
          } else {
            // Dim non-matching tables
            // Important UX: when filtering, non-matching items should all dim to the same neutral tone
            // (so Passed/Failed don't remain tinted when NOT TESTED is selected, and vice-versa).
            color = defaultStyle.color;
            opacity = 0.12;
            weight = 0.5;
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

  // DCTT Testing: color full-table polygon outlines based on CSV test result (same as DCCT)
  useEffect(() => {
    if (!isDCTT) return;
    if (String(dcttSubModeRef.current || 'termination') !== 'testing') return;

    const results = dcttTestDataRef.current || {};
    const panels = polygonById.current || {};

    // DCTT Testing stroke tuning: same as DCCT
    const defaultStyle = {
      color: FULL_GEOJSON_BASE_COLOR,
      weight: FULL_GEOJSON_BASE_WEIGHT,
      fill: false,
      fillOpacity: 0,
    };

    const activeFilter = dcttTestFilterRef.current;

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
          weight = FULL_GEOJSON_BASE_WEIGHT;
        } else if (status === 'failed') {
          color = 'rgba(239,68,68,0.98)';
          weight = FULL_GEOJSON_BASE_WEIGHT;
        }

        // Apply filter highlight/dim
        let opacity = 1.0;
        if (activeFilter) {
          const matches = activeFilter === status;
          if (matches) {
            // Highlight matching tables
            weight = 1.85;
            opacity = 1.0;
          } else {
            // Dim non-matching tables
            // Keep non-matching tables in a single neutral tone when filtering.
            // This prevents PASSED/FAILED tables from remaining tinted when NOT TESTED is selected.
            color = defaultStyle.color;
            opacity = 0.12;
            weight = 0.5;
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
  }, [isDCTT, dcttSubMode, dcttTestData, dcttTestFilter, stringMatchVersion]);

  // DCTT: Restore default polygon styles when NOT in testing mode
  useEffect(() => {
    if (!isDCTT) return;
    if (String(dcttSubModeRef.current || 'termination') === 'testing') return; // skip if in testing mode

    const panels = polygonById.current || {};
    const defaultStyle = {
      color: FULL_GEOJSON_BASE_COLOR,
      weight: FULL_GEOJSON_BASE_WEIGHT,
      fill: false,
      fillOpacity: 0,
      opacity: 1.0,
    };

    try {
      Object.keys(panels).forEach((pid) => {
        const info = panels[pid];
        const layer = info?.layer;
        if (!layer || typeof layer.setStyle !== 'function') return;
        layer.setStyle(defaultStyle);
      });
    } catch (_e) {
      void _e;
    }
  }, [isDCTT, dcttSubMode]);

  const fetchAllGeoJson = async () => {
    if (!mapRef.current) return;
    setStatus('Loading data...');

    layersRef.current.forEach(l => l.remove());
    layersRef.current = [];
    polygonById.current = {};
    polygonIdCounter.current = 0;
    stringTextPointsRef.current = [];
    mvtStationPointsRef.current = [];
    stringTextGridRef.current = null;
    stringTextLabelPoolRef.current = [];
    stringTextLabelActiveCountRef.current = 0;
    lastStringLabelKeyRef.current = '';
    lvInvLabelByIdRef.current = {};
    if (stringTextLayerRef.current) {
      try { stringTextLayerRef.current.remove(); } catch (_e) { void _e; }
      stringTextLayerRef.current = null;
    }
    if (mvtCounterLayerRef.current) {
      try { mvtCounterLayerRef.current.remove(); } catch (_e) { void _e; }
      mvtCounterLayerRef.current = null;
    }
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
    if (lvttSubCounterLayerRef.current) {
      try { lvttSubCounterLayerRef.current.remove(); } catch (_e) { void _e; }
      lvttSubCounterLayerRef.current = null;
    }
    lvttSubCounterLabelPoolRef.current = [];
    lvttSubCounterLabelActiveCountRef.current = 0;
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
    // DATP: clear trench refs on reload
    datpTrenchByIdRef.current = {};
    datpTrenchLenByIdRef.current = {};
    setDatpTotalTrenchMeters(0);
    if (datpTrenchSelectedLayerRef.current) {
      try { datpTrenchSelectedLayerRef.current.remove(); } catch (_e) { void _e; }
      datpTrenchSelectedLayerRef.current = null;
    }

    // MVFT: clear trench refs on reload
    mvftTrenchByIdRef.current = {};
    mvftTrenchLenByIdRef.current = {};
    setMvftTotalTrenchMeters(0);
    if (mvftTrenchSelectedLayerRef.current) {
      try { mvftTrenchSelectedLayerRef.current.remove(); } catch (_e) { void _e; }
      mvftTrenchSelectedLayerRef.current = null;
    }

    const allBounds = L.latLngBounds();
    let totalFeatures = 0;
    let textCount = 0;
    const collectedPoints = [];

    // String text'leri topla (text konumları için)
    const stringTextMap = {}; // stringId -> {lat, lng, angle, text}

    for (const file of activeGeojsonFiles) {
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
              const stringId = isDCCT
                ? dcctNormalizeId(feature.properties.text)
                : isDCTT
                  ? dcttTestNormalizeId(feature.properties.text)
                  : normalizeId(feature.properties.text);

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

          // DCTT Testing: Collect all map IDs from string_text for Not Tested calculation
          if (isDCTT) {
            const mapIds = new Set();
            stringTextPointsRef.current.forEach((pt) => {
              if (pt.stringId) mapIds.add(pt.stringId);
            });
            setDcttTestMapIds(mapIds);
          }

          stringLayer.addTo(mapRef.current);
          layersRef.current.push(stringLayer);

          // MVT: build a small cached list of station labels for click hit-testing in MV_TESTING.
          if (isMVT) {
            try {
              const stations = [];
              const pts = stringTextPointsRef.current || [];
              for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                const raw = String(p?.text || '').trim();
                if (!raw) continue;
                const stationKey = mvtCanonicalTerminationStationNorm(raw);
                if (!stationKey || !isMvtTerminationStationNorm(stationKey)) continue;
                stations.push({ lat: p.lat, lng: p.lng, stationKey, stationLabel: raw });
              }
              mvtStationPointsRef.current = stations;
            } catch (_e) {
              void _e;
              mvtStationPointsRef.current = [];
            }
          }

          // MVT: create a separate interactive layer for clickable termination counters.
          if (isMVT) {
            const counterLayer = L.layerGroup();
            mvtCounterLayerRef.current = counterLayer;
            counterLayer.addTo(mapRef.current);
            layersRef.current.push(counterLayer);
          } else {
            mvtCounterLayerRef.current = null;
          }

          // LVTT: numeric counters are removed (no separate 0/3 or 0/26 overlays).
          lvttTermCounterLayerRef.current = null;
          lvttSubCounterLayerRef.current = null;
          continue;
        }

        if (file.name === 'full') {
          // DATP/MVFT: full layer is background only; trench lines are the selectable layer.
          // IMPORTANT: Use the same global FULL_GEOJSON_* styling as other modules so the
          // rendered color matches DC and the rest of the app.
          if (isDATP || isMVFT) {
            const fullLayer = L.geoJSON(data, {
              renderer: canvasRenderer,
              interactive: false,
              bubblingMouseEvents: false,
              style: () => ({
                color: FULL_GEOJSON_BASE_COLOR,
                weight: FULL_GEOJSON_BASE_WEIGHT,
                fill: false,
                fillOpacity: 0,
              }),
            });
            fullLayer.addTo(mapRef.current);
            layersRef.current.push(fullLayer);
            if (typeof fullLayer.getBounds === 'function') {
              const b = fullLayer.getBounds();
              if (b?.isValid?.()) allBounds.extend(b);
            }
            continue;
          }

          // PUNCH_LIST: if full layer is backed by full_plot.geojson (LineString segments),
          // build table polygons in-memory so selections work per-table (click + selection box).
          if (isPL) {
            const hasLines = (data?.features || []).some((f) => f?.geometry?.type === 'LineString');
            if (hasLines) {
              try {
                const rawLines = (data?.features || []).filter(
                  (f) => f?.geometry?.type === 'LineString' && Array.isArray(f?.geometry?.coordinates) && f.geometry.coordinates.length >= 2
                );

                const quantile = (arr, q) => {
                  const a = (arr || []).filter((n) => typeof n === 'number' && Number.isFinite(n));
                  if (a.length === 0) return 0;
                  a.sort((x, y) => x - y);
                  const i = (a.length - 1) * q;
                  const lo = Math.floor(i);
                  const hi = Math.ceil(i);
                  if (lo === hi) return a[lo];
                  const t = i - lo;
                  return a[lo] * (1 - t) + a[hi] * t;
                };

                const plotCodeOfLayer = (layer) => {
                  const match = String(layer || '').match(/plot([A-G])_(east|west)/i);
                  if (!match) return 'XX';
                  const letter = String(match[1] || '').toUpperCase();
                  const dir = String(match[2] || '').toLowerCase() === 'east' ? 'E' : 'W';
                  return `${letter}${dir}`;
                };

                const slopeFromLineSegments = (layerLines) => {
                  // Axial mean angle (0..pi) using doubled-angle trick.
                  let sumC = 0;
                  let sumS = 0;
                  for (const ln of layerLines || []) {
                    const coords = ln?.geometry?.coordinates;
                    if (!Array.isArray(coords) || coords.length < 2) continue;
                    const a = coords[0];
                    const b = coords[coords.length - 1];
                    const dx = Number(b?.[0]) - Number(a?.[0]);
                    const dy = Number(b?.[1]) - Number(a?.[1]);
                    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
                    const w = Math.hypot(dx, dy);
                    if (!Number.isFinite(w) || w <= 0) continue;
                    const ang = Math.atan2(dy, dx);
                    const angAxial = ((ang % Math.PI) + Math.PI) % Math.PI;
                    sumC += Math.cos(2 * angAxial) * w;
                    sumS += Math.sin(2 * angAxial) * w;
                  }
                  const mean = 0.5 * Math.atan2(sumS, sumC);
                  const slope = Math.tan(mean);
                  return Number.isFinite(slope) ? slope : 0;
                };

                const coordKey = (c) => {
                  const x = Number(c?.[0]);
                  const y = Number(c?.[1]);
                  if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
                  return `${x.toFixed(9)},${y.toFixed(9)}`;
                };

                const byLayer = new Map();
                for (const line of rawLines) {
                  const layer = String(line?.properties?.layer || '');
                  if (!layer) continue;
                  if (!byLayer.has(layer)) byLayer.set(layer, []);
                  byLayer.get(layer).push(line);
                }

                const polygonFeatures = [];

                // If some segments can't be polygonized, keep them as non-interactive lines
                // (prevents "missing" tables in plots like plotC).
                const residualLineFeatures = [];

                for (const [layer, layerLines] of byLayer.entries()) {
                  const endpointToIdx = new Map();
                  const used = new Array(layerLines.length).fill(false);
                  const blocked = new Array(layerLines.length).fill(false);

                  const pushEndpoint = (k, idx) => {
                    if (!k) return;
                    const arr = endpointToIdx.get(k);
                    if (arr) arr.push(idx);
                    else endpointToIdx.set(k, [idx]);
                  };

                  for (let i = 0; i < layerLines.length; i++) {
                    const coords = layerLines[i]?.geometry?.coordinates;
                    const a = coords?.[0];
                    const b = coords?.[coords.length - 1];
                    pushEndpoint(coordKey(a), i);
                    pushEndpoint(coordKey(b), i);
                  }

                  for (let i = 0; i < layerLines.length; i++) {
                    if (used[i] || blocked[i]) continue;
                    const coords0 = layerLines[i]?.geometry?.coordinates;
                    const a0 = coords0?.[0];
                    const b0 = coords0?.[coords0.length - 1];
                    const startKey = coordKey(a0);
                    let lastKey = coordKey(b0);
                    if (!startKey || !lastKey) {
                      used[i] = true;
                      continue;
                    }

                    const ring = [
                      [a0[0], a0[1]],
                      [b0[0], b0[1]],
                    ];
                    const attemptIdx = [i];
                    used[i] = true;

                    let safety = layerLines.length + 5;
                    while (lastKey !== startKey && safety-- > 0) {
                      const candidates = endpointToIdx.get(lastKey) || [];
                      let nextIdx = -1;
                      let bestCos = -Infinity;
                      const prev = ring[ring.length - 2];
                      const cur = ring[ring.length - 1];
                      const prevDx = Number(cur?.[0]) - Number(prev?.[0]);
                      const prevDy = Number(cur?.[1]) - Number(prev?.[1]);
                      const prevLen = Math.hypot(prevDx, prevDy) || 1;

                      for (const cIdx of candidates) {
                        if (used[cIdx] || blocked[cIdx]) continue;
                        const coordsN = layerLines[cIdx]?.geometry?.coordinates;
                        const aN = coordsN?.[0];
                        const bN = coordsN?.[coordsN.length - 1];
                        const aK = coordKey(aN);
                        const bK = coordKey(bN);
                        if (!aK || !bK) continue;

                        let nextPt = null;
                        if (aK === lastKey) nextPt = bN;
                        else if (bK === lastKey) nextPt = aN;
                        else continue;

                        const candDx = Number(nextPt?.[0]) - Number(cur?.[0]);
                        const candDy = Number(nextPt?.[1]) - Number(cur?.[1]);
                        const candLen = Math.hypot(candDx, candDy);
                        if (!Number.isFinite(candLen) || candLen <= 0) continue;

                        const cos = (prevDx * candDx + prevDy * candDy) / (prevLen * candLen);
                        // avoid immediate backtrack
                        if (cos < -0.99) continue;
                        if (cos > bestCos) {
                          bestCos = cos;
                          nextIdx = cIdx;
                        }
                      }
                      if (nextIdx < 0) break;

                      const coordsN = layerLines[nextIdx]?.geometry?.coordinates;
                      const aN = coordsN?.[0];
                      const bN = coordsN?.[coordsN.length - 1];
                      const aK = coordKey(aN);
                      const bK = coordKey(bN);
                      if (!aK || !bK) {
                        // do not consume the segment; mark start as blocked and retry later
                        break;
                      }

                      if (aK === lastKey) {
                        ring.push([bN[0], bN[1]]);
                        lastKey = bK;
                      } else if (bK === lastKey) {
                        ring.push([aN[0], aN[1]]);
                        lastKey = aK;
                      } else {
                        // shouldn't happen; abort this attempt without consuming segments
                        break;
                      }
                      used[nextIdx] = true;
                      attemptIdx.push(nextIdx);
                    }

                    if (lastKey === startKey && ring.length >= 4) {
                      const first = ring[0];
                      const last = ring[ring.length - 1];
                      if (!last || last[0] !== first[0] || last[1] !== first[1]) {
                        ring.push([first[0], first[1]]);
                      }

                      // Simple centroid (average of vertices). Good enough for ordering.
                      let cx = 0;
                      let cy = 0;
                      const n = Math.max(1, ring.length - 1);
                      for (let k = 0; k < ring.length - 1; k++) {
                        cx += Number(ring[k][0]) || 0;
                        cy += Number(ring[k][1]) || 0;
                      }
                      cx /= n;
                      cy /= n;

                      polygonFeatures.push({
                        type: 'Feature',
                        properties: {
                          ...(layerLines[i]?.properties || {}),
                          layer,
                          __pl_cx: cx,
                          __pl_cy: cy,
                        },
                        geometry: {
                          type: 'Polygon',
                          coordinates: [ring],
                        },
                      });
                    } else {
                      // Failed to close a ring; release segments so they can be used by another start.
                      // Block this start edge to avoid retry loops.
                      for (const idx of attemptIdx) used[idx] = false;
                      blocked[i] = true;
                    }
                  }

                  // Second pass (PL): polygonize any remaining segments by connected-components + convex hull.
                  // This recovers tables whose edges don't chain cleanly (common in plotC).
                  try {
                    const PREC = 8;
                    const keyOfXY = (x, y) => {
                      const xx = Number(x);
                      const yy = Number(y);
                      if (!Number.isFinite(xx) || !Number.isFinite(yy)) return '';
                      return `${xx.toFixed(PREC)},${yy.toFixed(PREC)}`;
                    };

                    const pointAgg = new Map(); // key -> {sx, sy, n}
                    const edgeEnds = new Array(layerLines.length); // idx -> {aK,bK}
                    const addPt = (k, x, y) => {
                      if (!k) return;
                      const cur = pointAgg.get(k);
                      if (cur) {
                        cur.sx += x;
                        cur.sy += y;
                        cur.n += 1;
                      } else {
                        pointAgg.set(k, { sx: x, sy: y, n: 1 });
                      }
                    };

                    for (let i = 0; i < layerLines.length; i++) {
                      const coords = layerLines[i]?.geometry?.coordinates;
                      if (!Array.isArray(coords) || coords.length < 2) continue;
                      const a = coords[0];
                      const b = coords[coords.length - 1];
                      const ax = Number(a?.[0]);
                      const ay = Number(a?.[1]);
                      const bx = Number(b?.[0]);
                      const by = Number(b?.[1]);
                      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
                      const aK = keyOfXY(ax, ay);
                      const bK = keyOfXY(bx, by);
                      edgeEnds[i] = { aK, bK };
                      addPt(aK, ax, ay);
                      addPt(bK, bx, by);
                    }

                    const pointOfKey = (k) => {
                      const agg = pointAgg.get(k);
                      if (!agg || !agg.n) return null;
                      return { x: agg.sx / agg.n, y: agg.sy / agg.n };
                    };

                    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
                    const convexHull = (pts) => {
                      const p = (pts || []).filter(Boolean);
                      if (p.length < 3) return [];
                      p.sort((u, v) => (u.x === v.x ? u.y - v.y : u.x - v.x));
                      const lower = [];
                      for (const pt of p) {
                        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) {
                          lower.pop();
                        }
                        lower.push(pt);
                      }
                      const upper = [];
                      for (let i = p.length - 1; i >= 0; i--) {
                        const pt = p[i];
                        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) {
                          upper.pop();
                        }
                        upper.push(pt);
                      }
                      upper.pop();
                      lower.pop();
                      return lower.concat(upper);
                    };

                    const adj = new Map(); // nodeKey -> edgeIdx[]
                    const addAdj = (k, idx) => {
                      if (!k) return;
                      const arr = adj.get(k);
                      if (arr) arr.push(idx);
                      else adj.set(k, [idx]);
                    };

                    for (let i = 0; i < layerLines.length; i++) {
                      if (used[i]) continue;
                      const ends = edgeEnds[i];
                      if (!ends?.aK || !ends?.bK) continue;
                      addAdj(ends.aK, i);
                      addAdj(ends.bK, i);
                    }

                    const visitedEdge = new Set();
                    for (let i = 0; i < layerLines.length; i++) {
                      if (used[i] || visitedEdge.has(i)) continue;
                      const ends0 = edgeEnds[i];
                      if (!ends0?.aK || !ends0?.bK) continue;

                      // BFS edges via node adjacency
                      const queue = [i];
                      const compEdges = [];
                      const compNodes = new Set();
                      while (queue.length) {
                        const eIdx = queue.pop();
                        if (eIdx == null || visitedEdge.has(eIdx) || used[eIdx]) continue;
                        visitedEdge.add(eIdx);
                        const ends = edgeEnds[eIdx];
                        if (!ends?.aK || !ends?.bK) continue;
                        compEdges.push(eIdx);
                        compNodes.add(ends.aK);
                        compNodes.add(ends.bK);
                        const neighA = adj.get(ends.aK) || [];
                        const neighB = adj.get(ends.bK) || [];
                        for (const nIdx of neighA) if (!visitedEdge.has(nIdx) && !used[nIdx]) queue.push(nIdx);
                        for (const nIdx of neighB) if (!visitedEdge.has(nIdx) && !used[nIdx]) queue.push(nIdx);
                      }

                      // Heuristic: tables are small components (a few segments)
                      if (compEdges.length < 3 || compEdges.length > 16) continue;

                      const pts = Array.from(compNodes)
                        .map(pointOfKey)
                        .filter(Boolean);

                      if (pts.length < 3) continue;
                      const hull = convexHull(pts);
                      if (!hull || hull.length < 3) continue;

                      const ring = hull.map((p) => [p.x, p.y]);
                      ring.push([ring[0][0], ring[0][1]]);

                      // centroid for ordering
                      let cx = 0;
                      let cy = 0;
                      const n = Math.max(1, ring.length - 1);
                      for (let k = 0; k < ring.length - 1; k++) {
                        cx += Number(ring[k][0]) || 0;
                        cy += Number(ring[k][1]) || 0;
                      }
                      cx /= n;
                      cy /= n;

                      polygonFeatures.push({
                        type: 'Feature',
                        properties: {
                          ...(layerLines[compEdges[0]]?.properties || {}),
                          layer,
                          __pl_cx: cx,
                          __pl_cy: cy,
                        },
                        geometry: {
                          type: 'Polygon',
                          coordinates: [ring],
                        },
                      });

                      // consume these edges
                      for (const eIdx of compEdges) used[eIdx] = true;
                    }
                  } catch (_e) {
                    void _e;
                  }

                  // Add any remaining segments as residual lines (non-interactive)
                  for (let i = 0; i < layerLines.length; i++) {
                    if (used[i]) continue;
                    residualLineFeatures.push({
                      type: 'Feature',
                      properties: {
                        ...(layerLines[i]?.properties || {}),
                        layer,
                        __pl_residualLine: true,
                      },
                      geometry: layerLines[i]?.geometry,
                    });
                  }
                }

                // Assign deterministic table IDs for Punch List:
                // - group by plot layer
                // - rows: north->south
                // - columns: screen right->left
                const byPlotPolys = new Map();
                for (const f of polygonFeatures) {
                  const layer = String(f?.properties?.layer || '');
                  if (!layer) continue;
                  if (!byPlotPolys.has(layer)) byPlotPolys.set(layer, []);
                  byPlotPolys.get(layer).push(f);
                }

                const ORDER_ZOOM = 20;
                for (const [layer, feats] of byPlotPolys.entries()) {
                  const plotCode = plotCodeOfLayer(layer);
                  const layerLines = byLayer.get(layer) || [];
                  const slope = slopeFromLineSegments(layerLines);

                  const items = feats
                    .map((f) => {
                      const cx = Number(f?.properties?.__pl_cx);
                      const cy = Number(f?.properties?.__pl_cy);
                      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
                      const b = cy - slope * cx;
                      const pt = L.CRS.EPSG3857.latLngToPoint(L.latLng(cy, cx), ORDER_ZOOM);
                      return {
                        feature: f,
                        cx,
                        cy,
                        b,
                        sx: Number(pt?.x) || 0,
                        sy: Number(pt?.y) || 0,
                      };
                    })
                    .filter(Boolean);

                  if (items.length === 0) continue;
                  items.sort((a, b) => b.b - a.b);

                  const gaps = [];
                  for (let i = 1; i < items.length; i++) {
                    gaps.push(items[i - 1].b - items[i].b);
                  }
                  const gapMed = quantile(gaps, 0.5);
                  // Empirically stable for this dataset: median gap is intra-row;
                  // row breaks are much larger when slope is derived from segment orientations.
                  const rowGapThreshold = Math.max(1e-6, gapMed * 8);

                  const rows = [];
                  let current = [items[0]];
                  for (let i = 1; i < items.length; i++) {
                    const g = items[i - 1].b - items[i].b;
                    if (g > rowGapThreshold) {
                      rows.push(current);
                      current = [items[i]];
                    } else {
                      current.push(items[i]);
                    }
                  }
                  rows.push(current);

                  // Order rows north->south by average screen Y (smaller = more north)
                  rows.sort((ra, rb) => {
                    const ay = ra.reduce((s, it) => s + it.sy, 0) / Math.max(1, ra.length);
                    const byy = rb.reduce((s, it) => s + it.sy, 0) / Math.max(1, rb.length);
                    return ay - byy;
                  });

                  rows.forEach((rowItems, rowIdx) => {
                    // Columns: numbering direction depends on plot side.
                    // Screen right = west.
                    // - *_west: start from screen right (west) => right->left
                    // - *_east: start from screen left (east) => left->right
                    const isEastPlot = /_east$/i.test(String(layer || ''));
                    rowItems.sort((a, b) => (isEastPlot ? a.sx - b.sx : b.sx - a.sx));
                    rowItems.forEach((it, colIdx) => {
                      it.feature.properties.tableId = `${plotCode}${rowIdx + 1}-${colIdx + 1}`;
                      it.feature.properties.row = rowIdx + 1;
                      it.feature.properties.col = colIdx + 1;
                    });
                  });
                }

                // Strip internal helper props
                for (const f of polygonFeatures) {
                  if (f?.properties) {
                    delete f.properties.__pl_cx;
                    delete f.properties.__pl_cy;
                  }
                }

                // Only swap in polygons if conversion looks successful; otherwise keep lines
                // so we don't accidentally drop most tables from the map.
                const minExpected = Math.max(50, Math.floor(rawLines.length / 8));
                if (polygonFeatures.length >= minExpected) {
                  data = {
                    ...data,
                    type: 'FeatureCollection',
                    features: [...polygonFeatures, ...residualLineFeatures],
                  };
                }
              } catch (_e) {
                void _e;
              }
            }
          }

          // TABLE_INSTALLATION_PROGRESS: count tables (2 panels = 1 table)
          if (isTIP) {
            const isTipSingleBoxSource = /full_plot_single_box\.geojson$/i.test(String(file?.url || ''));
            const threshold = activeMode?.tableAreaThreshold || 50; // m²

            // Calculate polygon area in m² using Shoelace formula
            const calcAreaM2 = (coords) => {
              try {
                let ring = coords;
                while (Array.isArray(ring) && ring.length > 0 && Array.isArray(ring[0]) && Array.isArray(ring[0][0])) {
                  ring = ring[0];
                }
                if (!Array.isArray(ring) || ring.length < 3) return 0;
                let area = 0;
                for (let i = 0; i < ring.length - 1; i++) {
                  area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
                }
                const avgLat = ring[0]?.[1] || 50;
                const latFactor = Math.cos(avgLat * Math.PI / 180);
                return Math.abs(area) / 2 * 111319.9 * 111319.9 * latFactor;
              } catch (_e) {
                return 0;
              }
            };

            // Calculate centroid for each panel
            const getCentroid = (coords) => {
              try {
                let ring = coords;
                while (Array.isArray(ring) && ring.length > 0 && Array.isArray(ring[0]) && Array.isArray(ring[0][0])) {
                  ring = ring[0];
                }
                if (!Array.isArray(ring) || ring.length < 3) return null;
                let cx = 0, cy = 0;
                ring.forEach(p => { cx += p[0]; cy += p[1]; });
                return [cx / ring.length, cy / ring.length];
              } catch (_e) {
                return null;
              }
            };

            if (isTipSingleBoxSource) {
              // New TIP dataset: tables are stored as 4 separate LineString edges.
              // Build Polygon hit-areas in-memory so selection targets the whole rectangle.
              try {
                const rawLines = (data?.features || []).filter(
                  (f) => f?.geometry?.type === 'LineString' && Array.isArray(f?.geometry?.coordinates) && f.geometry.coordinates.length >= 2
                );

                if (rawLines.length > 0) {
                  const coordKey = (c) => {
                    const x = Number(c?.[0]);
                    const y = Number(c?.[1]);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
                    return `${x.toFixed(9)},${y.toFixed(9)}`;
                  };

                  const byLayer = new Map();
                  for (const line of rawLines) {
                    const layer = String(line?.properties?.layer || '');
                    const k = layer || '__no_layer__';
                    if (!byLayer.has(k)) byLayer.set(k, []);
                    byLayer.get(k).push(line);
                  }

                  const polygonFeatures = [];
                  const residualLineFeatures = [];

                  for (const [layerKey, layerLines] of byLayer.entries()) {
                    const endpointToIdx = new Map();
                    const used = new Array(layerLines.length).fill(false);
                    const blocked = new Array(layerLines.length).fill(false);

                    const pushEndpoint = (k, idx) => {
                      if (!k) return;
                      const arr = endpointToIdx.get(k);
                      if (arr) arr.push(idx);
                      else endpointToIdx.set(k, [idx]);
                    };

                    for (let i = 0; i < layerLines.length; i++) {
                      const coords = layerLines[i]?.geometry?.coordinates;
                      const a = coords?.[0];
                      const b = coords?.[coords.length - 1];
                      pushEndpoint(coordKey(a), i);
                      pushEndpoint(coordKey(b), i);
                    }

                    for (let i = 0; i < layerLines.length; i++) {
                      if (used[i] || blocked[i]) continue;

                      const coords0 = layerLines[i]?.geometry?.coordinates;
                      const a0 = coords0?.[0];
                      const b0 = coords0?.[coords0.length - 1];
                      const startKey = coordKey(a0);
                      let lastKey = coordKey(b0);
                      if (!startKey || !lastKey) {
                        used[i] = true;
                        continue;
                      }

                      const ring = [
                        [a0[0], a0[1]],
                        [b0[0], b0[1]],
                      ];
                      const attemptIdx = [i];
                      used[i] = true;

                      // Safety bound: rectangles should close quickly (4 edges).
                      let safety = 12;
                      while (lastKey !== startKey && safety-- > 0) {
                        const candidates = endpointToIdx.get(lastKey) || [];
                        let nextIdx = -1;

                        for (const cIdx of candidates) {
                          if (used[cIdx] || blocked[cIdx]) continue;
                          const coordsN = layerLines[cIdx]?.geometry?.coordinates;
                          const aN = coordsN?.[0];
                          const bN = coordsN?.[coordsN.length - 1];
                          const aK = coordKey(aN);
                          const bK = coordKey(bN);
                          if (!aK || !bK) continue;
                          if (aK === lastKey || bK === lastKey) {
                            nextIdx = cIdx;
                            break;
                          }
                        }
                        if (nextIdx < 0) break;

                        const coordsN = layerLines[nextIdx]?.geometry?.coordinates;
                        const aN = coordsN?.[0];
                        const bN = coordsN?.[coordsN.length - 1];
                        const aK = coordKey(aN);
                        const bK = coordKey(bN);
                        if (!aK || !bK) break;

                        if (aK === lastKey) {
                          ring.push([bN[0], bN[1]]);
                          lastKey = bK;
                        } else if (bK === lastKey) {
                          ring.push([aN[0], aN[1]]);
                          lastKey = aK;
                        } else {
                          break;
                        }

                        used[nextIdx] = true;
                        attemptIdx.push(nextIdx);
                      }

                      if (lastKey === startKey && ring.length >= 4) {
                        const first = ring[0];
                        const last = ring[ring.length - 1];
                        if (!last || last[0] !== first[0] || last[1] !== first[1]) {
                          ring.push([first[0], first[1]]);
                        }

                        polygonFeatures.push({
                          type: 'Feature',
                          properties: {
                            ...(layerLines[i]?.properties || {}),
                            layer: layerKey === '__no_layer__' ? undefined : layerKey,
                          },
                          geometry: {
                            type: 'Polygon',
                            coordinates: [ring],
                          },
                        });
                      } else {
                        // Failed to close: release segments and block this start to avoid loops.
                        for (const idx of attemptIdx) used[idx] = false;
                        blocked[i] = true;
                      }
                    }

                    // Keep any remaining segments as visual-only lines.
                    for (let i = 0; i < layerLines.length; i++) {
                      if (used[i]) continue;
                      residualLineFeatures.push({
                        type: 'Feature',
                        properties: {
                          ...(layerLines[i]?.properties || {}),
                          layer: layerKey === '__no_layer__' ? undefined : layerKey,
                          __tip_residualLine: true,
                        },
                        geometry: layerLines[i]?.geometry,
                      });
                    }
                  }

                  // Swap in polygons if conversion looks successful.
                  const minExpected = Math.max(50, Math.floor(rawLines.length / 6));
                  if (polygonFeatures.length >= minExpected) {
                    data = {
                      ...data,
                      type: 'FeatureCollection',
                      features: [...polygonFeatures, ...residualLineFeatures],
                    };
                  }
                }
              } catch (_e) {
                void _e;
              }

              let smallTables = 0;
              let bigTables = 0;
              (data.features || []).forEach((feature) => {
                const gType = feature?.geometry?.type;
                const isPoly = gType === 'Polygon' || gType === 'MultiPolygon';
                if (!isPoly) return;
                const area = calcAreaM2(feature?.geometry?.coordinates);
                if (area < threshold) smallTables++;
                else bigTables++;
              });

              setTableSmallCount(Math.round(smallTables));
              setTableBigCount(Math.round(bigTables));

              // No pairing in single-table dataset
              tipPanelPairsRef.current = { featurePairs: new Map(), polygonPairs: new Map() };
            } else {
              // Legacy TIP dataset: 2 panels = 1 table; pair panels by proximity.

              // Build panel info array
              const panels = (data.features || []).map((feature, idx) => ({
                idx,
                area: calcAreaM2(feature?.geometry?.coordinates),
                centroid: getCentroid(feature?.geometry?.coordinates),
              })).filter(p => p.centroid);

              // Pair panels by proximity (panels that form a table are very close)
              const PAIR_THRESHOLD = 0.00008; // ~8m in degrees
              const used = new Set();
              const pairs = []; // [{idx1, idx2, area}]

              for (let i = 0; i < panels.length; i++) {
                if (used.has(i)) continue;
                const p1 = panels[i];
                let minDist = Infinity, minJ = -1;

                for (let j = i + 1; j < panels.length; j++) {
                  if (used.has(j)) continue;
                  const p2 = panels[j];
                  const dist = Math.sqrt(
                    Math.pow(p1.centroid[0] - p2.centroid[0], 2) +
                    Math.pow(p1.centroid[1] - p2.centroid[1], 2)
                  );
                  if (dist < minDist) {
                    minDist = dist;
                    minJ = j;
                  }
                }

                if (minJ >= 0 && minDist < PAIR_THRESHOLD) {
                  used.add(i);
                  used.add(minJ);
                  // Combined area of both panels
                  const combinedArea = p1.area + panels[minJ].area;
                  pairs.push({ idx1: panels[i].idx, idx2: panels[minJ].idx, area: combinedArea });
                }
              }

              // Count tables by size (combined area of both panels)
              let smallTables = 0;
              let bigTables = 0;
              const combinedThreshold = threshold * 2; // Both panels combined

              pairs.forEach(pair => {
                if (pair.area < combinedThreshold) {
                  smallTables++;
                } else {
                  bigTables++;
                }
              });

              // Also count unpaired panels as half tables (shouldn't happen normally)
              const unpairedCount = panels.length - used.size;
              if (unpairedCount > 0) {
                // Add unpaired as individual (likely edge cases)
                panels.forEach((p, i) => {
                  if (!used.has(i)) {
                    if (p.area < threshold) smallTables += 0.5;
                    else bigTables += 0.5;
                  }
                });
              }

              setTableSmallCount(Math.round(smallTables));
              setTableBigCount(Math.round(bigTables));

              // Store panel pairs by feature index (will map to polygonId after layer creation)
              // tipFeaturePairs: featureIndex -> partnerFeatureIndex
              const tipFeaturePairs = new Map();
              pairs.forEach(pair => {
                tipFeaturePairs.set(pair.idx1, pair.idx2);
                tipFeaturePairs.set(pair.idx2, pair.idx1);
              });
              // Store for use in onEachFeature
              tipPanelPairsRef.current = { featurePairs: tipFeaturePairs, polygonPairs: new Map() };
            }
          }

          // LVTT: tables must NOT be selectable; draw only.
          if (isLVTT) {
            const fullLayer = L.geoJSON(data, {
              renderer: canvasRenderer,
              interactive: false,
              style: () => ({
                color: FULL_GEOJSON_BASE_COLOR,
                weight: FULL_GEOJSON_BASE_WEIGHT,
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

          // LVIB: tables (full.geojson) must NOT be selectable; only lv_box and inv_box are selectable
          if (isLVIB) {
            const fullLayer = L.geoJSON(data, {
              renderer: canvasRenderer,
              interactive: false,
              style: () => ({
                color: FULL_GEOJSON_BASE_COLOR,
                weight: FULL_GEOJSON_BASE_WEIGHT,
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

          // MVT: tables (full.geojson) must NOT be selectable; MV Termination/Testing is label-driven.
          if (isMVT) {
            const fullLayer = L.geoJSON(data, {
              renderer: canvasRenderer,
              interactive: false,
              style: () => ({
                color: FULL_GEOJSON_BASE_COLOR,
                weight: FULL_GEOJSON_BASE_WEIGHT,
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

          // TIP: Track feature index for panel pairing
          let tipFeatureIndex = 0;
          const tipFeatureToPolygonId = new Map(); // featureIndex -> polygonId

          const fullLayer = L.geoJSON(data, {
            renderer: canvasRenderer,
            interactive: true,

            // PL needs a filled (but invisible) hit-area so hover works over the whole table,
            // even after selection/unselection style updates.
            style: () => ({
              // FULL.GEOJSON: same base style across all modules (requested)
              color: FULL_GEOJSON_BASE_COLOR,
              weight: FULL_GEOJSON_BASE_WEIGHT,
              fill: !!isPL || !!isTIP,
              fillOpacity: 0,
            }),

            onEachFeature: (feature, featureLayer) => {
              const currentFeatureIdx = tipFeatureIndex++;
              const gType = feature?.geometry?.type;
              const isPoly = gType === 'Polygon' || gType === 'MultiPolygon';
              const isLine = gType === 'LineString';
              // MC4 panel logic only applies to polygons (panels). DC selection can include other shapes.
              if (!gType || (!isPoly && !(isLine && !isMC4))) return;

              // PUNCH_LIST: residual lines are only a visual fallback (never selectable)
              if (isPL && isLine) {
                try {
                  featureLayer.options.interactive = false;
                } catch (_e) {
                  void _e;
                }
                return;
              }

              // TIP: residual lines are visual-only; selection must be by polygon (whole table)
              if (isTIP && isLine) {
                try {
                  featureLayer.options.interactive = false;
                } catch (_e) {
                  void _e;
                }
                return;
              }

              // PUNCH_LIST: show deterministic table ID on hover
              if (isPL && isPoly) {
                const tableId = String(feature?.properties?.tableId || '');
                if (tableId) {
                  try {
                    featureLayer.bindTooltip(tableId, {
                      permanent: false,
                      sticky: true,
                      direction: 'top',
                      opacity: 0.95,
                      className: 'punch-list-tooltip',
                    });

                    // Be explicit: keep tooltip hover behavior stable even if other handlers run.
                    featureLayer.on('mouseover', () => {
                      try {
                        featureLayer.openTooltip();
                      } catch (_e) {
                        void _e;
                      }
                    });
                    featureLayer.on('mouseout', () => {
                      try {
                        featureLayer.closeTooltip();
                      } catch (_e) {
                        void _e;
                      }
                    });
                  } catch (_e) {
                    void _e;
                  }
                }
              }

              // Assign unique ID to this panel/polygon
              const uniqueId = `polygon_${polygonIdCounter.current++}`;
              featureLayer._uniquePolygonId = uniqueId;

              // TIP: Map feature index to polygon ID for panel pairing
              if (isTIP) {
                tipFeatureToPolygonId.set(currentFeatureIdx, uniqueId);
              }

              // Store reference (will be updated with stringId and size later)
              polygonById.current[uniqueId] = {
                layer: featureLayer,
                stringId: null,
                isSmallTable: false,
              };

              // MC4 / DCTT: click/dblclick change termination states on panel polygons
              if ((isMC4 || isDCTT) && isPoly) {
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
                  const isDcttPanel = isDCTTRef.current;
                  const currentMode = isDcttPanel ? dcttSelectionModeRef.current : mc4SelectionModeRef.current;
                  const showToast = isDcttPanel ? showDcttToast : showMc4Toast;
                  const getState = isDcttPanel ? dcttGetPanelState : mc4GetPanelState;
                  const setStates = isDcttPanel ? setDcttPanelStates : setMc4PanelStates;
                  const pushHistory = isDcttPanel ? dcttPushHistory : mc4PushHistory;

                  // Require selection mode to be set
                  if (!currentMode) {
                    showToast('Please select a mode above.');
                    return;
                  }
                  if (currentMode === 'termination_inv') {
                    // Inv-side termination is driven by inverter popups, not panel clicks.
                    return;
                  }

                  const prev = getState(uniqueId);

                  if (isDcttPanel) {
                    // DCTT: selecting a table marks the table terminated (both ends)
                    const next = { left: DCTT_PANEL_STATES.TERMINATED, right: DCTT_PANEL_STATES.TERMINATED };
                    setStates((s) => ({ ...(s || {}), [uniqueId]: next }));
                    pushHistory([{ id: uniqueId, prev, next }]);
                    return;
                  }

                  // MC4: end-specific click behavior
                  const side = sideFromClick(evt);
                  let nextState = prev[side];
                  if (currentMode === 'mc4') {
                    // MC4 mode: set to MC4 (blue), but never downgrade TERMINATED (green)
                    if (nextState !== 'terminated') nextState = 'mc4';
                  } else if (currentMode === 'termination_panel') {
                    // Termination mode: ONLY MC4 (blue) -> TERMINATED (green)
                    // If not already MC4, do nothing (can't terminate without MC4).
                    if (nextState === 'mc4') nextState = 'terminated';
                    else if (nextState === 'terminated') nextState = 'terminated';
                    else {
                      showMc4Toast('Some tables were not MC4-installed yet');
                      return;
                    }
                  } else {
                    // No mode: should not happen due to guard above
                    showMc4Toast('Please select a mode above.');
                    return;
                  }
                  const next = { ...prev, [side]: nextState };
                  setStates((s) => ({ ...(s || {}), [uniqueId]: next }));
                  pushHistory([{ id: uniqueId, prev, next }]);
                });

                featureLayer.on('dblclick', (evt) => {
                  safeStop(evt);
                  if (noteMode) return;
                  const isDcttPanel = isDCTTRef.current;
                  const currentMode = isDcttPanel ? dcttSelectionModeRef.current : mc4SelectionModeRef.current;
                  if (currentMode === 'termination_inv') return;

                  const getState = isDcttPanel ? dcttGetPanelState : mc4GetPanelState;
                  const setStates = isDcttPanel ? setDcttPanelStates : setMc4PanelStates;
                  const pushHistory = isDcttPanel ? dcttPushHistory : mc4PushHistory;

                  const prev = getState(uniqueId);
                  const next = isDcttPanel
                    ? { left: DCTT_PANEL_STATES.TERMINATED, right: DCTT_PANEL_STATES.TERMINATED }
                    : { ...prev, [sideFromClick(evt)]: MC4_PANEL_STATES.TERMINATED };
                  setStates((s) => ({ ...(s || {}), [uniqueId]: next }));
                  pushHistory([{ id: uniqueId, prev, next }]);
                });

                featureLayer.on('contextmenu', (evt) => {
                  safeStop(evt);
                  if (noteMode) return;
                  const isDcttPanel = isDCTTRef.current;
                  const getState = isDcttPanel ? dcttGetPanelState : mc4GetPanelState;
                  const setStates = isDcttPanel ? setDcttPanelStates : setMc4PanelStates;
                  const pushHistory = isDcttPanel ? dcttPushHistory : mc4PushHistory;

                  if (isDcttPanel && dcttSelectionModeRef.current === 'termination_panel') {
                    const committed = dcttCommittedPanelIdsRef.current || new Set();
                    if (committed.has(uniqueId)) {
                      showDcttToast('Submitted tables can only be removed from History.');
                      return;
                    }
                  }

                  const prev = getState(uniqueId);
                  const next = { left: null, right: null };
                  setStates((s) => {
                    const out = { ...(s || {}) };
                    delete out[uniqueId];
                    return out;
                  });
                  pushHistory([{ id: uniqueId, prev, next }]);
                });

                return;
              }

              // DC/LV DEFAULT: Add click events - left click to select
              if (isDCCT && isPoly) {
                featureLayer.on('click', (e) => {
                  // Stop all propagation to prevent double-firing
                  try {
                    const oe = e?.originalEvent;
                    if (oe) {
                      L.DomEvent.stop(oe);
                      oe.stopImmediatePropagation?.();
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
                  const oe = e?.originalEvent;
                  const x = oe?.clientX ?? 0;
                  const y = oe?.clientY ?? 0;
                  const rec = dcctRisoByIdRef.current?.[sid] || null;
                  const isInCsv = rec !== null;
                  const plus = rec?.plus != null ? String(rec.plus).trim() : '';
                  const minus = rec?.minus != null ? String(rec.minus).trim() : '';
                  const plusVal = plus || (isInCsv ? '999' : '0');
                  const minusVal = minus || (isInCsv ? '999' : '0');
                  const st = dcctNormalizeStatus(rec?.status || rec?.remarkRaw) || null;
                  const displayId = dcctFormatDisplayId(sid, rec?.originalId);
                  setDcctPopup((prev) => {
                    if (prev && prev.idNorm === sid) return null;
                    return {
                      idNorm: sid,
                      displayId,
                      draftPlus: plusVal,
                      draftMinus: minusVal,
                      draftStatus: st,
                      x,
                      y,
                    };
                  });
                });
                return;
              }

              featureLayer.on('click', (e) => {
                try {
                  const oe = e?.originalEvent;
                  if (oe) {
                    L.DomEvent.stopPropagation(oe);
                    L.DomEvent.preventDefault(oe);
                  }
                } catch (_e) {
                  void _e;
                }
                polygonClickedRef.current = true;

                // DCTT: In DC_TESTING sub-mode, tables must NOT be selectable.
                // The only interaction should be clicking string_id text labels to open the testing popup.
                if (isDCTTRef.current && String(dcttSubModeRef.current || 'termination') === 'testing') {
                  return;
                }

                // PUNCH_LIST MODE: clicking a table always opens isometric view
                if (isPL) {
                  const tableId = featureLayer.feature?.properties?.tableId;
                  if (tableId) {
                    setPlIsometricTableId(tableId);
                    setPlIsometricOpen(true);
                  }
                  return;
                }

                if (noteMode) return;
                const polygonId = featureLayer._uniquePolygonId;

                // DCTT: ensure single-click termination works even if layers were created under a different mode.
                // Box selection already uses refs; mirror that behavior here.
                if (
                  polygonId &&
                  isDCTTRef.current &&
                  String(dcttSubModeRef.current || 'termination') !== 'testing' &&
                  dcttSelectionModeRef.current === 'termination_panel'
                ) {
                  const prev = dcttGetPanelState(polygonId);
                  const next = { left: DCTT_PANEL_STATES.TERMINATED, right: DCTT_PANEL_STATES.TERMINATED };
                  setDcttPanelStates((s) => ({ ...(s || {}), [polygonId]: next }));
                  dcttPushHistory([{ id: polygonId, prev, next }]);
                  return;
                }
                if (polygonId) {
                  // HISTORY EDITING MODE: If a history record is selected, toggle polygon in editing set
                  const currentHistoryRecordId = window.__historySelectedRecordId;
                  if (currentHistoryRecordId) {
                    // Get current editing polygon IDs from window
                    const currentPolygonIds = window.__editingPolygonIds || [];
                    const pInfo = polygonById.current?.[polygonId] || null;

                    // DC mode: toggle entire string group together
                    let toggleIds = [polygonId];
                    if (isDC && pInfo?.stringId) {
                      const sid = normalizeId(pInfo.stringId);
                      toggleIds = Object.keys(polygonById.current || {}).filter((pid) => {
                        const info = polygonById.current?.[pid];
                        return normalizeId(info?.stringId || '') === sid;
                      });
                      if (toggleIds.length === 0) toggleIds = [polygonId];
                    }

                    const currentSet = new Set(currentPolygonIds);
                    const allInEditing = toggleIds.every((id) => currentSet.has(id));

                    let newPolygonIds;
                    if (allInEditing) {
                      // Remove the whole group
                      toggleIds.forEach((id) => currentSet.delete(id));
                      newPolygonIds = Array.from(currentSet);
                    } else {
                      // Add the whole group
                      toggleIds.forEach((id) => currentSet.add(id));
                      newPolygonIds = Array.from(currentSet);
                    }

                    // Update editing state
                    setEditingPolygonIds(newPolygonIds);
                    editingPolygonIdsRef.current = newPolygonIds;
                    window.__editingPolygonIds = newPolygonIds;

                    // Calculate new amount for DC
                    if (isDC) {
                      const stringIdsSet = new Set();
                      newPolygonIds.forEach((pid) => {
                        const info = polygonById.current?.[pid];
                        if (info?.stringId) stringIdsSet.add(normalizeId(info.stringId));
                      });
                      let plus = 0, minus = 0;
                      stringIdsSet.forEach((sid) => {
                        const d = lengthData[sid];
                        if (d?.plus?.length) plus += d.plus.reduce((a, b) => a + b, 0);
                        if (d?.minus?.length) minus += d.minus.reduce((a, b) => a + b, 0);
                      });
                      setEditingAmountState(plus + minus);
                    } else {
                      setEditingAmountState(newPolygonIds.length);
                    }

                    // Immediately update polygon style
                    toggleIds.forEach((id) => {
                      const layerInfo = polygonById.current?.[id];
                      if (!layerInfo?.layer || typeof layerInfo.layer.setStyle !== 'function') return;
                      if (allInEditing) {
                        // We removed it -> back to base style
                        const isCommitted = (committedPolygonsRef.current || committedPolygons).has(id);
                        layerInfo.layer.setStyle(
                          isCommitted
                            ? { color: '#22c55e', weight: 1.5, fill: false, fillOpacity: 0 }
                            : { color: 'rgba(255,255,255,0.35)', weight: 1.05, fill: false, fillOpacity: 0 }
                        );
                      } else {
                        // We added it -> orange
                        layerInfo.layer.setStyle({
                          color: '#f97316',
                          weight: 1.8,
                          fill: false,
                          fillOpacity: 0,
                        });
                      }
                    });

                    return; // Don't do normal selection
                  }

                  // COMMITTED POLYGON CHECK: Don't allow unselecting committed (submitted) polygons
                  // They can only be removed by deleting the history record
                  // Use ref to get latest value (Leaflet handlers have stale closures)
                  const currentCommitted = committedPolygonsRef.current || new Set();
                  const isCommitted = currentCommitted.has(polygonId);
                  if (isCommitted) {
                    // Already committed - don't allow unselection
                    return;
                  }

                  // TIP: Select/unselect both panels of a table together
                  if (isTIP) {
                    const partnerPolygonId = tipPanelPairsRef.current?.polygonPairs?.get(polygonId);
                    // Check if any of the pair is committed
                    const anyCommitted = currentCommitted.has(polygonId) ||
                      (partnerPolygonId && currentCommitted.has(partnerPolygonId));
                    if (anyCommitted) return; // Don't allow unselection of committed polygons

                    setSelectedPolygons(prev => {
                      const next = new Set(prev);
                      const isSelected = next.has(polygonId);
                      if (isSelected) {
                        next.delete(polygonId);
                        if (partnerPolygonId) next.delete(partnerPolygonId);
                      } else {
                        next.add(polygonId);
                        if (partnerPolygonId) next.add(partnerPolygonId);
                      }
                      return next;
                    });
                    return;
                  }

                  // For small tables: select all polygons with same string ID
                  const polygonInfo = polygonById.current[polygonId];
                  if (polygonInfo && polygonInfo.stringId && polygonInfo.isSmallTable) {
                    // Check if any polygon in the group is committed
                    const groupIds = [];
                    Object.keys(polygonById.current).forEach(pid => {
                      const info = polygonById.current[pid];
                      if (info && info.stringId === polygonInfo.stringId && info.isSmallTable) {
                        groupIds.push(pid);
                      }
                    });
                    const anyGroupCommitted = groupIds.some(id => currentCommitted.has(id));
                    if (anyGroupCommitted) return; // Don't allow unselection of committed groups

                    setSelectedPolygons(prev => {
                      const next = new Set(prev);

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
                try {
                  const oe = e?.originalEvent;
                  if (oe) {
                    L.DomEvent.stopPropagation(oe);
                    L.DomEvent.preventDefault(oe);
                  }
                } catch (_e) {
                  void _e;
                }
                if (noteMode) return;
                const polygonId = featureLayer._uniquePolygonId;
                if (polygonId) {
                  // COMMITTED POLYGON CHECK: Don't allow unselecting committed (submitted) polygons
                  // Use ref to get latest value (Leaflet handlers have stale closures)
                  const currentCommitted = committedPolygonsRef.current || new Set();
                  const isCommitted = currentCommitted.has(polygonId);
                  if (isCommitted) return; // Already committed - don't allow unselection

                  // TIP: Unselect both panels of a table together
                  if (isTIP && tipPanelPairsRef.current?.polygonPairs) {
                    const partnerPolygonId = tipPanelPairsRef.current.polygonPairs.get(polygonId);
                    // Check if any is committed
                    const anyCommitted = currentCommitted.has(polygonId) ||
                      (partnerPolygonId && currentCommitted.has(partnerPolygonId));
                    if (anyCommitted) return;

                    setSelectedPolygons(prev => {
                      const next = new Set(prev);
                      next.delete(polygonId);
                      if (partnerPolygonId) next.delete(partnerPolygonId);
                      return next;
                    });
                    return;
                  }

                  // For small tables: unselect all polygons with same string ID
                  const polygonInfo = polygonById.current[polygonId];
                  if (polygonInfo && polygonInfo.stringId && polygonInfo.isSmallTable) {
                    // Check if any in group is committed
                    const groupIds = [];
                    Object.keys(polygonById.current).forEach(pid => {
                      const info = polygonById.current[pid];
                      if (info && info.stringId === polygonInfo.stringId && info.isSmallTable) {
                        groupIds.push(pid);
                      }
                    });
                    const anyGroupCommitted = groupIds.some(id => currentCommitted.has(id));
                    if (anyGroupCommitted) return;

                    setSelectedPolygons(prev => {
                      const next = new Set(prev);
                      groupIds.forEach(pid => next.delete(pid));
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

          // TIP: Build polygonPairs map from feature pairs (bidirectional)
          if (isTIP && tipPanelPairsRef.current?.featurePairs) {
            const polygonPairs = new Map();
            tipPanelPairsRef.current.featurePairs.forEach((partnerIdx, featureIdx) => {
              const polygonId = tipFeatureToPolygonId.get(featureIdx);
              const partnerPolygonId = tipFeatureToPolygonId.get(partnerIdx);
              if (polygonId && partnerPolygonId) {
                // Bidirectional mapping
                polygonPairs.set(polygonId, partnerPolygonId);
                polygonPairs.set(partnerPolygonId, polygonId);
              }
            });
            tipPanelPairsRef.current.polygonPairs = polygonPairs;
            console.log('TIP: Built polygonPairs map with', polygonPairs.size, 'entries');
          }

          fullLayer.addTo(mapRef.current);
          layersRef.current.push(fullLayer);

          if (fullLayer.getBounds().isValid()) {
            allBounds.extend(fullLayer.getBounds());
          }
          continue;
        }

        // LVIB: Special handling for lv_box and inv_box (clickable, selectable)
        if (isLVIB && (file.name === 'lv_box' || file.name === 'inv_box')) {
          const boxType = file.name === 'lv_box' ? 'lvBox' : 'invBox';
          const featureCount = data.features?.length || 0;

          // Set total counts
          if (boxType === 'lvBox') {
            setLvibLvBoxTotal(featureCount);
          } else {
            setLvibInvBoxTotal(featureCount);
          }

          const boxLayer = L.geoJSON(data, {
            renderer: canvasRenderer,
            interactive: true,
            style: (feature) => {
              // LVIB: IDs must be stable. These files include properties.fid.
              const fid = feature?.properties?.fid ?? feature?.properties?.FID ?? feature?.properties?.id ?? feature?.id;
              const polygonId = `${boxType}_${String(fid)}`;
              const selectedSet = boxType === 'lvBox' ? lvibSelectedLvBoxesRef.current : lvibSelectedInvBoxesRef.current;
              const isSelected = selectedSet.has(polygonId);

              if (isSelected) {
                return {
                  color: '#16a34a',
                  weight: 4.0,
                  opacity: 1,
                  fill: true,
                  fillColor: '#22c55e',
                  fillOpacity: 0.75
                };
              }
              return {
                color: '#dc2626',
                weight: 3.2,
                opacity: 1,
                fill: true,
                fillColor: '#ef4444',
                fillOpacity: 0.3
              };
            },
            onEachFeature: (feature, featureLayer) => {
              // LVIB: IDs must be stable and match the style() path.
              // Prefer CAD-exported feature.properties.fid.
              const fidRaw = feature?.properties?.fid ?? feature?.properties?.FID ?? feature?.properties?.id ?? feature?.id;
              // If fid is missing, derive a deterministic fallback from geometry.
              // (Still stable within a session and avoids the “1 click = 4 count” bug from random IDs.)
              const fid =
                fidRaw != null
                  ? String(fidRaw)
                  : (() => {
                    try {
                      const g = feature?.geometry;
                      const coords = g?.coordinates;
                      const head = Array.isArray(coords) ? JSON.stringify(coords).slice(0, 160) : '';
                      return `geom_${head.length}_${head}`;
                    } catch {
                      return 'geom_unknown';
                    }
                  })();
              const polygonId = `${boxType}_${fid}`;

              // Store box type mapping
              lvibBoxTypeRef.current.set(polygonId, boxType);

              // Store in polygonById for selection box support
              polygonById.current[polygonId] = {
                layer: featureLayer,
                boxType: boxType,
                polygonId: polygonId
              };

              featureLayer.on('click', (e) => {
                try {
                  if (e?.originalEvent) {
                    L.DomEvent.stopPropagation(e.originalEvent);
                    L.DomEvent.preventDefault(e.originalEvent);
                  }
                } catch (_e) { void _e; }

                // Only allow selection if this box type matches current sub-mode
                const currentSubMode = lvibSubModeRef.current;
                if (currentSubMode !== boxType) return;

                const isRightClick = e?.originalEvent?.button === 2;
                const setSelected = boxType === 'lvBox' ? setLvibSelectedLvBoxes : setLvibSelectedInvBoxes;

                setSelected(prev => {
                  const next = new Set(prev);
                  if (isRightClick) {
                    next.delete(polygonId);
                  } else {
                    if (next.has(polygonId)) {
                      next.delete(polygonId);
                    } else {
                      next.add(polygonId);
                    }
                  }
                  return next;
                });

                // Update style
                boxLayer.resetStyle(featureLayer);
              });
            }
          });

          // Store layer reference for style updates
          if (boxType === 'lvBox') {
            lvibLvBoxLayerRef.current = boxLayer;
          } else {
            lvibInvBoxLayerRef.current = boxLayer;
          }

          boxLayer.addTo(mapRef.current);
          layersRef.current.push(boxLayer);

          if (boxLayer.getBounds().isValid()) {
            allBounds.extend(boxLayer.getBounds());
          }

          // Add LV/INV text labels inside boxes using the SAME rendering system/options as inv_id labels.
          // This ensures identical zoom scaling, stroke, and optional background plate behavior.
          const boxLabel = boxType === 'lvBox' ? 'LV' : 'INV';
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
          const invMinTextZoom = typeof activeMode?.invIdTextMinTextZoom === 'number' ? activeMode.invIdTextMinTextZoom : null;
          const invMinBgZoom = typeof activeMode?.invIdTextMinBgZoom === 'number' ? activeMode.invIdTextMinBgZoom : null;

          const baseSize = invBase * invScale;
          const radius = 22 * invScale;
          const features = data.features || [];
          features.forEach((feature) => {
            if (!feature.geometry) return;
            let center = null;
            if (feature.geometry.type === 'Polygon' && feature.geometry.coordinates?.[0]) {
              const coords = feature.geometry.coordinates[0];
              let sumLat = 0, sumLng = 0;
              coords.forEach(([lng, lat]) => {
                sumLat += lat;
                sumLng += lng;
              });
              center = [sumLat / coords.length, sumLng / coords.length];
            } else if (feature.geometry.type === 'MultiPolygon' && feature.geometry.coordinates?.[0]?.[0]) {
              const coords = feature.geometry.coordinates[0][0];
              let sumLat = 0, sumLng = 0;
              coords.forEach(([lng, lat]) => {
                sumLat += lat;
                sumLng += lng;
              });
              center = [sumLat / coords.length, sumLng / coords.length];
            }
            if (!center) return;

            const textMarker = L.textLabel(center, {
              text: boxLabel,
              renderer: canvasRenderer,
              textBaseSize: baseSize,
              refZoom: invRefZoom,
              textStyle: invTextStyle,
              textColor: 'rgba(250,204,21,0.98)', // Yellow - visible on red boxes
              textStrokeColor: invStrokeColor,
              textStrokeWidthFactor: invStrokeWidthFactor,
              minFontSize: invMinFs,
              maxFontSize: invMaxFs,
              bgColor: invBgColor,
              bgPaddingX: invBgPaddingX,
              bgPaddingY: invBgPaddingY,
              bgStrokeColor: invBgStrokeColor,
              bgStrokeWidth: invBgStrokeWidth,
              bgCornerRadius: invBgCornerRadius,
              minTextZoom: invMinTextZoom,
              minBgZoom: invMinBgZoom,
              interactive: false,
              radius,
            });
            textMarker.addTo(mapRef.current);
            layersRef.current.push(textMarker);
          });

          continue;
        }

        // Standard processing for other GeoJSON files
        // LV: inv_id labels are clickable (daily completion). Other modules can opt into LV-style label appearance.
        const invLabelMode = file.name === 'inv_id' && (isLV || isLVTT || activeMode?.invIdLabelMode);
        const invInteractive = (isLV || isLVTT) && file.name === 'inv_id';
        const mvfTrenchInteractive = isMVF && file.name === 'mv_trench';
        // PTEP: both earthing_tabletotable and earthing_parameter are interactive
        const ptepTableToTableInteractive = isPTEP && file.name === 'earthing_tabletotable';
        const ptepParameterInteractive = isPTEP && file.name === 'earthing_parameter';
        // DATP: trench lines are interactive for selection
        const datpTrenchInteractive = isDATP && file.name === 'trench';
        const mvftTrenchInteractive = isMVFT && file.name === 'trench';
        // MVT: we don't want table selection interactions in this mode.
        const disableInteractions = (isMVT || isLVTT) && (file.name === 'full' || file.name === 'subs');

        // For PTEP earthing_tabletotable and earthing_parameter, force an SVG pane above canvas so clicks work under preferCanvas.
        const ptepPaneName = ptepTableToTableInteractive ? 'ptepTableToTablePane' : (ptepParameterInteractive ? 'ptepParameterPane' : undefined);
        // For DATP trench, also use SVG pane
        const datpPaneName = datpTrenchInteractive ? 'datpTrenchPane' : undefined;
        // For MVFT trench, also use SVG pane
        const mvftPaneName = mvftTrenchInteractive ? 'mvftTrenchPane' : undefined;
        const useRenderer = ptepTableToTableInteractive
          ? (ptepTableToTableSvgRendererRef.current || L.svg({ pane: 'ptepTableToTablePane' }))
          : ptepParameterInteractive
            ? (ptepParameterSvgRendererRef.current || L.svg({ pane: 'ptepParameterPane' }))
            : datpTrenchInteractive
              ? (datpSvgRendererRef.current || L.svg({ pane: 'datpTrenchPane' }))
              : mvftTrenchInteractive
                ? (mvftSvgRendererRef.current || L.svg({ pane: 'mvftTrenchPane' }))
                : canvasRenderer;

        const layer = L.geoJSON(data, {
          pane: ptepPaneName || datpPaneName || mvftPaneName,
          renderer: useRenderer,
          interactive: !disableInteractions && (invInteractive || mvfTrenchInteractive || ptepTableToTableInteractive || ptepParameterInteractive || datpTrenchInteractive || mvftTrenchInteractive || (isPL && file.name === 'full')),
          bubblingMouseEvents: !(ptepTableToTableInteractive || ptepParameterInteractive || datpTrenchInteractive || mvftTrenchInteractive),

          style: (feature) => {
            // BOUNDARY: render identically across ALL modules (match DC CABLE PULLING PROGRESS TRACKING)
            if (file.name === 'boundry' || file.name === 'boundary') {
              return {
                color: 'rgba(239, 68, 68, 0.7)',
                weight: 1.2,
                opacity: 1,
                fill: false,
                fillColor: 'transparent',
                fillOpacity: 0,
              };
            }

            // PTEP: earthing_full = background only (dim), but boundry layer = red
            if (isPTEP && file.name === 'earthing_full') {
              const layerName = String(feature?.properties?.layer || '').toLowerCase();
              if (layerName === 'boundry' || layerName === 'boundary') {
                return {
                  color: 'rgba(239, 68, 68, 0.7)',
                  weight: 1.2,
                  opacity: 1,
                  fill: false,
                  fillColor: 'transparent',
                  fillOpacity: 0,
                };
              }
              return {
                color: 'rgba(255,255,255,0.26)',
                weight: 0.78,
                fill: false,
                fillOpacity: 0
              };
            }
            // PTEP: earthing_parameter = YELLOW lines (HIDDEN if tabletotable sub-mode is active)
            if (ptepParameterInteractive) {
              const isActive = ptepSubModeRef.current === 'parameter';
              return {
                color: '#facc15',
                weight: 1.5,
                opacity: isActive ? 1 : 0,
                fill: false,
                fillOpacity: 0
              };
            }
            // PTEP: earthing_tabletotable = BLUE dashed lines (HIDDEN if parameter sub-mode is active)
            // Blue = uncompleted, Green = completed
            if (ptepTableToTableInteractive) {
              // Check if this feature is already completed
              const fid = feature?.properties?.handle ?? feature?.properties?.fid ?? feature?.properties?.FID ?? feature?.properties?.id ?? feature?.id;
              const uniqueId = `tt_${String(fid)}`;
              const isDone = ptepCompletedTableToTableRef.current?.has(uniqueId);
              const isActive = ptepSubModeRef.current === 'tabletotable';
              return {
                color: isDone ? '#00ff00' : '#3b82f6',
                weight: isDone ? 6 : 2.2,
                opacity: isActive ? 1 : 0,
                dashArray: isDone ? null : '6 4',
                lineCap: 'round',
                lineJoin: 'round',
                fill: false,
                fillOpacity: 0
              };
            }
            // LVIB mode: lv_box and inv_box with red color
            if (isLVIB && (file.name === 'lv_box' || file.name === 'inv_box')) {
              return {
                color: '#dc2626',
                weight: 3.2,
                fill: true,
                fillColor: '#ef4444',
                fillOpacity: 0.3
              };
            }
            // DATP (DC&AC Trench Progress): apply colors from config
            if (isDATP) {
              // Use colors from geojsonFiles config
              const layerName = file.name?.toLowerCase();
              if (layerName === 'boundry' || layerName === 'boundary') {
                // Boundary - RED (thinner)
                return {
                  color: 'rgba(239, 68, 68, 0.7)',
                  weight: 1.2,
                  opacity: 1,
                  fill: false,
                  fillColor: 'transparent',
                  fillOpacity: 0,
                };
              }
              if (layerName === 'trench') {
                // Trench lines - use config color (default BLUE)
                return {
                  color: file.color || datpTrenchLineColor,
                  weight: Number(file.weight) || 1.8,
                  opacity: 1,
                  fill: false,
                  fillOpacity: 0,
                };
              }
              if (layerName === 'full') {
                // Full panels - dim white background
                return {
                  color: 'rgba(255,255,255,0.26)',
                  weight: 0.78,
                  fill: false,
                  fillOpacity: 0
                };
              }
            }
            // MVFT (MV&FIBRE Trench Progress): apply colors from config (similar to DATP)
            if (isMVFT) {
              const layerName = file.name?.toLowerCase();
              if (layerName === 'boundry' || layerName === 'boundary') {
                // Boundary - RED (thinner)
                return {
                  color: 'rgba(239, 68, 68, 0.7)',
                  weight: 1.2,
                  opacity: 1,
                  fill: false,
                  fillColor: 'transparent',
                  fillOpacity: 0,
                };
              }
              if (layerName === 'trench') {
                // Trench lines - WHITE (selectable)
                return {
                  color: file.color || mvftTrenchLineColor,
                  weight: Number(file.weight) || 1.5,
                  opacity: 1,
                  lineCap: 'round',
                  lineJoin: 'round',
                  fill: false,
                  fillOpacity: 0,
                };
              }
              if (layerName === 'full') {
                // Full panels - dim white background (like DC CABLE PULLING)
                return {
                  color: 'rgba(255,255,255,0.55)',
                  weight: 0.78,
                  fill: false,
                  fillColor: 'transparent',
                  fillOpacity: 0
                };
              }
              // MVFT subs layer
              if (layerName === 'subs') {
                return {
                  color: '#94a3b8',
                  weight: 1.5,
                  fill: false,
                  fillOpacity: 0
                };
              }
            }
            // Restore the "dim white" look for all layers, with a stronger LV box outline.
            if (file.name === 'lv_box') {
              return {
                color: file.color || 'rgba(255,255,255,0.95)',
                weight: Number(file.weight) || 3.2,
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

              // LV: store inv_id position for lv_box matching
              if (isLV) {
                try {
                  lvInvLatLngByIdRef.current[invIdNorm] = latlng;
                } catch (_e) {
                  void _e;
                }
              }

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
                  // LVTT should match MC4-style: uncompleted = white, completed = green.
                  textColor = terminated === 3 ? 'rgba(34,197,94,0.98)' : 'rgba(255,255,255,0.98)';
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
                underline: isLVTT ? true : undefined,
                underlineColor: isLVTT ? textColor : undefined,
                underlineWidthFactor: isLVTT ? 1 : undefined,
                interactive: isLV || isLVTT || isMC4 || isDCTT,
                radius
              });

              // MC4: inverter click popup in Cable Termination Inv. Side mode
              if (isMC4) {
                label.on('click', (e) => {
                  try {
                    if (e?.originalEvent) {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      L.DomEvent.preventDefault(e.originalEvent);
                    }
                  } catch (_e) {
                    void _e;
                  }
                  const mode = String(mc4SelectionModeRef.current || 'mc4');
                  if (mode !== 'termination_inv' && mode !== 'termination_panel') return;

                  const invNorm2 = normalizeId(displayId);
                  const max = Math.max(0, Number(mc4InvMaxByInvRef.current?.[invNorm2] ?? 0) || 0);
                  const stored = Math.max(0, Math.min(max > 0 ? max : 999999, Number(mc4InvTerminationByInvRef.current?.[invNorm2] ?? 0) || 0));
                  const oe = e?.originalEvent;
                  const x = oe?.clientX ?? 0;
                  const y = oe?.clientY ?? 0;
                  setMc4InvPopup({
                    invId: displayId,
                    invIdNorm: invNorm2,
                    draft: stored,
                    max,
                    x,
                    y,
                  });
                });
              }

              // DCTT: inverter click popup in Cable Termination Inv. Side mode
              if (isDCTT) {
                label.on('click', (e) => {
                  try {
                    if (e?.originalEvent) {
                      L.DomEvent.stopPropagation(e.originalEvent);
                      L.DomEvent.preventDefault(e.originalEvent);
                    }
                  } catch (_e) {
                    void _e;
                  }
                  const mode = String(dcttSelectionModeRef.current || 'termination_panel');
                  if (mode !== 'termination_inv' && mode !== 'termination_panel') return;

                  const invNorm2 = normalizeId(displayId);
                  const max = Math.max(0, Number(dcttInvMaxByInvRef.current?.[invNorm2] ?? 0) || 0);
                  const stored = Math.max(0, Math.min(max > 0 ? max : 999999, Number(dcttInvTerminationByInvRef.current?.[invNorm2] ?? 0) || 0));
                  const oe = e?.originalEvent;
                  const x = oe?.clientX ?? 0;
                  const y = oe?.clientY ?? 0;
                  setDcttInvPopup({
                    invId: displayId,
                    invIdNorm: invNorm2,
                    draft: stored,
                    max,
                    x,
                    y,
                  });
                });
              }

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
                    // Don't allow unselecting committed/submitted inv_ids (only deletable via history 🗑️)
                    if (next.has(invIdNorm)) {
                      const committed = lvCommittedInvIdsRef.current || new Set();
                      if (committed.has(invIdNorm)) return prev;
                      next.delete(invIdNorm);
                    } else {
                      next.add(invIdNorm);
                    }
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
                    setLvttPopup({
                      mode: 'testing',
                      invId: displayId,
                      invIdNorm,
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
                // NOTE: do not lock interaction at 3/3; users must be able to correct before submit.
                label._lvttLocked = false;
                // store meta so we can draw a separate clickable 0/3 counter under the inv_id
                lvttInvMetaByNormRef.current[invIdNorm] = {
                  lat: latlng.lat,
                  lng: latlng.lng,
                  angle: feature.properties.angle || 0,
                  raw,
                  displayId,
                };
              }

              // DCTT: store label reference for color updates when termination is complete
              if (isDCTT) {
                dcttInvLabelByIdRef.current[invIdNorm] = label;
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
            // LV: index lv_box geometries so we can turn the box green when its inv_id is selected.
            if (isLV && file.name === 'lv_box') {
              try {
                // compute a center point for the geometry
                const g = feature?.geometry;
                const coords = g?.coordinates;
                let latSum = 0;
                let lngSum = 0;
                let n = 0;
                const push = (c) => {
                  const lng = Number(c?.[0]);
                  const lat = Number(c?.[1]);
                  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
                  latSum += lat;
                  lngSum += lng;
                  n += 1;
                };
                if (g?.type === 'LineString' && Array.isArray(coords)) {
                  coords.forEach(push);
                } else if (g?.type === 'Polygon' && Array.isArray(coords)) {
                  (coords[0] || []).forEach(push);
                } else if (g?.type === 'MultiPolygon' && Array.isArray(coords)) {
                  ((coords[0] || [])[0] || []).forEach(push);
                }
                if (n > 0) {
                  const center = L.latLng(latSum / n, lngSum / n);
                  const cellKey = (lat, lng) => {
                    const cx = Math.floor(lng / LV_INV_BOX_GRID_DEG);
                    const cy = Math.floor(lat / LV_INV_BOX_GRID_DEG);
                    return `${cx}:${cy}`;
                  };
                  const grid = lvInvGridRef.current || new Map();
                  const baseKey = cellKey(center.lat, center.lng);
                  const [cxStr, cyStr] = String(baseKey).split(':');
                  const cx = Number(cxStr);
                  const cy = Number(cyStr);
                  let bestId = null;
                  let bestDist = Infinity;
                  for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                      const ids = grid.get(`${cx + dx}:${cy + dy}`) || [];
                      for (const invIdNorm of ids) {
                        const ll = lvInvLatLngByIdRef.current?.[invIdNorm];
                        if (!ll) continue;
                        const d = center.distanceTo(ll);
                        if (d < bestDist) {
                          bestDist = d;
                          bestId = invIdNorm;
                        }
                      }
                    }
                  }
                  // Only link if it's reasonably close (prevents random pairing)
                  if (bestId && bestDist < 60) {
                    const mapById = lvBoxLayersByInvIdRef.current;
                    if (!mapById[bestId]) mapById[bestId] = [];
                    mapById[bestId].push(featureLayer);
                  }
                  lvAllBoxLayersRef.current.push(featureLayer);
                }
              } catch (_e) {
                void _e;
              }
            }

            // PTEP: table-to-table click handler (toggle white/green)
            if (ptepTableToTableInteractive && featureLayer && typeof featureLayer.on === 'function') {
              const fid = feature?.properties?.handle ?? feature?.properties?.fid ?? feature?.properties?.FID ?? feature?.properties?.id ?? feature?.id;
              const uniqueId = `tt_${String(fid)}`;
              featureLayer._ptepUniqueId = uniqueId;
              ptepTableToTableByIdRef.current[uniqueId] = featureLayer;

              // Ensure layer is interactive
              if (featureLayer.options) {
                featureLayer.options.interactive = true;
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
                // Only allow selection when tabletotable sub-mode is active
                if (ptepSubModeRef.current !== 'tabletotable') return;

                const isRightClick = e?.originalEvent?.button === 2;
                setPtepCompletedTableToTable((prev) => {
                  const next = new Set(prev);
                  if (isRightClick) {
                    // Right-click: deselect
                    next.delete(uniqueId);
                  } else {
                    // Left-click: toggle
                    if (next.has(uniqueId)) {
                      next.delete(uniqueId);
                    } else {
                      next.add(uniqueId);
                    }
                  }
                  return next;
                });
              });
            }

            // PTEP: parameter click handler (toggle normal/green, track meters)
            if (ptepParameterInteractive && featureLayer && typeof featureLayer.on === 'function') {
              const fid = feature?.properties?.handle ?? feature?.properties?.fid ?? feature?.properties?.id ?? feature?.id;
              const uniqueId = `param_${String(fid)}`;
              featureLayer._ptepParamUniqueId = uniqueId;
              ptepParameterByIdRef.current[uniqueId] = featureLayer;

              // Compute line length in meters
              try {
                const geom = feature?.geometry;
                let meters = 0;
                const addLineMeters = (coords) => {
                  if (!Array.isArray(coords) || coords.length < 2) return;
                  let prev = null;
                  for (const c of coords) {
                    const lng = c?.[0];
                    const lat = c?.[1];
                    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
                    const ll = L.latLng(lat, lng);
                    if (prev) {
                      meters += prev.distanceTo(ll);
                    }
                    prev = ll;
                  }
                };
                if (geom?.type === 'LineString') addLineMeters(geom.coordinates);
                else if (geom?.type === 'MultiLineString') (geom.coordinates || []).forEach(addLineMeters);
                ptepParameterLenByIdRef.current[uniqueId] = meters;
              } catch (_e) {
                void _e;
                ptepParameterLenByIdRef.current[uniqueId] = 0;
              }

              // Ensure layer is interactive
              if (featureLayer.options) {
                featureLayer.options.interactive = true;
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
                // Only allow selection when parameter sub-mode is active
                if (ptepSubModeRef.current !== 'parameter') return;

                const isRightClick = e?.originalEvent?.button === 2;
                setPtepSelectedParameterParts((prev) => {
                  const parts = Array.isArray(prev) ? prev : [];

                  // Right-click: remove all selected parts for this feature
                  if (isRightClick) {
                    return parts.filter((p) => String(p?.uid || '') !== uniqueId);
                  }

                  // Left-click: toggle FULL coverage for this feature
                  const kept = parts.filter((p) => String(p?.uid || '') !== uniqueId);

                  // Determine whether this feature is already fully covered
                  let fullyCovered = true;
                  try {
                    const lines = asLineStrings(featureLayer.getLatLngs());
                    const byLine = new Map(); // lineIndex -> merged intervals
                    parts.forEach((p) => {
                      if (String(p?.uid || '') !== uniqueId) return;
                      const li = Number(p?.lineIndex);
                      const a = Number(p?.startM);
                      const b = Number(p?.endM);
                      if (!Number.isFinite(li) || !Number.isFinite(a) || !Number.isFinite(b)) return;
                      const lo = Math.min(a, b);
                      const hi = Math.max(a, b);
                      if (!(hi > lo)) return;
                      if (!byLine.has(li)) byLine.set(li, []);
                      byLine.get(li).push([lo, hi]);
                    });
                    lines.forEach((lineLL, lineIndex) => {
                      if (!Array.isArray(lineLL) || lineLL.length < 2) return;
                      const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                      const totalM = cumData?.cum?.[cumData.cum.length - 1] || 0;
                      if (!(totalM > 0)) return;
                      const merged = mergeIntervals(byLine.get(lineIndex) || []);
                      const ok = merged.length === 1 && merged[0][0] <= 0.2 && merged[0][1] >= totalM - 0.2;
                      if (!ok) fullyCovered = false;
                    });
                  } catch (_e) {
                    void _e;
                    fullyCovered = false;
                  }

                  // If fully covered -> toggle off (remove all parts)
                  if (fullyCovered) return kept;

                  // Otherwise -> set full coverage parts
                  const toAdd = [];
                  try {
                    const lines = asLineStrings(featureLayer.getLatLngs());
                    lines.forEach((lineLL, lineIndex) => {
                      if (!Array.isArray(lineLL) || lineLL.length < 2) return;
                      const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                      const totalM = cumData?.cum?.[cumData.cum.length - 1] || 0;
                      if (!(totalM > 0)) return;
                      const coords = sliceLineByMeters({ lineLatLngs: lineLL, cumData, startM: 0, endM: totalM });
                      if (!coords || coords.length < 2) return;
                      toAdd.push({
                        id: `${uniqueId}:${lineIndex}:0.00-${totalM.toFixed(2)}`,
                        uid: uniqueId,
                        lineIndex,
                        startM: 0,
                        endM: totalM,
                        coords,
                        meters: totalM,
                      });
                    });
                  } catch (_e) {
                    void _e;
                  }

                  return toAdd.length > 0 ? [...kept, ...toAdd] : kept;
                });
              });
            }

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

            // DATP: allow selecting dc_trench lines (MVF-style partial selection)
            if (datpTrenchInteractive && featureLayer && typeof featureLayer.on === 'function') {
              const fid = feature?.properties?.handle ?? feature?.properties?.fid ?? feature?.properties?.id ?? feature?.id ?? `datp_${Math.random().toString(36).slice(2)}`;
              const uniqueId = `datp_${String(fid)}`;
              featureLayer._datpTrenchId = uniqueId;
              datpTrenchByIdRef.current[uniqueId] = featureLayer;

              // Compute line length in meters
              try {
                const geom = feature?.geometry;
                let meters = 0;
                const addLineMeters = (coords) => {
                  if (!Array.isArray(coords) || coords.length < 2) return;
                  let prev = null;
                  for (const c of coords) {
                    const lng = c?.[0];
                    const lat = c?.[1];
                    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
                    const ll = L.latLng(lat, lng);
                    if (prev) {
                      meters += prev.distanceTo(ll);
                    }
                    prev = ll;
                  }
                };
                if (geom?.type === 'LineString') addLineMeters(geom.coordinates);
                else if (geom?.type === 'MultiLineString') (geom.coordinates || []).forEach(addLineMeters);
                datpTrenchLenByIdRef.current[uniqueId] = meters;
                // Accumulate total as we process each feature
                setDatpTotalTrenchMeters((prev) => prev + meters);
              } catch (_e) {
                void _e;
                datpTrenchLenByIdRef.current[uniqueId] = 0;
              }

              // Ensure layer is interactive
              if (featureLayer.options) {
                featureLayer.options.interactive = true;
              }

              // Click handler for DATP trench (similar to PTEP parameter)
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

                const isRightClick = e?.originalEvent?.button === 2;
                setDatpSelectedTrenchParts((prev) => {
                  const parts = Array.isArray(prev) ? prev : [];

                  // Right-click: remove all selected parts for this feature
                  if (isRightClick) {
                    return parts.filter((p) => String(p?.uid || '') !== uniqueId);
                  }

                  // Left-click: toggle FULL coverage for this feature
                  const kept = parts.filter((p) => String(p?.uid || '') !== uniqueId);

                  // Determine whether this feature is already fully covered
                  let fullyCovered = true;
                  try {
                    const lines = asLineStrings(featureLayer.getLatLngs());
                    const byLine = new Map();
                    parts.forEach((p) => {
                      if (String(p?.uid || '') !== uniqueId) return;
                      const li = Number(p?.lineIndex);
                      const a = Number(p?.startM);
                      const b = Number(p?.endM);
                      if (!Number.isFinite(li) || !Number.isFinite(a) || !Number.isFinite(b)) return;
                      const lo = Math.min(a, b);
                      const hi = Math.max(a, b);
                      if (!(hi > lo)) return;
                      if (!byLine.has(li)) byLine.set(li, []);
                      byLine.get(li).push([lo, hi]);
                    });
                    lines.forEach((lineLL, lineIndex) => {
                      if (!Array.isArray(lineLL) || lineLL.length < 2) return;
                      const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                      const totalM = cumData?.cum?.[cumData.cum.length - 1] || 0;
                      if (!(totalM > 0)) return;
                      const merged = mergeIntervals(byLine.get(lineIndex) || []);
                      const ok = merged.length === 1 && merged[0][0] <= 0.2 && merged[0][1] >= totalM - 0.2;
                      if (!ok) fullyCovered = false;
                    });
                  } catch (_e) {
                    void _e;
                    fullyCovered = false;
                  }

                  // If fully covered -> toggle off (remove all parts)
                  if (fullyCovered) return kept;

                  // Not fully covered -> add full coverage
                  const toAdd = [];
                  try {
                    const lines = asLineStrings(featureLayer.getLatLngs());
                    lines.forEach((lineLL, lineIndex) => {
                      if (!Array.isArray(lineLL) || lineLL.length < 2) return;
                      const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                      const totalM = cumData?.cum?.[cumData.cum.length - 1] || 0;
                      if (!(totalM > 0)) return;
                      const coords = sliceLineByMeters({ lineLatLngs: lineLL, cumData, startM: 0, endM: totalM });
                      if (!coords || coords.length < 2) return;
                      toAdd.push({
                        id: `${uniqueId}:${lineIndex}:0.00-${totalM.toFixed(2)}`,
                        uid: uniqueId,
                        lineIndex,
                        startM: 0,
                        endM: totalM,
                        coords,
                        meters: totalM,
                      });
                    });
                  } catch (_e) {
                    void _e;
                  }

                  return toAdd.length > 0 ? [...kept, ...toAdd] : kept;
                });
              });
            }

            // MVFT: allow selecting mv_trench lines (DATP-style selection)
            if (mvftTrenchInteractive && featureLayer && typeof featureLayer.on === 'function') {
              const fid = feature?.properties?.handle ?? feature?.properties?.fid ?? feature?.properties?.id ?? feature?.id ?? `mvft_${Math.random().toString(36).slice(2)}`;
              const uniqueId = `mvft_${String(fid)}`;
              featureLayer._mvftTrenchId = uniqueId;
              mvftTrenchByIdRef.current[uniqueId] = featureLayer;

              // Compute line length in meters
              try {
                const geom = feature?.geometry;
                let meters = 0;
                const addLineMeters = (coords) => {
                  if (!Array.isArray(coords) || coords.length < 2) return;
                  let prev = null;
                  for (const c of coords) {
                    const lng = c?.[0];
                    const lat = c?.[1];
                    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
                    const ll = L.latLng(lat, lng);
                    if (prev) meters += prev.distanceTo(ll);
                    prev = ll;
                  }
                };
                if (geom?.type === 'LineString') addLineMeters(geom.coordinates);
                else if (geom?.type === 'MultiLineString') (geom.coordinates || []).forEach(addLineMeters);
                mvftTrenchLenByIdRef.current[uniqueId] = meters;
                setMvftTotalTrenchMeters((prev) => prev + meters);
              } catch (_e) {
                void _e;
                mvftTrenchLenByIdRef.current[uniqueId] = 0;
              }

              // Ensure layer is interactive
              if (featureLayer.options) {
                featureLayer.options.interactive = true;
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
                if (disableInteractions || noteMode) return;

                const isRightClick = e?.originalEvent?.button === 2;
                setMvftSelectedTrenchParts((prev) => {
                  const parts = Array.isArray(prev) ? prev : [];

                  // Right-click: remove all selected parts for this feature
                  if (isRightClick) {
                    return parts.filter((p) => String(p?.uid || '') !== uniqueId);
                  }

                  // Left-click: toggle FULL coverage for this feature
                  const kept = parts.filter((p) => String(p?.uid || '') !== uniqueId);

                  // Determine whether this feature is already fully covered
                  let fullyCovered = true;
                  try {
                    const lines = asLineStrings(featureLayer.getLatLngs());
                    const byLine = new Map();
                    parts.forEach((p) => {
                      if (String(p?.uid || '') !== uniqueId) return;
                      const li = Number(p?.lineIndex);
                      const a = Number(p?.startM);
                      const b = Number(p?.endM);
                      if (!Number.isFinite(li) || !Number.isFinite(a) || !Number.isFinite(b)) return;
                      const lo = Math.min(a, b);
                      const hi = Math.max(a, b);
                      if (!(hi > lo)) return;
                      if (!byLine.has(li)) byLine.set(li, []);
                      byLine.get(li).push([lo, hi]);
                    });
                    lines.forEach((lineLL, lineIndex) => {
                      if (!Array.isArray(lineLL) || lineLL.length < 2) return;
                      const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                      const totalM = cumData?.cum?.[cumData.cum.length - 1] || 0;
                      if (!(totalM > 0)) return;
                      const merged = mergeIntervals(byLine.get(lineIndex) || []);
                      const ok = merged.length === 1 && merged[0][0] <= 0.2 && merged[0][1] >= totalM - 0.2;
                      if (!ok) fullyCovered = false;
                    });
                  } catch (_e) {
                    void _e;
                    fullyCovered = false;
                  }

                  // If fully covered -> toggle off (remove all parts)
                  if (fullyCovered) return kept;

                  // Not fully covered -> add full coverage
                  const toAdd = [];
                  try {
                    const lines = asLineStrings(featureLayer.getLatLngs());
                    lines.forEach((lineLL, lineIndex) => {
                      if (!Array.isArray(lineLL) || lineLL.length < 2) return;
                      const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                      const totalM = cumData?.cum?.[cumData.cum.length - 1] || 0;
                      if (!(totalM > 0)) return;
                      const coords = sliceLineByMeters({ lineLatLngs: lineLL, cumData, startM: 0, endM: totalM });
                      if (!coords || coords.length < 2) return;
                      toAdd.push({
                        id: `${uniqueId}:${lineIndex}:0.00-${totalM.toFixed(2)}`,
                        uid: uniqueId,
                        lineIndex,
                        startM: 0,
                        endM: totalM,
                        coords,
                        meters: totalM,
                      });
                    });
                  } catch (_e) {
                    void _e;
                  }

                  return toAdd.length > 0 ? [...kept, ...toAdd] : kept;
                });
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

        // PTEP: Count total table-to-table features
        if (isPTEP && file.name === 'earthing_tabletotable' && data?.features?.length) {
          setPtepTotalTableToTable(data.features.length);
        }

        // PTEP: Compute total parameter meters from stored lengths
        if (isPTEP && file.name === 'earthing_parameter' && data?.features?.length) {
          // Sum up all the meters we calculated in onEachFeature
          setTimeout(() => {
            let totalMeters = 0;
            Object.values(ptepParameterLenByIdRef.current).forEach((m) => {
              totalMeters += m || 0;
            });
            setPtepTotalParameterMeters(totalMeters);
          }, 100);
        }

        // DATP: Compute total trench meters from stored lengths
        if (isDATP && file.name === 'trench' && data?.features?.length) {
          setTimeout(() => {
            let totalMeters = 0;
            Object.values(datpTrenchLenByIdRef.current).forEach((m) => {
              totalMeters += m || 0;
            });
            setDatpTotalTrenchMeters(totalMeters);
          }, 100);
        }

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

                // Many CAD exports contain exact duplicate polygons.
                // For weighted-counter modes, we must count each physical table once.
                const dedupeKey = (() => {
                  try {
                    const sw = bounds.getSouthWest();
                    const ne = bounds.getNorthEast();
                    if (!sw || !ne) return '';
                    // 7 decimals is ~1cm-ish; plenty to collapse exact duplicates but not nearby tables.
                    return `${sw.lat.toFixed(7)}:${sw.lng.toFixed(7)}:${ne.lat.toFixed(7)}:${ne.lng.toFixed(7)}`;
                  } catch (_e) {
                    void _e;
                    return '';
                  }
                })();

                // Persist on polygon record for later selection/counter de-duplication.
                if (uid && polygonById.current?.[uid]) {
                  polygonById.current[uid].dedupeKey = dedupeKey;
                }

                polygonInfos.push({
                  featureLayer,
                  bounds,
                  center,
                  geometry,
                  diag,
                  isSmallTable,
                  dedupeKey,
                });
              } catch (_e) { void _e; }
            }
          });
        }
      });

      polygonInfos.sort((a, b) => b.diag - a.diag);

      // MODULE_INSTALLATION_PROGRES_TRACKING (and other potential weighted-counter modules):
      // Classify table sizes from full.geojson into 3 buckets (long/medium/short) using
      // the most-common longest-edge lengths. This is robust to tiny outliers (e.g. stray micro-polygons)
      // that would otherwise steal a k-means cluster and collapse 14/13 into one group.
      if (activeMode?.workUnitWeights && polygonInfos.length) {
        try {
          const weights = activeMode.workUnitWeights;
          const wLong = Number(weights?.long);
          const wMed = Number(weights?.medium);
          const wShort = Number(weights?.short);
          if (Number.isFinite(wLong) && Number.isFinite(wMed) && Number.isFinite(wShort)) {
            const map = mapRef.current;
            const longestEdgeOf = (featureLayer) => {
              if (!map || !featureLayer || typeof featureLayer.getLatLngs !== 'function') return 0;
              let ll = featureLayer.getLatLngs();
              // Drill down to an array of LatLngs representing the outer ring.
              while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
              while (Array.isArray(ll) && ll.length && Array.isArray(ll[0])) ll = ll[0];
              const ring = Array.isArray(ll) ? ll : null;
              if (!ring || ring.length < 2) return 0;
              let max = 0;
              for (let i = 0; i < ring.length - 1; i++) {
                const a = ring[i];
                const b = ring[i + 1];
                if (!a || !b) continue;
                try {
                  const d = L.latLng(a.lat, a.lng).distanceTo(L.latLng(b.lat, b.lng));
                  if (Number.isFinite(d) && d > max) max = d;
                } catch (_e) {
                  void _e;
                }
              }
              // If the ring isn't explicitly closed, also measure last->first.
              try {
                const first = ring[0];
                const last = ring[ring.length - 1];
                if (first && last) {
                  const d = L.latLng(first.lat, first.lng).distanceTo(L.latLng(last.lat, last.lng));
                  if (Number.isFinite(d) && d > max) max = d;
                }
              } catch (_e) {
                void _e;
              }
              return max;
            };

            // Build a histogram of longest-edge lengths (bucketed) and pick the top-3 most common buckets.
            // Bucket size 0.1m is tight enough given CAD-derived data.
            const bucketStep = 0.1;
            const bucketOf = (val) => (Math.round(val / bucketStep) * bucketStep);
            const counts = new Map();

            polygonInfos.forEach((p) => {
              const e = longestEdgeOf(p?.featureLayer);
              p.longestEdge = e;
              // Ignore degenerate shapes (e.g. 0.2m micro-features)
              if (!(e > 1)) return;
              const b = bucketOf(e);
              counts.set(b, (counts.get(b) || 0) + 1);
            });

            const reps = Array.from(counts.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([edge]) => Number(edge))
              .filter((v) => Number.isFinite(v) && v > 0)
              .sort((a, b) => b - a);

            if (reps.length === 3) {
              const repWeights = new Map([
                [reps[0], wLong],
                [reps[1], wMed],
                [reps[2], wShort],
              ]);

              const nearestRep = (val) => {
                let best = reps[0];
                let bestDist = Math.abs(val - reps[0]);
                for (let i = 1; i < reps.length; i++) {
                  const d = Math.abs(val - reps[i]);
                  if (d < bestDist) {
                    best = reps[i];
                    bestDist = d;
                  }
                }
                return best;
              };

              let totalUnits = 0;
              const seenKeys = new Set();
              polygonInfos.forEach((p) => {
                const uid = p?.featureLayer?._uniquePolygonId;
                if (!uid || !polygonById.current?.[uid]) return;
                const e = Number(p?.longestEdge) || 0;
                if (!(e > 0)) return;
                const rep = nearestRep(e);
                const units = Number(repWeights.get(rep)) || 0;
                polygonById.current[uid].workUnits = units;

                const key = String(polygonById.current?.[uid]?.dedupeKey || uid);
                if (!seenKeys.has(key)) {
                  seenKeys.add(key);
                  totalUnits += units;
                }
              });

              setTotalPlus(totalUnits);
              setTotalMinus(0);
            }
          }
        } catch (_e) {
          void _e;
        }
      }

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

  // RELOAD DATA ON MODE CHANGE:
  // Ensure we refetch/re-render GeoJSON when the active module or sub-mode flags change.
  // This is critical for 'isPL' (Punch List) which changes layer styling (fill: true, interactive: true).
  // Without this, the layers retain their initial state (interactive: false) and table clicks/hovers fail.
  useEffect(() => {
    if (mapReady) {
      fetchAllGeoJson();
    }
  }, [mapReady, activeMode, isPL, isDCTT, isPTEP, isMVT, isLV, isLVTT, isMVF, isDATP, isMC4]);

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
      mvfSegmentLinesByKeyRef.current = {}; // Clear stored segment lines
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

      // Store line for history highlighting
      if (!mvfSegmentLinesByKeyRef.current[k]) {
        mvfSegmentLinesByKeyRef.current[k] = [];
      }
      mvfSegmentLinesByKeyRef.current[k].push(line);

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
    // PUNCH_LIST: disable box selection only in normal mode.
    // Note mode relies on these handlers for click-to-create and box-to-select notes.
    if (isMVT || isLVTT || (isPL && !noteMode)) return;

    const map = mapRef.current;
    const container = map.getContainer();

    const isNoteMarkerDomTarget = (evt) => {
      const t = evt?.target;
      if (!t) return false;
      return Boolean(
        t.closest?.('.custom-note-pin') ||
        t.closest?.('.note-dot-hit') ||
        t.closest?.('.note-dot-core') ||
        t.closest?.('.custom-punch-pin') ||
        t.closest?.('.punch-dot-hit') ||
        t.closest?.('.punch-dot-core')
      );
    };

    // Prevent default context menu only on map container
    const preventContextMenu = (e) => {
      e.preventDefault();
    };
    container.addEventListener('contextmenu', preventContextMenu);

    const onMouseDown = (e) => {
      if (e.button !== 0 && e.button !== 2) return; // Left or right click

      // PUNCH_LIST: Capture hamburger menu state NOW (before App.jsx's document listener closes it)
      // This must be done at mousedown because App.jsx closes menu on mousedown
      if (isPL) {
        plHamburgerWasOpenOnMouseDownRef.current = !!window.__cewHamburgerMenuOpen;
      }

      // Prevent "clicking a note marker creates a new note" bug
      if (noteMode && isNoteMarkerDomTarget(e)) {
        return;
      }

      // Reset marker click flag at start of new interaction
      markerClickedRef.current = false;
      polygonClickedRef.current = false;

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

      // PUNCH_LIST: box selection should not leak into Leaflet's own handlers.
      // When Leaflet also processes the same drag, canvas hover can get stuck after box select.
      if (isPL && !noteMode) {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (_e) {
          void _e;
        }
      }
      try { map.dragging?.disable?.(); } catch (_e) { void _e; }
    };

    const onMouseMove = (e) => {
      if (!draggingRef.current) return;

      // DCTT: In DC_TESTING sub-mode we don't show the selection rectangle.
      // (Tables should not be selectable; only string_id text click opens popup.)
      if (isDCTT && !noteMode && String(dcttSubModeRef.current || 'termination') === 'testing') {
        return;
      }

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
          dashArray: '5, 5',
          interactive: false,
        }).addTo(map);
      }
    };

    const onMouseUp = (e) => {
      if (!draggingRef.current) return;

      // ═══════════════════════════════════════════════════════════════════
      // MENU OPEN CHECK: If any menu WAS open when mousedown started, don't create punch
      // We use the ref captured at mousedown because App.jsx closes hamburger on mousedown
      // ═══════════════════════════════════════════════════════════════════
      const wasHamburgerMenuOpen = plHamburgerWasOpenOnMouseDownRef.current === true;
      const isContractorDropdownOpen = plContractorDropdownOpenRef.current === true;

      // Reset the hamburger flag for next interaction
      plHamburgerWasOpenOnMouseDownRef.current = false;

      if (wasHamburgerMenuOpen || isContractorDropdownOpen) {
        // Close contractor dropdown if open
        if (isContractorDropdownOpen) {
          setPlContractorDropdownOpen(false);
        }
        // Hamburger menu closes itself via App.jsx document listener
        // Clean up drag state and exit - don't do anything else
        draggingRef.current = null;
        if (boxRectRef.current) {
          try { boxRectRef.current.remove(); } catch (_e) { void _e; }
          boxRectRef.current = null;
        }
        try { map.dragging.enable(); } catch (_e) { void _e; }
        return;
      }
      // ═══════════════════════════════════════════════════════════════════

      // Always restore map dragging, even if selection logic throws.
      try {
        map.dragging.enable();
      } catch (_e) {
        void _e;
      }

      const wasDrag = draggingRef.current.isDrag;
      const isRightClick = draggingRef.current.isRightClick;
      const clickLatLng = draggingRef.current.start;

      // PUNCH_LIST: stop the mouseup from bubbling into Leaflet after a box-select drag.
      if (isPL && wasDrag && !noteMode) {
        try {
          e?.preventDefault?.();
          e?.stopPropagation?.();
        } catch (_e) {
          void _e;
        }
      }

      // Handle box selection (drag)
      if (boxRectRef.current && wasDrag) {
        const bounds = boxRectRef.current.getBounds();

        if (noteMode) {
          // PUNCH_LIST MODE: Select punches within bounds
          if (isPL) {
            const punchesInBounds = plPunches.filter(punch => {
              // Get punch position (handle isometric punches with random positions)
              let pLat = punch.lat;
              let pLng = punch.lng;

              // If isometric punch with stored position, use that
              if (punch.tableId && punch.isoX != null && punch.isoY != null && punch.lat === 0 && punch.lng === 0) {
                const storedPos = plIsoPunchPositionsRef.current?.[punch.id];
                if (storedPos) {
                  pLat = storedPos.lat;
                  pLng = storedPos.lng;
                }
              }

              if (!pLat || !pLng) return false;
              return bounds.contains(L.latLng(pLat, pLng));
            });

            if (punchesInBounds.length > 0) {
              setPlSelectedPunches(prev => {
                const next = new Set(prev);
                if (isRightClick) {
                  punchesInBounds.forEach(p => next.delete(p.id));
                } else {
                  punchesInBounds.forEach(p => next.add(p.id));
                }
                return next;
              });
            }
          } else {
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
          } else if (isMC4 || (isDCTT && String(dcttSubModeRef.current || 'termination') !== 'testing')) {
            // MC4 / DCTT: Box advance/reset panel states
            let ids = [];
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
              const isDcttPanel = isDCTT;
              const currentMode = isDcttPanel ? dcttSelectionModeRef.current : mc4SelectionModeRef.current; // null | 'mc4' | 'termination_panel' | 'termination_inv'
              const showToast = isDcttPanel ? showDcttToast : showMc4Toast;
              const getState = isDcttPanel ? dcttGetPanelState : mc4GetPanelState;
              const setStates = isDcttPanel ? setDcttPanelStates : setMc4PanelStates;
              const pushHistory = isDcttPanel ? dcttPushHistory : mc4PushHistory;

              // DCTT lock: submitted tables cannot be erased via box right-click.
              if (isDcttPanel && isRightClick) {
                const committed = dcttCommittedPanelIdsRef.current || new Set();
                ids = ids.filter((pid) => !committed.has(String(pid)));
                if (ids.length === 0) {
                  showDcttToast('Submitted tables can only be removed from History.');
                }
              }

              if (!currentMode) {
                // Show warning, but DO NOT return early; onMouseUp must continue so the selection box closes.
                showToast('Please select a mode above.');
              } else {
                // Inv-side termination does not edit panels via box select; allow right-click erase.
                if (!isRightClick && currentMode === 'termination_inv') {
                  // no-op
                } else {
                  const changes = ids.map((pid) => {
                    const prev = getState(pid);
                    const next = isRightClick
                      ? { left: null, right: null }
                      : (isDcttPanel
                        ? { left: DCTT_PANEL_STATES.TERMINATED, right: DCTT_PANEL_STATES.TERMINATED }
                        : (() => {
                          const advanceState = (cur) => {
                            if (currentMode === 'mc4') {
                              // MC4 mode: set to MC4 (blue), but never downgrade TERMINATED (green)
                              if (cur === 'terminated') return 'terminated';
                              return 'mc4';
                            } else if (currentMode === 'termination_panel') {
                              // Termination mode: ONLY MC4 (blue) -> TERMINATED (green)
                              if (cur === 'mc4') return 'terminated';
                              if (cur === 'terminated') return 'terminated';
                              return cur;
                            }
                            return cur;
                          };
                          return { left: advanceState(prev.left), right: advanceState(prev.right) };
                        })());
                    return { id: pid, prev, next };
                  });

                  // MC4-only: Warn if user is trying to terminate panels that are not MC4-installed (not blue)
                  if (!isRightClick && !isDcttPanel && currentMode === 'termination_panel') {
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
                    if ((advanced === 0 && blocked > 0) || blocked > 0) showMc4Toast('Some tables were not MC4-installed yet');
                  }

                  setStates((s) => {
                    const out = { ...(s || {}) };
                    changes.forEach((c) => {
                      if (!c?.id) return;
                      if (isRightClick) delete out[c.id];
                      else out[c.id] = { left: c.next.left ?? null, right: c.next.right ?? null };
                    });
                    return out;
                  });
                  pushHistory(changes);
                }
              }
            }
          } else if (isPTEP) {
            // PTEP MODE: Box select only the ACTIVE sub-mode dataset
            const activePtepSubMode = ptepSubModeRef.current;
            const isPtepParamMode = activePtepSubMode === 'parameter';
            const map = mapRef.current;

            if (isPtepParamMode) {
              // PARAMETER-EARTHING: MVF-style PART selection/erase
              const byId = ptepParameterByIdRef.current || {};

              if (isRightClick) {
                // Right-click drag: erase only the portion inside the box
                setPtepSelectedParameterParts((prev) => {
                  const parts = Array.isArray(prev) ? prev : [];
                  if (parts.length === 0) return parts;

                  const groups = new Map(); // key uid:lineIndex -> parts[]
                  parts.forEach((p) => {
                    const uid = String(p?.uid || '');
                    const lineIndex = Number(p?.lineIndex);
                    const a = Number(p?.startM);
                    const b = Number(p?.endM);
                    if (!uid || !Number.isFinite(lineIndex) || !Number.isFinite(a) || !Number.isFinite(b)) {
                      const k = `__raw__:${Math.random()}`;
                      groups.set(k, [p]);
                      return;
                    }
                    const k = `${uid}:${lineIndex}`;
                    if (!groups.has(k)) groups.set(k, []);
                    groups.get(k).push(p);
                  });

                  const out = [];
                  for (const [k, arr] of groups.entries()) {
                    if (k.startsWith('__raw__')) {
                      out.push(...arr);
                      continue;
                    }
                    const [uid, lineIndexStr] = k.split(':');
                    const lineIndex = Number(lineIndexStr);
                    const layer = byId[uid];
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
                        out.push({
                          ...p,
                          id: `${uid}:${lineIndex}:${a.toFixed(2)}-${b.toFixed(2)}`,
                          uid,
                          lineIndex,
                          startM: a,
                          endM: b,
                          coords,
                          meters: Math.max(0, b - a),
                        });
                      });
                    });
                  }
                  return out;
                });
              } else {
                // Left-click drag: add only the portion inside the box
                setPtepSelectedParameterParts((prev) => {
                  const parts = Array.isArray(prev) ? prev : [];
                  const toAdd = [];

                  // Covered intervals per uid:lineIndex
                  const coveredIntervalsByKey = new Map();
                  parts.forEach((p) => {
                    const uid = String(p?.uid || '');
                    const lineIndex = Number(p?.lineIndex);
                    const a = Number(p?.startM);
                    const b = Number(p?.endM);
                    if (!uid || !Number.isFinite(lineIndex) || !Number.isFinite(a) || !Number.isFinite(b)) return;
                    const lo = Math.min(a, b);
                    const hi = Math.max(a, b);
                    if (!(hi > lo)) return;
                    const key = `${uid}:${lineIndex}`;
                    if (!coveredIntervalsByKey.has(key)) coveredIntervalsByKey.set(key, []);
                    coveredIntervalsByKey.get(key).push([lo, hi]);
                  });
                  for (const [key, arr] of coveredIntervalsByKey.entries()) coveredIntervalsByKey.set(key, mergeIntervals(arr));

                  Object.keys(byId).forEach((uid) => {
                    const layer = byId[uid];
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
                      const key = `${uid}:${lineIndex}`;
                      const candidates = computeIntervalsInBox({ L, map, bounds, lineLatLngs: lineLL, minMeters: 0.5 });
                      if (!candidates.length) return;
                      let covered = coveredIntervalsByKey.get(key) || [];
                      const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                      candidates.forEach(([a, b]) => {
                        const newInts = subtractInterval([a, b], covered, 0.2);
                        if (!newInts.length) return;
                        covered = mergeIntervals([...covered, ...newInts]);
                        coveredIntervalsByKey.set(key, covered);
                        newInts.forEach(([x, y]) => {
                          const coords = sliceLineByMeters({ lineLatLngs: lineLL, cumData, startM: x, endM: y });
                          if (!coords || coords.length < 2) return;
                          toAdd.push({
                            id: `${uid}:${lineIndex}:${x.toFixed(2)}-${y.toFixed(2)}`,
                            uid,
                            lineIndex,
                            startM: x,
                            endM: y,
                            coords,
                            meters: Math.max(0, y - x),
                          });
                        });
                      });
                    });
                  });

                  return toAdd.length > 0 ? [...parts, ...toAdd] : parts;
                });
              }
            } else {
              // TABLE-TO-TABLE: keep existing whole-feature selection by bounds
              const tableToTableFeatures = ptepTableToTableByIdRef.current || {};
              const idsInBounds = [];

              const lineIntersectsBounds = (layer) => {
                if (!layer || !map) return false;
                try {
                  const layerBounds = layer.getBounds();
                  if (!layerBounds || !bounds.intersects(layerBounds)) return false;
                  let coords = null;
                  if (typeof layer.getLatLngs === 'function') {
                    coords = layer.getLatLngs();
                  }
                  if (!coords) return false;
                  while (Array.isArray(coords) && coords.length && Array.isArray(coords[0]) && !coords[0].lat) {
                    coords = coords.flat();
                  }
                  for (const ll of coords) {
                    if (ll && ll.lat != null && ll.lng != null) {
                      if (bounds.contains(ll)) return true;
                    }
                  }
                  return false;
                } catch (_e) {
                  void _e;
                  return false;
                }
              };

              Object.keys(tableToTableFeatures).forEach((uniqueId) => {
                const layer = tableToTableFeatures[uniqueId];
                if (!layer) return;
                if (lineIntersectsBounds(layer)) idsInBounds.push(uniqueId);
              });

              if (idsInBounds.length > 0) {
                setPtepCompletedTableToTable((prev) => {
                  const next = new Set(prev);
                  if (isRightClick) idsInBounds.forEach((id) => next.delete(id));
                  else idsInBounds.forEach((id) => next.add(id));
                  return next;
                });
              }
            }
          } else if (isDATP) {
            // DATP MODE: Box select trench lines (MVF-style PART selection/erase)
            const byId = datpTrenchByIdRef.current || {};
            const map = mapRef.current;

            if (isRightClick) {
              // Right-click drag: erase only the portion inside the box
              setDatpSelectedTrenchParts((prev) => {
                const parts = Array.isArray(prev) ? prev : [];
                if (parts.length === 0) return parts;

                const groups = new Map(); // key uid:lineIndex -> parts[]
                parts.forEach((p) => {
                  const uid = String(p?.uid || '');
                  const lineIndex = Number(p?.lineIndex);
                  const a = Number(p?.startM);
                  const b = Number(p?.endM);
                  if (!uid || !Number.isFinite(lineIndex) || !Number.isFinite(a) || !Number.isFinite(b)) {
                    const k = `__raw__:${Math.random()}`;
                    groups.set(k, [p]);
                    return;
                  }
                  const k = `${uid}:${lineIndex}`;
                  if (!groups.has(k)) groups.set(k, []);
                  groups.get(k).push(p);
                });

                const out = [];
                for (const [k, arr] of groups.entries()) {
                  if (k.startsWith('__raw__')) {
                    out.push(...arr);
                    continue;
                  }
                  const [uid, lineIndexStr] = k.split(':');
                  const lineIndex = Number(lineIndexStr);
                  const layer = byId[uid];
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
                      out.push({
                        ...p,
                        id: `${uid}:${lineIndex}:${a.toFixed(2)}-${b.toFixed(2)}`,
                        uid,
                        lineIndex,
                        startM: a,
                        endM: b,
                        coords,
                        meters: Math.max(0, b - a),
                      });
                    });
                  });
                }
                return out;
              });
            } else {
              // Left-click drag: add only the portion inside the box
              setDatpSelectedTrenchParts((prev) => {
                const parts = Array.isArray(prev) ? prev : [];
                const toAdd = [];

                // Covered intervals per uid:lineIndex
                const coveredIntervalsByKey = new Map();
                parts.forEach((p) => {
                  const uid = String(p?.uid || '');
                  const lineIndex = Number(p?.lineIndex);
                  const a = Number(p?.startM);
                  const b = Number(p?.endM);
                  if (!uid || !Number.isFinite(lineIndex) || !Number.isFinite(a) || !Number.isFinite(b)) return;
                  const lo = Math.min(a, b);
                  const hi = Math.max(a, b);
                  if (!(hi > lo)) return;
                  const key = `${uid}:${lineIndex}`;
                  if (!coveredIntervalsByKey.has(key)) coveredIntervalsByKey.set(key, []);
                  coveredIntervalsByKey.get(key).push([lo, hi]);
                });
                for (const [key, arr] of coveredIntervalsByKey.entries()) coveredIntervalsByKey.set(key, mergeIntervals(arr));

                Object.keys(byId).forEach((uid) => {
                  const layer = byId[uid];
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
                    const key = `${uid}:${lineIndex}`;
                    const candidates = computeIntervalsInBox({ L, map, bounds, lineLatLngs: lineLL, minMeters: 0.5 });
                    if (!candidates.length) return;
                    let covered = coveredIntervalsByKey.get(key) || [];
                    const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                    candidates.forEach(([a, b]) => {
                      const newInts = subtractInterval([a, b], covered, 0.2);
                      if (!newInts.length) return;
                      covered = mergeIntervals([...covered, ...newInts]);
                      coveredIntervalsByKey.set(key, covered);
                      newInts.forEach(([x, y]) => {
                        const coords = sliceLineByMeters({ lineLatLngs: lineLL, cumData, startM: x, endM: y });
                        if (!coords || coords.length < 2) return;
                        toAdd.push({
                          id: `${uid}:${lineIndex}:${x.toFixed(2)}-${y.toFixed(2)}`,
                          uid,
                          lineIndex,
                          startM: x,
                          endM: y,
                          coords,
                          meters: Math.max(0, y - x),
                        });
                      });
                    });
                  });
                });

                return toAdd.length > 0 ? [...parts, ...toAdd] : parts;
              });
            }
          } else if (isMVFT) {
            // MVFT MODE: Box select mv_trench lines (DATP-style PART selection/erase)
            const byId = mvftTrenchByIdRef.current || {};
            const map = mapRef.current;

            if (isRightClick) {
              // Right-click drag: erase only the portion inside the box
              setMvftSelectedTrenchParts((prev) => {
                const parts = Array.isArray(prev) ? prev : [];
                if (parts.length === 0) return parts;

                const groups = new Map(); // key uid:lineIndex -> parts[]
                parts.forEach((p) => {
                  const uid = String(p?.uid || '');
                  const lineIndex = Number(p?.lineIndex);
                  const a = Number(p?.startM);
                  const b = Number(p?.endM);
                  if (!uid || !Number.isFinite(lineIndex) || !Number.isFinite(a) || !Number.isFinite(b)) {
                    const k = `__raw__:${Math.random()}`;
                    groups.set(k, [p]);
                    return;
                  }
                  const k = `${uid}:${lineIndex}`;
                  if (!groups.has(k)) groups.set(k, []);
                  groups.get(k).push(p);
                });

                const out = [];
                for (const [k, arr] of groups.entries()) {
                  if (k.startsWith('__raw__')) {
                    out.push(...arr);
                    continue;
                  }
                  const [uid, lineIndexStr] = k.split(':');
                  const lineIndex = Number(lineIndexStr);
                  const layer = byId[uid];
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
                      out.push({
                        ...p,
                        id: `${uid}:${lineIndex}:${a.toFixed(2)}-${b.toFixed(2)}`,
                        uid,
                        lineIndex,
                        startM: a,
                        endM: b,
                        coords,
                        meters: Math.max(0, b - a),
                      });
                    });
                  });
                }
                return out;
              });
            } else {
              // Left-click drag: add only the portion inside the box
              setMvftSelectedTrenchParts((prev) => {
                const parts = Array.isArray(prev) ? prev : [];
                const toAdd = [];

                // Covered intervals per uid:lineIndex
                const coveredIntervalsByKey = new Map();
                parts.forEach((p) => {
                  const uid = String(p?.uid || '');
                  const lineIndex = Number(p?.lineIndex);
                  const a = Number(p?.startM);
                  const b = Number(p?.endM);
                  if (!uid || !Number.isFinite(lineIndex) || !Number.isFinite(a) || !Number.isFinite(b)) return;
                  const lo = Math.min(a, b);
                  const hi = Math.max(a, b);
                  if (!(hi > lo)) return;
                  const key = `${uid}:${lineIndex}`;
                  if (!coveredIntervalsByKey.has(key)) coveredIntervalsByKey.set(key, []);
                  coveredIntervalsByKey.get(key).push([lo, hi]);
                });
                for (const [key, arr] of coveredIntervalsByKey.entries()) coveredIntervalsByKey.set(key, mergeIntervals(arr));

                Object.keys(byId).forEach((uid) => {
                  const layer = byId[uid];
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
                    const key = `${uid}:${lineIndex}`;
                    const candidates = computeIntervalsInBox({ L, map, bounds, lineLatLngs: lineLL, minMeters: 0.5 });
                    if (!candidates.length) return;
                    let covered = coveredIntervalsByKey.get(key) || [];
                    const cumData = buildCumulativeMeters({ L, lineLatLngs: lineLL });
                    candidates.forEach(([a, b]) => {
                      const newInts = subtractInterval([a, b], covered, 0.2);
                      if (!newInts.length) return;
                      covered = mergeIntervals([...covered, ...newInts]);
                      coveredIntervalsByKey.set(key, covered);
                      newInts.forEach(([x, y]) => {
                        const coords = sliceLineByMeters({ lineLatLngs: lineLL, cumData, startM: x, endM: y });
                        if (!coords || coords.length < 2) return;
                        toAdd.push({
                          id: `${uid}:${lineIndex}:${x.toFixed(2)}-${y.toFixed(2)}`,
                          uid,
                          lineIndex,
                          startM: x,
                          endM: y,
                          coords,
                          meters: Math.max(0, y - x),
                        });
                      });
                    });
                  });
                });

                return toAdd.length > 0 ? [...parts, ...toAdd] : parts;
              });
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
                if (isRightClick) {
                  const committed = lvCommittedInvIdsRef.current || new Set();
                  invIdsInBounds.forEach((id) => {
                    if (!committed.has(id)) next.delete(id);
                  });
                }
                else invIdsInBounds.forEach((id) => next.add(id));
                return next;
              });
            }
          } else {
            // NORMAL MODE: Select polygons (DC)
            const map = mapRef.current;
            const directlySelectedIds = [];

            // For weighted-counter modes (e.g. MODULE_INSTALLATION_PROGRES_TRACKING),
            // bounds-only checks significantly over-select. Use a robust intersection test.
            const useStrictIntersection = !!activeMode?.workUnitWeights;

            const rectData = (() => {
              if (!useStrictIntersection || !map) return null;
              try {
                const sw = bounds.getSouthWest();
                const ne = bounds.getNorthEast();
                const nw = L.latLng(ne.lat, sw.lng);
                const se = L.latLng(sw.lat, ne.lng);
                const rectPts = [
                  map.latLngToLayerPoint(nw),
                  map.latLngToLayerPoint(ne),
                  map.latLngToLayerPoint(se),
                  map.latLngToLayerPoint(sw),
                ];
                if (rectPts.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
                const xs = rectPts.map((p) => p.x);
                const ys = rectPts.map((p) => p.y);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                const rectEdges = [
                  [rectPts[0], rectPts[1]],
                  [rectPts[1], rectPts[2]],
                  [rectPts[2], rectPts[3]],
                  [rectPts[3], rectPts[0]],
                ];
                return { rectPts, rectEdges, minX, maxX, minY, maxY };
              } catch (_e) {
                void _e;
                return null;
              }
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

            const layerIntersectsSelection = (layer) => {
              if (!useStrictIntersection || !rectData || !map || !layer) return true;

              const geomType = layer?.feature?.geometry?.type;
              // Weighted-counter modes are table-only: ignore non-polygons.
              if (geomType && geomType !== 'Polygon' && geomType !== 'MultiPolygon') return false;

              const { rectPts, rectEdges, minX, maxX, minY, maxY } = rectData;

              const collectRings = (latlngs) => {
                const out = [];
                const walk = (node) => {
                  if (!Array.isArray(node) || node.length === 0) return;
                  if (node.length && node[0] && typeof node[0].lat === 'number' && typeof node[0].lng === 'number') {
                    out.push(node);
                    return;
                  }
                  node.forEach(walk);
                };
                walk(latlngs);
                return out;
              };

              let ll = null;
              try {
                if (typeof layer.getLatLngs !== 'function') return false;
                ll = layer.getLatLngs();
              } catch (_e) {
                void _e;
                return false;
              }

              const rings = collectRings(ll);
              for (let r = 0; r < rings.length; r++) {
                const ring = rings[r];
                if (!ring || ring.length < 3) continue;
                const pts = ring.map((p) => map.latLngToLayerPoint(p)).filter(Boolean);
                if (pts.length < 3) continue;
                // drop duplicate last point if it equals first
                const a = pts[0];
                const z = pts[pts.length - 1];
                if (a && z && a.x === z.x && a.y === z.y) pts.pop();
                if (pts.length < 3) continue;

                // 1) Any polygon vertex in selection box
                if (pts.some((p) => isPointInBox(p, minX, maxX, minY, maxY))) return true;
                // 2) Any selection corner inside polygon
                if (rectPts.some((c) => isPointInPoly(c, pts))) return true;
                // 3) Any edge intersection
                for (let i = 0; i < pts.length; i++) {
                  const p1 = pts[i];
                  const p2 = pts[(i + 1) % pts.length];
                  for (let k = 0; k < rectEdges.length; k++) {
                    const [q1, q2] = rectEdges[k];
                    if (segIntersects(p1, p2, q1, q2)) return true;
                  }
                }
              }
              return false;
            };

            Object.keys(polygonById.current).forEach(polygonId => {
              const polygonInfo = polygonById.current[polygonId];
              const layer = polygonInfo?.layer;
              if (!layer || typeof layer.getBounds !== 'function') return;
              let polygonBounds = null;
              try {
                polygonBounds = layer.getBounds();
              } catch (_e) {
                void _e;
                return;
              }
              if (!polygonBounds || !bounds.intersects(polygonBounds)) return;
              if (useStrictIntersection && !layerIntersectsSelection(layer)) return;

              // LVIB: Selection box must ONLY select the currently active box type.
              // Do not allow selecting other polygons/tables.
              if (isLVIB) {
                const currentSubMode = lvibSubModeRef.current;
                if (polygonInfo?.boxType !== currentSubMode) return;
              }

              directlySelectedIds.push(polygonId);
            });

            // LVIB: Update lvibSelectedLvBoxes or lvibSelectedInvBoxes instead of selectedPolygons
            if (isLVIB && directlySelectedIds.length > 0) {
              const currentSubMode = lvibSubModeRef.current;
              const setSelected = currentSubMode === 'lvBox' ? setLvibSelectedLvBoxes : setLvibSelectedInvBoxes;
              const uniqueIds = Array.from(new Set(directlySelectedIds));
              setSelected(prev => {
                const next = new Set(prev);
                if (isRightClick) {
                  uniqueIds.forEach(id => next.delete(id));
                } else {
                  uniqueIds.forEach(id => next.add(id));
                }
                return next;
              });
            }

            // LVIB: Skip normal polygon selection for selectedPolygons.
            // IMPORTANT: do not return early here; onMouseUp must always reach the shared
            // cleanup so the selection box closes (same pattern as LV/MC4 special logic).
            if (isLVIB) {
              // no-op
            } else {

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

              // TIP: Add partner panels for each selected panel (table = 2 panels)
              if (isTIP && tipPanelPairsRef.current?.polygonPairs) {
                const partnersToAdd = new Set();
                finalSelectedIds.forEach(pid => {
                  const partner = tipPanelPairsRef.current.polygonPairs.get(pid);
                  if (partner && !finalSelectedIds.has(partner)) {
                    partnersToAdd.add(partner);
                  }
                });
                partnersToAdd.forEach(p => finalSelectedIds.add(p));
                console.log('[TIP Selection Box] directlySelectedIds:', directlySelectedIds.length, 'finalSelectedIds:', finalSelectedIds.size, 'partnersAdded:', partnersToAdd.size);
              }

              if (finalSelectedIds.size > 0) {
                setSelectedPolygons(prev => {
                  const next = new Set(prev);
                  if (isRightClick) {
                    finalSelectedIds.forEach(id => next.delete(id));
                  } else {
                    finalSelectedIds.forEach(id => next.add(id));
                  }
                  if (isTIP) console.log('[TIP Selection Box] prev.size:', prev.size, 'next.size:', next.size, 'finalSelectedIds.size:', finalSelectedIds.size);
                  return next;
                });
              }
            }
          }
        }

        try {
          boxRectRef.current.remove();
        } catch (_e) {
          void _e;
        }
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
        // PUNCH_LIST mode: Create punch instead of note
        if (!markerClickedRef.current) {
          if (isPL) {
            // In PUNCH_LIST: if click is on a table polygon, open isometric view (via polygon handler).
            // Polygon handler sets polygonClickedRef.current = true.
            // We MUST wait for the polygon handler to run (event bubbling/timing).
            setTimeout(() => {
              if (polygonClickedRef.current) {
                // Table was clicked - polygonClickHandler Handled it.
                polygonClickedRef.current = false; // Reset
                return;
              }

              // Click outside tables - create punch on general area
              // Check if contractor is selected
              const fallbackTableId = Object.values(polygonById.current || {}).find(p => {
                if (!p.layer || !p.layer._map || !p.layer.feature?.properties?.tableId) return false;
                try { return p.layer.getBounds().contains(clickLatLng); } catch (e) { return false; }
              })?.layer?.feature?.properties?.tableId;

              if (fallbackTableId) {
                setPlIsometricTableId(fallbackTableId);
                setPlIsometricOpen(true);
                return;
              }

              plCreatePunchRef.current(clickLatLng, null);
            }, 50);
          } else {
            createNote(clickLatLng);
          }
        }
      } else if (!wasDrag && !isRightClick && !noteMode) {
        // SINGLE CLICK SELECTION MODE: Select individual items by clicking
        const clickPoint = map.latLngToLayerPoint(clickLatLng);
        const clickTolerance = 10; // pixels

        // DCTT: DC_TESTING sub-mode uses string_id label clicks only (DCCT-style popup).
        // Do NOT allow table selection here.
        if (isDCTT && String(dcttSubModeRef.current || 'termination') === 'testing') {
          try {
            const pts = stringTextPointsRef.current || [];
            let best = null;
            let bestDist = Infinity;
            const hitRadius = 120; // px (keeps it reliable even with canvas labels)
            for (let i = 0; i < pts.length; i++) {
              const p = pts[i];
              if (!p) continue;
              const ll = L.latLng(p.lat, p.lng);
              const pt = map.latLngToLayerPoint(ll);
              const dx = pt.x - clickPoint.x;
              const dy = pt.y - clickPoint.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < bestDist) {
                bestDist = d;
                best = p;
              }
            }
            if (best && bestDist <= hitRadius) {
              const rawText = String(best.text || '').trim();
              const idNorm = String(best.stringId || dcttTestNormalizeId(rawText) || '');
              if (idNorm) {
                const rec = dcttTestRisoByIdRef.current?.[idNorm] || null;
                const isInCsv = rec !== null;
                const plus = rec?.plus != null ? String(rec.plus).trim() : '';
                const minus = rec?.minus != null ? String(rec.minus).trim() : '';
                const plusVal = plus || (isInCsv ? '999' : '0');
                const minusVal = minus || (isInCsv ? '999' : '0');
                const st = dcttTestNormalizeStatus(rec?.status || rec?.remarkRaw) || null;
                const displayId = dcttTestFormatDisplayId(idNorm, rec?.originalId || rawText);

                setDcttTestPopup((prev) => {
                  if (prev && prev.idNorm === idNorm) return null;
                  return {
                    idNorm,
                    displayId,
                    draftPlus: plusVal,
                    draftMinus: minusVal,
                    draftStatus: st,
                    x: e?.clientX ?? 0,
                    y: e?.clientY ?? 0,
                  };
                });
              }
            }
          } catch (_e) {
            void _e;
          }

          draggingRef.current = null;
          return;
        }

        // PUNCH_LIST: if a polygon click handler already processed this click,
        // don't run the global fallback picker (avoids double-handling and hover glitches).
        if (isPL && polygonClickedRef.current) {
          draggingRef.current = null;
          return;
        }

        // MVT: intercept clicks on our custom labels (station labels + TESTED) before any other selection logic.
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

          // MV_TESTING: make substation label clicks reliable even if canvas-label click events don't fire.
          const hitRadius = 120; // px

          // 0) Prefer cached station point hit-test (tiny list, very reliable)
          try {
            const modeNow = String(mvtSubModeRef.current || 'termination');
            if (modeNow === 'termination') {
              const stations = mvtStationPointsRef.current || [];
              let bestStation = null;
              let bestD = Infinity;
              for (let i = 0; i < stations.length; i++) {
                const s = stations[i];
                if (!s) continue;
                const pt = map.latLngToLayerPoint([s.lat, s.lng]);
                const d = Math.sqrt((pt.x - clickPoint.x) ** 2 + (pt.y - clickPoint.y) ** 2);
                if (d < hitRadius && d < bestD) { bestD = d; bestStation = s; }
              }
              if (bestStation) {
                const stationLabel = String(bestStation.stationLabel || '').trim();
                const stationNorm = mvtCanonicalTerminationStationNorm(stationLabel);
                if (stationNorm && isMvtTerminationStationNorm(stationNorm)) {
                  const max = mvtTerminationMaxForNorm(stationNorm);
                  const cur = clampMvtTerminationCount(stationNorm, mvtTerminationByStationRef.current?.[stationNorm] ?? 0);
                  const lockedNow = max > 0 && cur >= max;
                  if (!lockedNow) {
                    const x = e?.clientX ?? 0;
                    const y = e?.clientY ?? 0;
                    setMvtTermPopup({
                      stationLabel: stationLabel || stationNorm,
                      stationNorm,
                      draft: cur,
                      x,
                      y,
                    });
                    draggingRef.current = null;
                    return;
                  }
                }
              }
            }

            if (modeNow === 'testing') {
              const stations = mvtStationPointsRef.current || [];
              let bestStation = null;
              let bestD = Infinity;
              for (let i = 0; i < stations.length; i++) {
                const s = stations[i];
                if (!s) continue;
                const pt = map.latLngToLayerPoint([s.lat, s.lng]);
                const d = Math.sqrt((pt.x - clickPoint.x) ** 2 + (pt.y - clickPoint.y) ** 2);
                if (d < hitRadius && d < bestD) { bestD = d; bestStation = s; }
              }
              if (bestStation) {
                const stationLabel = String(bestStation.stationLabel || '').trim();
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
                for (const k of candKeys) {
                  if (csv[k]) { fromKey = k; break; }
                }
                if (!fromKey) {
                  const preferred = candKeys.find((k) => /^sub\d{2}$/i.test(k)) || candKeys[0] || '';
                  fromKey = preferred;
                }
                const x = e?.clientX ?? 0;
                const y = e?.clientY ?? 0;
                setMvtTestPanel(null);
                setMvtTestPopup({ stationLabel, fromKey, x, y });
                draggingRef.current = null;
                return;
              }
            }
          } catch (_e) {
            void _e;
          }

          // 1) Substation label click (MV_TESTING)
          try {
            if (String(mvtSubModeRef.current || 'termination') === 'testing') {
              const pool = stringTextLabelPoolRef.current || [];
              const active = stringTextLabelActiveCountRef.current || 0;
              let best = null;
              let bestD = Infinity;
              for (let i = 0; i < active; i++) {
                const lbl = pool[i];
                if (!lbl || !lbl._mvtStationNorm) continue;
                const d = distToLabelPx(lbl);
                if (d < hitRadius && d < bestD) { bestD = d; best = lbl; }
              }
              if (best) {
                const stationLabel = String(best._mvtStationLabel || '').trim();
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
                for (const k of candKeys) {
                  if (csv[k]) { fromKey = k; break; }
                }
                if (!fromKey) {
                  const preferred = candKeys.find((k) => /^sub\d{2}$/i.test(k)) || candKeys[0] || '';
                  fromKey = preferred;
                }
                const x = e?.clientX ?? 0;
                const y = e?.clientY ?? 0;
                setMvtTestPanel(null);
                setMvtTestPopup({ stationLabel, fromKey, x, y });
                draggingRef.current = null;
                return;
              }
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
                const max = mvtTerminationMaxForNorm(stationNorm);
                const prevVal = clampMvtTerminationCount(stationNorm, mvtTerminationByStationRef.current?.[stationNorm] ?? 0);
                const nextVal = max ? Math.min(max, prevVal + 1) : prevVal;
                if (nextVal !== prevVal) {
                  mvtTermPushHistory(stationNorm, prevVal, nextVal);
                  setMvtTerminationByStation((prev) => {
                    const base = prev && typeof prev === 'object' ? { ...prev } : {};
                    base[stationNorm] = nextVal;
                    return base;
                  });
                }
                // setMvtTermPanel removed - not defined
              } else if (stationNorm && lockedNow) {
                // setMvtTermPanel removed - not defined
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
            const currentMode = mc4SelectionModeRef.current; // null | 'mc4' | 'termination_panel' | 'termination_inv'
            if (currentMode === 'termination_inv') {
              draggingRef.current = null;
              return;
            }
            const advanceState = (cur) => {
              if (currentMode === 'mc4') {
                // MC4 mode: set to MC4 (blue), but never downgrade TERMINATED (green)
                if (cur === 'terminated') return 'terminated';
                return 'mc4';
              } else if (currentMode === 'termination_panel') {
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
            if (currentMode === 'termination_panel' && next.left === prev.left && next.right === prev.right) {
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
        } else if (isLVIB) {
          // LVIB: Single click fallback selection (ensure click works in both modes)
          // We only allow toggling boxes that match the current sub-mode.
          const currentSubMode = lvibSubModeRef.current;
          const byId = polygonById.current || {};

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
            const rings = [];
            const walk = (node) => {
              if (!Array.isArray(node) || node.length === 0) return;
              if (node[0] && typeof node[0].lat === 'number' && typeof node[0].lng === 'number') {
                rings.push(node);
                return;
              }
              node.forEach(walk);
            };
            walk(ll);
            if (!rings.length) return null;
            const ring = rings[0];
            const pts = ring.map((p) => map.latLngToLayerPoint(p)).filter(Boolean);
            if (pts.length < 3) return null;
            const a = pts[0];
            const z = pts[pts.length - 1];
            if (a && z && a.x === z.x && a.y === z.y) pts.pop();
            return pts;
          };

          let clickedId = null;
          Object.keys(byId).forEach((pid) => {
            if (clickedId) return;
            const info = byId[pid];
            if (!info?.layer) return;
            if (info?.boxType !== currentSubMode) return;
            const poly = latLngsToLayerPoints(info.layer);
            if (poly && isPointInPoly(clickPoint, poly)) clickedId = pid;
          });

          if (clickedId) {
            const setSelected = currentSubMode === 'lvBox' ? setLvibSelectedLvBoxes : setLvibSelectedInvBoxes;
            setSelected((prev) => {
              const next = new Set(prev);
              if (isRightClick) next.delete(clickedId);
              else if (next.has(clickedId)) next.delete(clickedId);
              else next.add(clickedId);
              return next;
            });

            // Ensure the rendered layer updates to green/red immediately.
            const layerRef = currentSubMode === 'lvBox' ? lvibLvBoxLayerRef : lvibInvBoxLayerRef;
            try {
              if (layerRef.current && byId[clickedId]?.layer) {
                layerRef.current.resetStyle(byId[clickedId].layer);
              }
            } catch (_e) {
              void _e;
            }
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
            setDcctPopup(null);
          }
        }
      }

      draggingRef.current = null;
    };

    container.addEventListener('mousedown', onMouseDown);
    // Mouse move/up on window so we always clean up even if the user releases outside the map.
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      container.removeEventListener('contextmenu', preventContextMenu);
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      // Safety: ensure we don't leave the map in a non-interactive state.
      try { map.dragging.enable(); } catch (_e) { void _e; }
      try {
        if (boxRectRef.current) boxRectRef.current.remove();
      } catch (_e) {
        void _e;
      }
      boxRectRef.current = null;
      draggingRef.current = null;
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

    // PTEP: dedicated SVG pane/renderer for interactive table-to-table layer.
    // Map is preferCanvas:true, so we must explicitly opt into SVG for reliable per-feature clicks.
    try {
      const paneName = 'ptepTableToTablePane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '440'; // above canvas drawings, below stringTextPane(450)
        pane.style.pointerEvents = 'auto';
      }
      ptepTableToTableSvgRendererRef.current = L.svg({ pane: paneName });
    } catch (_e) {
      void _e;
      ptepTableToTableSvgRendererRef.current = null;
    }

    // PTEP: dedicated SVG pane/renderer for interactive parameter layer.
    try {
      const paneName = 'ptepParameterPane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '435'; // below table-to-table (440)
        pane.style.pointerEvents = 'auto';
      }
      ptepParameterSvgRendererRef.current = L.svg({ pane: paneName });
    } catch (_e) {
      void _e;
      ptepParameterSvgRendererRef.current = null;
    }

    // PTEP: selected parameter parts overlay pane (always pointerEvents:none)
    try {
      const paneName = 'ptepParameterSelectedPane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '436'; // above parameter base (435), below table-to-table (440)
        pane.style.pointerEvents = 'none';
      }
    } catch (_e) {
      void _e;
    }

    // DATP: dedicated SVG pane/renderer for interactive trench layer.
    try {
      const paneName = 'datpTrenchPane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '437';
        pane.style.pointerEvents = 'none'; // Fixed: was 'auto', blocked lower layers
      }
      // Note: L.svg() might need the pane to allow events for child paths?
      // Leaflet usually handles this via 'leaflet-interactive' class on paths.
      datpSvgRendererRef.current = L.svg({ pane: paneName });
    } catch (_e) {
      void _e;
      datpSvgRendererRef.current = null;
    }

    // DATP: selected trench parts overlay pane (always pointerEvents:none)
    try {
      const paneName = 'datpTrenchSelectedPane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '438';
        pane.style.pointerEvents = 'none';
      }
    } catch (_e) {
      void _e;
    }

    // MVFT: trench lines pane (for interactive selection)
    try {
      const paneName = 'mvftTrenchPane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '439';
        pane.style.pointerEvents = 'none'; // Fixed: was 'auto', blocked lower layers
      }
      mvftSvgRendererRef.current = L.svg({ pane: paneName });
    } catch (_e) {
      mvftSvgRendererRef.current = null;
    }

    // MVFT: committed trench parts overlay pane (always pointerEvents:none)
    try {
      const paneName = 'mvftTrenchCommittedPane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '440';
        pane.style.pointerEvents = 'none';
      }
    } catch (_e) {
      void _e;
    }

    // MVFT: selected (draft) trench parts overlay pane (always pointerEvents:none)
    try {
      const paneName = 'mvftTrenchSelectedPane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '441';
        pane.style.pointerEvents = 'none';
      }
    } catch (_e) {
      void _e;
    }

    // MVFT: history highlight pane (orange overlay)
    try {
      const paneName = 'mvftHistoryHighlightPane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '442';
        pane.style.pointerEvents = 'none';
      }
    } catch (_e) {
      void _e;
    }

    // PL: Punch marker pane - pointer-events:none on container so mouse passes to tables beneath
    try {
      const paneName = 'plPunchMarkerPane';
      if (!mapRef.current.getPane(paneName)) {
        const pane = mapRef.current.createPane(paneName);
        pane.style.zIndex = '500'; // above text labels, high enough to be visible
        pane.style.pointerEvents = 'none'; // Let mouse events pass through to tables
      }
    } catch (_e) {
      void _e;
    }

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

    // MVF: history highlight layer (orange trench parts for history selection)
    try {
      if (mvfHistoryHighlightLayerRef.current) {
        mvfHistoryHighlightLayerRef.current.remove();
      }
      mvfHistoryHighlightLayerRef.current = L.layerGroup().addTo(mapRef.current);
    } catch (_e) {
      void _e;
      mvfHistoryHighlightLayerRef.current = null;
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

    // Global map click handler:
    // - DCCT: Clear test overlays when clicking empty map.
    // - MVT (testing): SS/SUB labels live in a pointerEvents:none pane, so their own click events won't fire.
    //   We open the MV testing popup via hit-testing here (only in MV testing mode), without changing panes.
    const onMapClick = (e) => {
      // DCCT behavior (unchanged)
      if (isDCCTRef.current) {
        setDcctFilter(null);
        dcctClearTestOverlays();
      }

      // MVT testing: station click -> popup
      if (!isMVTRef.current) return;
      if (String(mvtSubModeRef.current || 'termination') !== 'testing') return;
      const map = mapRef.current;
      if (!map) return;

      const stations = mvtStationPointsRef.current || [];
      if (!stations.length) return;

      const oe = e?.originalEvent;
      const x = oe?.clientX ?? 0;
      const y = oe?.clientY ?? 0;

      let clickPt = e?.containerPoint;
      if (!clickPt && oe && typeof map.mouseEventToContainerPoint === 'function') {
        try {
          clickPt = map.mouseEventToContainerPoint(oe);
        } catch (_e) {
          void _e;
          clickPt = null;
        }
      }
      if (!clickPt) return;

      let best = null;
      let bestD2 = Infinity;
      for (let i = 0; i < stations.length; i++) {
        const st = stations[i];
        if (!st) continue;
        const sp = map.latLngToContainerPoint([st.lat, st.lng]);
        const dx = sp.x - clickPt.x;
        const dy = sp.y - clickPt.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = st;
        }
      }

      const HIT_PX = 60; // generous hit radius; SS/SUB text anchor can be offset from the latlng
      if (!best || bestD2 > HIT_PX * HIT_PX) return;

      const stationLabel = String(best.stationLabel || '').trim() || String(best.stationKey || '').trim();
      const stationNorm = mvtCanonicalTerminationStationNorm(stationLabel);
      if (!stationNorm) return;
      if (stationNorm === 'css') return;

      // Resolve fromKey with SSxx/SUBxx alias support (same as label click handler).
      const csv = mvtTestCsvByFromRef.current || {};
      const normSt = normalizeId(stationLabel || stationNorm);
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
      for (const k of candKeys) {
        if (csv[k]) { fromKey = k; break; }
      }
      if (!fromKey) {
        const preferred = candKeys.find((k) => /^sub\d{2}$/i.test(k)) || candKeys[0] || '';
        fromKey = preferred;
      }

      setMvtTestPanel(null);
      setMvtTestPopup({ stationLabel: stationLabel || stationNorm, fromKey, x, y });
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
  }, [activeMode?.key, geojsonFilesOverride]);

  // LVIB: Update box styles when selection changes
  useEffect(() => {
    if (!isLVIB) return;
    if (lvibLvBoxLayerRef.current) {
      lvibLvBoxLayerRef.current.eachLayer((layer) => {
        lvibLvBoxLayerRef.current.resetStyle(layer);
      });
    }
    if (lvibInvBoxLayerRef.current) {
      lvibInvBoxLayerRef.current.eachLayer((layer) => {
        lvibInvBoxLayerRef.current.resetStyle(layer);
      });
    }
  }, [isLVIB, lvibSelectedLvBoxes, lvibSelectedInvBoxes]);

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
  // Compact neutral button (for header inline actions like Export Selected)
  // Important: don't inherit BTN_BASE fixed h-12 w-12.
  const BTN_COMPACT_NEUTRAL =
    'relative inline-flex items-center justify-center rounded-none border-2 bg-slate-800 border-slate-500 text-slate-100 shadow-[0_4px_0_rgba(0,0,0,0.50)] transition-transform active:translate-y-[2px] active:shadow-[0_2px_0_rgba(0,0,0,0.50)] hover:bg-slate-700 hover:border-slate-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 disabled:opacity-50 disabled:cursor-not-allowed';
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
    }, 0) + Array.from(mvfActiveSegmentKeys).reduce((sum, segKey) => {
      const segLen = Number(mvfSegmentLenByKeyRef.current?.[segKey]) || 0;
      return sum + segLen;
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

  // TIP: Total = 2V14 + 2V27 (from full.geojson), Completed = selected tables count
  const tipTotal = tableSmallCount + tableBigCount;
  // TIP: Count selected tables.
  // - Legacy dataset: 1 table = 2 panels  => divide by 2
  // - Single-box dataset: 1 table = 4 edges (LineStrings) => divide by 4
  const tipSingleBoxMode =
    isTIP &&
    Array.isArray(activeMode?.geojsonFiles) &&
    activeMode.geojsonFiles.some((f) => /full_plot_single_box\.geojson$/i.test(String(f?.url || '')));
  const tipCompletedTables = isTIP
    ? (tipSingleBoxMode ? Math.floor(selectedPolygons.size / 4) : Math.floor(selectedPolygons.size / 2))
    : 0;

  // MVF Total must come from CSV (already represents 3 circuits); completed comes from selected trench meters * 3.
  // DATP: use fixed total (15993 m)
  // MVFT: use total from mv_trench.geojson (calculated at load time)
  const overallTotal = isTIP ? tipTotal : (isDATP ? 15993 : (isMVFT ? mvftTotalTrenchMeters : (isMVF ? totalPlus : ((isLV || useSimpleCounters) ? totalPlus : (totalPlus + totalMinus)))));
  const completedTotal = isTIP
    ? tipCompletedTables
    : (isDATP
      ? datpCompletedTrenchMeters
      : (isMVFT
        ? mvftCompletedTrenchMeters
        : (isLV
          ? lvCompletedLength
          : (isMVF ? (mvfSelectedCableMeters + mvfCommittedCableMeters + mvfDoneCableMeters) : (completedPlus + completedMinus)))));
  const completedPct = overallTotal > 0 ? (completedTotal / overallTotal) * 100 : 0;
  const remainingPlus = Math.max(0, totalPlus - completedPlus);
  const remainingMinus = Math.max(0, totalMinus - completedMinus);
  const remainingTotal = Math.max(0, overallTotal - completedTotal);

  const simpleCounterUnit = typeof activeMode?.simpleCounterUnit === 'string' ? activeMode.simpleCounterUnit : 'm';
  const formatSimpleCounter = (value) => {
    const v = Number(value) || 0;
    return `${v.toFixed(0)}${simpleCounterUnit ? ` ${simpleCounterUnit}` : ''}`;
  };

  // MC4 counters (per string_text count; each string/table has 2 ends)
  // IMPORTANT: Must be defined before workSelectionCount/workAmount which depend on it
  const mc4Counts = useMemo(() => {
    if (!isMC4) return null;
    // Spec override: totals must show 9517 in both MC4 sub-modes.
    const totalEnds = Math.max(0, Number(activeMode?.mc4TotalEnds ?? 9517) || 0);
    // Keep for legacy/debug purposes (not used in UI total).
    const totalStrings =
      typeof mc4TotalStringsCsv === 'number' && Number.isFinite(mc4TotalStringsCsv)
        ? mc4TotalStringsCsv
        : (Number(activeMode?.mc4DefaultStrings) || 0);

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

  // DCTT counters (termination progress; same panel-end logic as MC4)
  // DCTT only has termination modes (panel side + inv side), no MC4 install mode
  const dcttCounts = useMemo(() => {
    if (!isDCTT) return null;
    // Spec override: totals must show 9517 (same as MC4)
    const totalEnds = Math.max(0, Number(activeMode?.dcttTotalEnds ?? 9517) || 0);
    const totalStrings =
      typeof dcttTotalStringsCsv === 'number' && Number.isFinite(dcttTotalStringsCsv)
        ? dcttTotalStringsCsv
        : 0;

    // Requested behavior: Panel-side counters should increment by 4 per table (masa) selection.
    // Example: 10 tables selected -> Completed shows 40.
    const terminatedTables = new Set();
    const panels = polygonById.current || {};
    Object.keys(dcttPanelStates || {}).forEach((id) => {
      const st = dcttPanelStates[id] || { left: null, right: null };
      if (st.left === DCTT_PANEL_STATES.TERMINATED || st.right === DCTT_PANEL_STATES.TERMINATED) {
        const info = panels[id];
        const key = String(info?.dedupeKey || id);
        terminatedTables.add(key);
      }
    });

    let terminatedCompleted = terminatedTables.size * 4;
    terminatedCompleted = Math.min(terminatedCompleted, totalEnds);

    return { totalStrings, totalEnds, terminatedCompleted };
  }, [isDCTT, dcttPanelStates, dcttHistoryTick, dcttTotalStringsCsv]);

  const workSelectionCount = isLV
    ? lvCompletedInvIds.size
    : (isMVF
      ? (mvfSelectedTrenchParts?.length || 0)
      : (isPTEP
        ? (ptepSubMode === 'tabletotable' ? ptepCompletedTableToTable.size : (ptepSelectedParameterParts?.length || 0))
        : (isMC4
          ? Object.keys(mc4PanelStates || {}).length
          : (activeMode?.workUnitWeights
            ? (() => {
              const seen = new Set();
              (selectedPolygons || new Set()).forEach((pid) => {
                const info = polygonById.current?.[pid];
                const key = String(info?.dedupeKey || pid);
                seen.add(key);
              });
              return seen.size;
            })()
            : selectedPolygons.size))));
  const mvtCompletedForSubmit = isMVT
    ? Math.max(
      0,
      Object.entries(mvtTerminationByStation || {}).reduce((s, [k, v]) => s + clampMvtTerminationCount(k, v), 0)
    )
    : 0;
  const lvttCompletedForSubmit = (isLVTT && String(lvttSubMode || 'termination') === 'termination')
    ? Math.max(
      0,
      Object.values(lvttTerminationByInv || {}).reduce((s, v) => s + Math.max(0, Math.min(3, Number(v) || 0)), 0)
    )
    : 0;

  // LVTT: also surface INV-side (SS/SUB) termination count in submit + history text.
  const lvttInvSideDoneForSubmit = (isLVTT && String(lvttSubMode || 'termination') === 'termination')
    ? (() => {
      try {
        const LVTT_INV_SIDE_MULTIPLIER = 3;
        const pts = stringTextPointsRef.current || [];
        const seen = new Set();
        let doneInv = 0;
        const dict = lvttTxInvMaxByTxRef.current || {};
        const subMaxInvForNorm = (subNorm) => {
          const m = String(subNorm || '').match(/^(ss|sub)(\d{2})$/i);
          if (!m) return 0;
          const tx = parseInt(m[2], 10);
          if (!Number.isFinite(tx) || tx <= 0) return 0;
          return Math.max(0, Number(dict?.[tx] ?? dict?.[String(tx)] ?? 0) || 0);
        };

        for (let i = 0; i < pts.length; i++) {
          const raw = String(pts[i]?.text || '').trim();
          if (!raw) continue;
          const subNorm = lvttCanonicalSubNorm(raw);
          if (!subNorm || seen.has(subNorm)) continue;
          seen.add(subNorm);
          const maxInv = subMaxInvForNorm(subNorm);
          if (!(maxInv > 0)) continue;
          const stored = Number(lvttSubTerminationBySubRef.current?.[subNorm] ?? 0);
          const done = Math.max(0, Math.min(maxInv, Number.isFinite(stored) ? stored : 0));
          doneInv += done;
        }
        return Math.max(0, doneInv) * LVTT_INV_SIDE_MULTIPLIER;
      } catch (_e) {
        void _e;
        return 0;
      }
    })()
    : 0;

  // For LVTT, show explicit sides (requested).
  const lvttWorkUnit = `termination panel side, ${lvttInvSideDoneForSubmit} termination inv. side`;
  // PTEP completed amounts for submit
  const ptepCompletedForSubmit = isPTEP
    ? (ptepSubMode === 'tabletotable' ? ptepCompletedTableToTable.size : ptepCompletedParameterMeters)
    : 0;
  const ptepWorkUnit = isPTEP
    ? (ptepSubMode === 'tabletotable' ? 'pcs' : 'm')
    : '';
  // DATP completed amounts for submit
  const datpCompletedForSubmit = isDATP ? datpCompletedTrenchMeters : 0;
  const datpWorkUnit = 'm';
  // MVFT completed amounts for submit
  const mvftCompletedForSubmit = isMVFT ? mvftDraftTrenchMeters : 0;
  const mvftWorkUnit = 'm';

  // Calculate NEW work amount (only uncommitted selections) for display in Submit button/modal
  const newWorkAmount = useMemo(() => {
    if (isMVF) return mvfSelectedCableMeters;
    if (isDATP) return datpCompletedForSubmit;
    if (isMVFT) return mvftCompletedForSubmit;
    if (isPTEP) return ptepCompletedForSubmit;
    if (isMC4) {
      // MC4 only has mc4 install mode now (termination moved to DCTT)
      const doneNow = mc4Counts?.mc4Completed || 0;
      const submitted = mc4SubmittedCountsRef.current || { mc4: 0 };
      const submittedNow = Number(submitted.mc4) || 0;
      return Math.max(0, (Number(doneNow) || 0) - submittedNow);
    }
    if (isDCTT) {
      // DCTT has termination modes (panel side + inv side)
      const mode = String(dcttSelectionMode || dcttSelectionModeRef.current || 'termination_panel');

      const invDoneNow = (() => {
        const byInv = dcttInvTerminationByInv || {};
        let sum = 0;
        for (const [k, v] of Object.entries(byInv)) {
          const invNorm = normalizeId(k);
          const max = Math.max(0, Number(dcttInvMaxByInvRef.current?.[invNorm] ?? 0) || 0);
          const n = Math.max(0, Number(v) || 0);
          sum += max > 0 ? Math.min(max, n) : n;
        }
        return sum;
      })();

      const doneNow = mode === 'termination_panel'
        ? (dcttCounts?.terminatedCompleted || 0)
        : invDoneNow;

      const submitted = dcttSubmittedCountsRef.current || { termination_panel: 0, termination_inv: 0 };
      const submittedNow = mode === 'termination_panel'
        ? (Number(submitted.termination_panel) || 0)
        : (Number(submitted.termination_inv) || 0);

      return Math.max(0, (Number(doneNow) || 0) - submittedNow);
    }
    if (isLV) {
      // LV: calculate only NEW (unsubmitted) inv_id selections
      const committed = lvCommittedInvIds || new Set();
      let meters = 0;
      lvCompletedInvIds.forEach((invIdNorm) => {
        const id = normalizeId(invIdNorm);
        if (committed.has(id)) return;
        const data = lengthData[id];
        if (data?.plus?.length) meters += data.plus.reduce((a, b) => a + b, 0);
      });
      return meters;
    }

    // For DC and similar modules: calculate only NEW (uncommitted) polygons
    const newPolygonIds = new Set();
    selectedPolygons.forEach((id) => {
      const committed = committedPolygonsRef.current || committedPolygons;
      if (!committed.has(id)) {
        newPolygonIds.add(id);
      }
    });

    if (isDC) {
      const stringIds = new Set();
      newPolygonIds.forEach((polygonId) => {
        const polygonInfo = polygonById.current[polygonId];
        if (polygonInfo && polygonInfo.stringId) {
          stringIds.add(normalizeId(polygonInfo.stringId));
        }
      });
      let plus = 0;
      let minus = 0;
      stringIds.forEach((stringId) => {
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
      return plus + minus;
    }

    return newPolygonIds.size;
  }, [isMVF, isDATP, isMVFT, isPTEP, isMC4, isDCTT, isLV, isDC, selectedPolygons, committedPolygons, mvfSelectedCableMeters, datpCompletedForSubmit, mvftCompletedForSubmit, ptepCompletedForSubmit, mc4Counts, dcttCounts, dcttInvTerminationByInv, dcttSelectionMode, lengthData, lvCompletedInvIds, lvCommittedInvIds]);

  const workAmount = isMVF
    ? mvfSelectedCableMeters
    : isDATP
      ? datpCompletedForSubmit
      : isMVFT
        ? mvftCompletedForSubmit
        : isPTEP
          ? ptepCompletedForSubmit
          : newWorkAmount; // Use newWorkAmount for DC and similar modules (including MC4)

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
          const total = Number(mc4Counts.totalEnds) || 0;
          const mc4Done = Number(mc4Counts.mc4Completed) || 0;
          const mc4Rem = Math.max(0, total - mc4Done);
          const mc4Pct = total > 0 ? ((mc4Done / total) * 100).toFixed(1) : '0.0';

          return (
            <div className="min-w-[620px] border-2 border-slate-700 bg-slate-900/40 py-3 px-3">
              <div className="flex flex-col gap-2">
                {/* MC4 Install row - single mode (always active) */}
                <div className="grid grid-cols-[170px_repeat(3,max-content)] items-center gap-x-3 gap-y-2">
                  <div className="text-xs font-bold text-blue-300">MC4 Install:</div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{total}</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className="text-xs font-bold text-blue-400">Done</span>
                      <span className="text-xs font-bold text-blue-400 tabular-nums">{mc4Done} ({mc4Pct}%)</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Remaining</span>
                      <span className={COUNTER_VALUE}>{mc4Rem}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    ) : null) ||
    (isDCTT && dcttCounts ? (
      <div className="flex min-w-0 items-stretch gap-3 overflow-x-auto pb-1 justify-self-start">
        {(() => {
          const total = Number(dcttCounts.totalEnds) || 0;
          const panelTermDone = Number(dcttCounts.terminatedCompleted) || 0;

          // Inv-side termination: completed count comes from inverter popup values.
          const invTotal = 9517;
          const invDone = (() => {
            const byInv = dcttInvTerminationByInv || {};
            let sum = 0;
            for (const [k, v] of Object.entries(byInv)) {
              const invNorm = normalizeId(k);
              const max = Math.max(0, Number(dcttInvMaxByInvRef.current?.[invNorm] ?? 0) || 0);
              const n = Math.max(0, Number(v) || 0);
              sum += max > 0 ? Math.min(max, n) : n;
            }
            return sum;
          })();

          const panelTermRem = Math.max(0, total - panelTermDone);
          const invRem = Math.max(0, invTotal - invDone);

          const panelTermPct = total > 0 ? ((panelTermDone / total) * 100).toFixed(1) : '0.0';
          const invPct = invTotal > 0 ? ((invDone / invTotal) * 100).toFixed(1) : '0.0';

          const mainMode = String(dcttSubMode || 'termination');
          const isTermMode = mainMode === 'termination';
          const isTestMode = mainMode === 'testing';

          const mode = String(dcttSelectionMode || 'termination_panel');
          const isPanelTermMode = mode === 'termination_panel';
          const isInvTermMode = mode === 'termination_inv';

          const panelTermDoneLabelCls = isTermMode ? COUNTER_DONE_LABEL : 'text-xs font-bold text-slate-500';
          const panelTermDoneValueCls = isTermMode ? COUNTER_DONE_VALUE : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';

          const invDoneLabelCls = isTermMode ? 'text-xs font-bold text-amber-400' : 'text-xs font-bold text-slate-500';
          const invDoneValueCls = isTermMode ? 'text-xs font-bold text-amber-400 tabular-nums whitespace-nowrap' : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';

          // DC Testing counters (DCCT-style)
          // - Passed: CSV remark PASSED
          // - Failed: CSV remark FAILED
          // - Not Tested: IDs that exist on the map (string_text) but are missing in CSV entirely
          const csvRecs = dcttTestRisoByIdRef.current || {};
          const mapIds = dcttTestMapIds || new Set();

          // Total should reflect what's on the map (string_text), not what's in CSV.
          const testTotal = mapIds.size;

          let testPassed = 0;
          let testFailed = 0;
          let testNotTested = 0;

          mapIds.forEach((id) => {
            const rec = csvRecs?.[id] || null;
            if (!rec) {
              testNotTested++;
              return;
            }
            const st = dcttTestNormalizeStatus(rec?.status || rec?.remarkRaw) || null;
            if (st === 'passed') testPassed++;
            else if (st === 'failed') testFailed++;
          });

          const testPassedPct = testTotal > 0 ? ((testPassed / testTotal) * 100).toFixed(1) : '0.0';

          const activeFilter = isTestMode ? dcttTestFilter : null;
          const filterActiveRing = 'ring-2 ring-offset-1 ring-offset-slate-900';

          const passLabelCls = isTestMode ? 'text-xs font-bold text-emerald-400' : 'text-xs font-bold text-slate-500';
          const passValueCls = isTestMode ? 'text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap' : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';
          const failLabelCls = isTestMode ? 'text-xs font-bold text-red-400' : 'text-xs font-bold text-slate-500';
          const failValueCls = isTestMode ? 'text-xs font-bold text-red-400 tabular-nums whitespace-nowrap' : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';

          return (
            <div className="min-w-[820px] border-2 border-slate-700 bg-slate-900/40 py-2 px-3">
              <div className="flex flex-col gap-1">
                {/* Cable Termination (Panel Side + Inv. Side) with a single selector centered between the two rows */}
                <div className="grid grid-cols-[24px_200px_repeat(3,max-content)] items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isTermMode) {
                        setDcttSubMode('termination');
                        setDcttTestFilter(null);
                      }
                    }}
                    className={`row-span-2 w-5 h-5 border-2 rounded flex items-center justify-center transition-colors justify-self-start self-center ${isTermMode
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-slate-500 bg-slate-800 hover:border-emerald-400'
                      }`}
                    title="Select Cable Termination Mode"
                    aria-pressed={isTermMode}
                  >
                    {isTermMode && <span className="text-xs font-bold">✓</span>}
                  </button>

                  {/* Panel Side row */}
                  <div
                    className={`text-[11px] font-bold cursor-pointer ${isTermMode && isPanelTermMode ? 'text-emerald-300' : isTermMode ? 'text-emerald-400/60' : 'text-slate-500'}`}
                    onClick={() => {
                      if (!isTermMode) setDcttSubMode('termination');
                      if (!isPanelTermMode) setDcttSelectionMode('termination_panel');
                    }}
                    title="Focus Panel Side termination"
                  >
                    Cable Termination Panel Side:
                  </div>
                  <div className={COUNTER_BOX} onClick={() => { if (!isTermMode) setDcttSubMode('termination'); if (!isPanelTermMode) setDcttSelectionMode('termination_panel'); }} role="button" tabIndex={0}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{total}</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX} onClick={() => { if (!isTermMode) setDcttSubMode('termination'); if (!isPanelTermMode) setDcttSelectionMode('termination_panel'); }} role="button" tabIndex={0}>
                    <div className={COUNTER_GRID}>
                      <span className={panelTermDoneLabelCls}>Done</span>
                      <span className={panelTermDoneValueCls}>{panelTermDone} ({panelTermPct}%)</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX} onClick={() => { if (!isTermMode) setDcttSubMode('termination'); if (!isPanelTermMode) setDcttSelectionMode('termination_panel'); }} role="button" tabIndex={0}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Remaining</span>
                      <span className={COUNTER_VALUE}>{panelTermRem}</span>
                    </div>
                  </div>

                  {/* Inv. Side row */}
                  <div
                    className={`text-[11px] font-bold cursor-pointer ${isTermMode && isInvTermMode ? 'text-amber-300' : isTermMode ? 'text-amber-400/60' : 'text-slate-500'}`}
                    onClick={() => {
                      if (!isTermMode) setDcttSubMode('termination');
                      if (!isInvTermMode) setDcttSelectionMode('termination_inv');
                    }}
                    title="Focus Inv. Side termination"
                  >
                    Cable Termination Inv. Side:
                  </div>
                  <div className={COUNTER_BOX} onClick={() => { if (!isTermMode) setDcttSubMode('termination'); if (!isInvTermMode) setDcttSelectionMode('termination_inv'); }} role="button" tabIndex={0}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{invTotal}</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX} onClick={() => { if (!isTermMode) setDcttSubMode('termination'); if (!isInvTermMode) setDcttSelectionMode('termination_inv'); }} role="button" tabIndex={0}>
                    <div className={COUNTER_GRID}>
                      <span className={invDoneLabelCls}>Done</span>
                      <span className={invDoneValueCls}>{invDone} ({invPct}%)</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX} onClick={() => { if (!isTermMode) setDcttSubMode('termination'); if (!isInvTermMode) setDcttSelectionMode('termination_inv'); }} role="button" tabIndex={0}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Remaining</span>
                      <span className={COUNTER_VALUE}>{invRem}</span>
                    </div>
                  </div>
                </div>

                {/* DC Testing row */}
                <div
                  className="grid grid-cols-[24px_200px_repeat(4,max-content)] items-center gap-x-2 gap-y-1 cursor-pointer"
                  onClick={() => {
                    if (!isTestMode) {
                      setDcttSubMode('testing');
                    }
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) {
                        setDcttSubMode('testing');
                      }
                    }}
                    className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${isTestMode
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-slate-500 bg-slate-800 hover:border-sky-400'
                      }`}
                    title="Select DC_TESTING"
                    aria-pressed={isTestMode}
                  >
                    {isTestMode && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <div className={`text-[11px] font-bold ${isTestMode ? 'text-sky-300' : 'text-sky-400/60'}`}>DC_TESTING:</div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{testTotal}</span>
                    </div>
                  </div>
                  {/* Passed (clickable filter) */}
                  <div
                    className={`${COUNTER_BOX} transition-all ${activeFilter === 'passed'
                      ? `border-emerald-500 bg-emerald-950/40 ${filterActiveRing} ring-emerald-500`
                      : 'hover:border-emerald-600'
                      }`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) setDcttSubMode('testing');
                      setDcttTestFilter(activeFilter === 'passed' ? null : 'passed');
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.stopPropagation();
                      if (!isTestMode) setDcttSubMode('testing');
                      setDcttTestFilter(activeFilter === 'passed' ? null : 'passed');
                    }}
                    aria-pressed={activeFilter === 'passed'}
                  >
                    <div className={COUNTER_GRID}>
                      <span className={`${passLabelCls} underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity`}>Passed</span>
                      <span className={passValueCls}>{testPassed} ({testPassedPct}%)</span>
                    </div>
                  </div>

                  {/* Failed (clickable filter) */}
                  <div
                    className={`${COUNTER_BOX} transition-all ${activeFilter === 'failed'
                      ? `border-red-500 bg-red-950/40 ${filterActiveRing} ring-red-500`
                      : 'hover:border-red-600'
                      }`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) setDcttSubMode('testing');
                      setDcttTestFilter(activeFilter === 'failed' ? null : 'failed');
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.stopPropagation();
                      if (!isTestMode) setDcttSubMode('testing');
                      setDcttTestFilter(activeFilter === 'failed' ? null : 'failed');
                    }}
                    aria-pressed={activeFilter === 'failed'}
                  >
                    <div className={COUNTER_GRID}>
                      <span className={`${failLabelCls} underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity`}>Failed</span>
                      <span className={failValueCls}>{testFailed}</span>
                    </div>
                  </div>

                  {/* Not Tested (clickable filter) */}
                  <div
                    className={`${COUNTER_BOX} transition-all ${activeFilter === 'not_tested'
                      ? `border-white bg-slate-700/40 ${filterActiveRing} ring-white`
                      : 'hover:border-slate-500'
                      }`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) setDcttSubMode('testing');
                      setDcttTestFilter(activeFilter === 'not_tested' ? null : 'not_tested');
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.stopPropagation();
                      if (!isTestMode) setDcttSubMode('testing');
                      setDcttTestFilter(activeFilter === 'not_tested' ? null : 'not_tested');
                    }}
                    aria-pressed={activeFilter === 'not_tested'}
                  >
                    <div className={COUNTER_GRID}>
                      <span className={`${isTestMode ? 'text-xs font-bold text-white' : 'text-xs font-bold text-slate-500'} underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity`}>Not Tested</span>
                      <span className={isTestMode ? 'text-xs font-bold text-white tabular-nums whitespace-nowrap' : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap'}>{testNotTested}</span>
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
          // MV_TESTING spec: 6 substations * 3 circuits each
          const testTotal = 18;
          const termTotal = 36; // 9 (SUB1-3) + 18 (SUB4-6) + 9 (CSS)
          const mode = String(mvtSubMode || 'termination');
          const isTermMode = mode === 'termination';
          const isTestMode = mode === 'testing';

          const termDone = Math.max(
            0,
            Object.entries(mvtTerminationByStation || {}).reduce((s, [k, v]) => s + clampMvtTerminationCount(k, v), 0)
          );
          const termRem = Math.max(0, termTotal - termDone);
          const termPct = termTotal > 0 ? ((termDone / termTotal) * 100).toFixed(1) : '0.0';

          // MV TESTING: derive passed/failed counts from loaded CSV statuses
          let passed = 0;
          let failed = 0;
          try {
            const csv = mvtTestCsvByFromRef.current || {};
            for (const row of Object.values(csv)) {
              ['L1', 'L2', 'L3'].forEach((ph) => {
                const st = String(row?.[ph]?.status || row?.[ph] || '').trim().toUpperCase();
                if (!st || st === 'N/A') return;
                if (st === 'PASS') passed += 1;
                else failed += 1;
              });
            }
          } catch (_e) {
            void _e;
          }
          const notTested = Math.max(0, testTotal - passed - failed);
          const passPct = testTotal > 0 ? ((passed / testTotal) * 100).toFixed(1) : '0.0';

          const activeFilter = isTestMode ? mvtTestFilter : null;
          const filterActiveRing = 'ring-2 ring-offset-1 ring-offset-slate-900';

          const termDoneLabelCls = isTermMode ? COUNTER_DONE_LABEL : 'text-xs font-bold text-slate-500';
          const termDoneValueCls = isTermMode ? COUNTER_DONE_VALUE : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';
          const passLabelCls = isTestMode ? 'text-xs font-bold text-emerald-400' : 'text-xs font-bold text-slate-500';
          const passValueCls = isTestMode ? 'text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap' : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';
          const failLabelCls = isTestMode ? 'text-xs font-bold text-red-400' : 'text-xs font-bold text-slate-500';
          const failValueCls = isTestMode ? 'text-xs font-bold text-red-400 tabular-nums whitespace-nowrap' : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap';

          return (
            <div className="min-w-[820px] border-2 border-slate-700 bg-slate-900/40 py-3 px-3">
              <div className="flex flex-col gap-2">
                {/* MV TERMINATION row */}
                <div
                  className="grid grid-cols-[24px_170px_repeat(3,max-content)] items-center gap-x-3 gap-y-2 cursor-pointer"
                  onClick={() => {
                    if (!isTermMode) setMvtSubMode('termination');
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTermMode) setMvtSubMode('termination');
                    }}
                    className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${isTermMode
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-slate-500 bg-slate-800 hover:border-emerald-400'
                      }`}
                    title="Select MV_TERMINATION"
                    aria-pressed={isTermMode}
                  >
                    {isTermMode && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <div className={`text-xs font-bold ${isTermMode ? 'text-emerald-300' : 'text-emerald-400/60'}`}>MV_TERMINATION:</div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{termTotal}</span>
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

                {/* MV TESTING row */}
                <div
                  className="grid grid-cols-[24px_170px_repeat(4,max-content)] items-center gap-x-3 gap-y-2 cursor-pointer"
                  onClick={() => {
                    if (!isTestMode) setMvtSubMode('testing');
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) setMvtSubMode('testing');
                    }}
                    className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${isTestMode
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-slate-500 bg-slate-800 hover:border-sky-400'
                      }`}
                    title="Select MV_TESTING"
                    aria-pressed={isTestMode}
                  >
                    {isTestMode && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <div className={`text-xs font-bold ${isTestMode ? 'text-sky-300' : 'text-sky-400/60'}`}>MV_TESTING:</div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{testTotal}</span>
                    </div>
                  </div>
                  {(() => {
                    const filterLinkBase = 'underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity';
                    return null;
                  })()}

                  {/* Passed (clickable filter) */}
                  <div
                    className={`${COUNTER_BOX} transition-all ${activeFilter === 'passed'
                      ? `border-emerald-500 bg-emerald-950/40 ${filterActiveRing} ring-emerald-500`
                      : 'hover:border-emerald-600'
                      }`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) setMvtSubMode('testing');
                      setMvtTestFilter(activeFilter === 'passed' ? null : 'passed');
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.stopPropagation();
                      if (!isTestMode) setMvtSubMode('testing');
                      setMvtTestFilter(activeFilter === 'passed' ? null : 'passed');
                    }}
                    aria-pressed={activeFilter === 'passed'}
                  >
                    <div className={COUNTER_GRID}>
                      <span className={`${passLabelCls} underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity`}>Passed</span>
                      <span className={passValueCls}>{passed} ({passPct}%)</span>
                    </div>
                  </div>

                  {/* Failed (clickable filter) */}
                  <div
                    className={`${COUNTER_BOX} transition-all ${activeFilter === 'failed'
                      ? `border-red-500 bg-red-950/40 ${filterActiveRing} ring-red-500`
                      : 'hover:border-red-600'
                      }`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) setMvtSubMode('testing');
                      setMvtTestFilter(activeFilter === 'failed' ? null : 'failed');
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.stopPropagation();
                      if (!isTestMode) setMvtSubMode('testing');
                      setMvtTestFilter(activeFilter === 'failed' ? null : 'failed');
                    }}
                    aria-pressed={activeFilter === 'failed'}
                  >
                    <div className={COUNTER_GRID}>
                      <span className={`${failLabelCls} underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity`}>Failed</span>
                      <span className={failValueCls}>{failed}</span>
                    </div>
                  </div>

                  {/* Not Tested (clickable filter) */}
                  <div
                    className={`${COUNTER_BOX} transition-all ${activeFilter === 'not_tested'
                      ? `border-slate-400 bg-slate-700/40 ${filterActiveRing} ring-slate-400`
                      : 'hover:border-slate-500'
                      }`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) setMvtSubMode('testing');
                      setMvtTestFilter(activeFilter === 'not_tested' ? null : 'not_tested');
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.stopPropagation();
                      if (!isTestMode) setMvtSubMode('testing');
                      setMvtTestFilter(activeFilter === 'not_tested' ? null : 'not_tested');
                    }}
                    aria-pressed={activeFilter === 'not_tested'}
                  >
                    <div className={COUNTER_GRID}>
                      <span className={`${isTestMode ? 'text-xs font-bold text-slate-400' : 'text-xs font-bold text-slate-500'} underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity`}>Not Tested</span>
                      <span className={isTestMode ? 'text-xs font-bold text-slate-400 tabular-nums whitespace-nowrap' : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap'}>{notTested}</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
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
          const notTested = Math.max(0, total - passed - failed);
          const mode = String(lvttSubMode || 'termination');
          const isTermMode = mode === 'termination';
          const isTestMode = mode === 'testing';

          const activeFilter = isTestMode ? lvttTestFilter : null;
          const filterActiveRing = 'ring-2 ring-offset-1 ring-offset-slate-900';

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

          // LVTT: INV-side counters come from SS/SUB progress (done/maxInv per sub).
          const subMaxInvForNorm = (subNorm) => {
            const m = String(subNorm || '').match(/^(ss|sub)(\d{2})$/i);
            if (!m) return 0;
            const tx = parseInt(m[2], 10);
            if (!Number.isFinite(tx) || tx <= 0) return 0;
            const dict = lvttTxInvMaxByTxRef.current || {};
            return Math.max(0, Number(dict?.[tx] ?? dict?.[String(tx)] ?? 0) || 0);
          };

          const invSideTotals = (() => {
            const LVTT_INV_SIDE_MULTIPLIER = 3;
            const pts = stringTextPointsRef.current || [];
            const seen = new Set();
            let totalInv = 0;
            let doneInv = 0;
            for (let i = 0; i < pts.length; i++) {
              const raw = String(pts[i]?.text || '').trim();
              if (!raw) continue;
              const subNorm = lvttCanonicalSubNorm(raw);
              if (!subNorm || seen.has(subNorm)) continue;
              seen.add(subNorm);
              const maxInv = subMaxInvForNorm(subNorm);
              if (!(maxInv > 0)) continue;
              totalInv += maxInv;
              const stored = Number(lvttSubTerminationBySubRef.current?.[subNorm] ?? 0);
              const done = Math.max(0, Math.min(maxInv, Number.isFinite(stored) ? stored : 0));
              doneInv += done;
            }
            const remInv = Math.max(0, totalInv - doneInv);

            // LVTT: Inv. Side total must be a fixed number (requested).
            const FIXED_TOTAL_INV_SIDE = 462;
            const doneScaled = doneInv * LVTT_INV_SIDE_MULTIPLIER;
            const remScaled = Math.max(0, FIXED_TOTAL_INV_SIDE - doneScaled);
            const pct = FIXED_TOTAL_INV_SIDE > 0 ? ((doneScaled / FIXED_TOTAL_INV_SIDE) * 100).toFixed(1) : '0.0';

            return {
              totalInv: FIXED_TOTAL_INV_SIDE,
              doneInv: doneScaled,
              remInv: remScaled,
              pct,
            };
          })();

          return (
            <div className="min-w-[820px] border-2 border-slate-700 bg-slate-900/40 py-2 px-3">
              <div className="flex flex-col gap-1">
                {/* LV TERMINATION (Panel Side + Inv. Side) with a single selector centered between the two rows */}
                <div className="grid grid-cols-[24px_190px_repeat(3,max-content)] items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isTermMode) {
                        setLvttSubMode('termination');
                        setLvttPopup(null);
                      }
                    }}
                    className={`row-span-2 w-5 h-5 border-2 rounded flex items-center justify-center transition-colors justify-self-start self-center ${isTermMode
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-slate-500 bg-slate-800 hover:border-emerald-400'
                      }`}
                    title="Select LV_TERMINATION"
                    aria-pressed={isTermMode}
                  >
                    {isTermMode && <span className="text-xs font-bold">✓</span>}
                  </button>

                  {/* Panel Side row */}
                  <div className={`text-[11px] font-bold ${isTermMode ? 'text-emerald-300' : 'text-emerald-400/60'}`}>LV Termination Panel Side:</div>
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

                  {/* Inv. Side row (driven by SS/SUB progress) */}
                  <div className={`text-[11px] font-bold ${isTermMode ? 'text-amber-300' : 'text-amber-400/60'}`}>LV Termination Subs. Side:</div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{invSideTotals.totalInv}</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_DONE_LABEL}>Done</span>
                      <span className={COUNTER_DONE_VALUE}>{invSideTotals.doneInv} ({invSideTotals.pct}%)</span>
                    </div>
                  </div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Remaining</span>
                      <span className={COUNTER_VALUE}>{invSideTotals.remInv}</span>
                    </div>
                  </div>
                </div>

                {/* LV TESTING row */}
                <div
                  className="grid grid-cols-[24px_190px_repeat(4,max-content)] items-center gap-x-2 gap-y-1 cursor-pointer"
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
                    className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${isTestMode
                      ? 'border-sky-500 bg-sky-500 text-white'
                      : 'border-slate-500 bg-slate-800 hover:border-sky-400'
                      }`}
                    title="Select LV_TESTING"
                    aria-pressed={isTestMode}
                  >
                    {isTestMode && <span className="text-xs font-bold">✓</span>}
                  </button>
                  <div className={`text-[11px] font-bold ${isTestMode ? 'text-sky-300' : 'text-sky-400/60'}`}>LV_TESTING:</div>
                  <div className={COUNTER_BOX}>
                    <div className={COUNTER_GRID}>
                      <span className={COUNTER_LABEL}>Total</span>
                      <span className={COUNTER_VALUE}>{total}</span>
                    </div>
                  </div>
                  {/* Passed (clickable filter) */}
                  <div
                    className={`${COUNTER_BOX} transition-all ${activeFilter === 'passed'
                      ? `border-emerald-500 bg-emerald-950/40 ${filterActiveRing} ring-emerald-500`
                      : 'hover:border-emerald-600'
                      }`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) {
                        setLvttSubMode('testing');
                        setLvttPopup(null);
                      }
                      setLvttTestFilter(activeFilter === 'passed' ? null : 'passed');
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.stopPropagation();
                      if (!isTestMode) {
                        setLvttSubMode('testing');
                        setLvttPopup(null);
                      }
                      setLvttTestFilter(activeFilter === 'passed' ? null : 'passed');
                    }}
                    aria-pressed={activeFilter === 'passed'}
                  >
                    <div className={COUNTER_GRID}>
                      <span className={`${passLabelCls} underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity`}>Passed</span>
                      <span className={passValueCls}>{passed} ({passPct}%)</span>
                    </div>
                  </div>

                  {/* Failed (clickable filter) */}
                  <div
                    className={`${COUNTER_BOX} transition-all ${activeFilter === 'failed'
                      ? `border-red-500 bg-red-950/40 ${filterActiveRing} ring-red-500`
                      : 'hover:border-red-600'
                      }`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) {
                        setLvttSubMode('testing');
                        setLvttPopup(null);
                      }
                      setLvttTestFilter(activeFilter === 'failed' ? null : 'failed');
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.stopPropagation();
                      if (!isTestMode) {
                        setLvttSubMode('testing');
                        setLvttPopup(null);
                      }
                      setLvttTestFilter(activeFilter === 'failed' ? null : 'failed');
                    }}
                    aria-pressed={activeFilter === 'failed'}
                  >
                    <div className={COUNTER_GRID}>
                      <span className={`${failLabelCls} underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity`}>Failed</span>
                      <span className={failValueCls}>{failed}</span>
                    </div>
                  </div>

                  {/* Not Tested (clickable filter) */}
                  <div
                    className={`${COUNTER_BOX} transition-all ${activeFilter === 'not_tested'
                      ? `border-slate-400 bg-slate-700/40 ${filterActiveRing} ring-slate-400`
                      : 'hover:border-slate-500'
                      }`}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTestMode) {
                        setLvttSubMode('testing');
                        setLvttPopup(null);
                      }
                      setLvttTestFilter(activeFilter === 'not_tested' ? null : 'not_tested');
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.stopPropagation();
                      if (!isTestMode) {
                        setLvttSubMode('testing');
                        setLvttPopup(null);
                      }
                      setLvttTestFilter(activeFilter === 'not_tested' ? null : 'not_tested');
                    }}
                    aria-pressed={activeFilter === 'not_tested'}
                  >
                    <div className={COUNTER_GRID}>
                      <span className={`${isTestMode ? 'text-xs font-bold text-slate-400' : 'text-xs font-bold text-slate-500'} underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity`}>Not Tested</span>
                      <span className={isTestMode ? 'text-xs font-bold text-slate-400 tabular-nums whitespace-nowrap' : 'text-xs font-bold text-slate-500 tabular-nums whitespace-nowrap'}>{notTested}</span>
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
                className={`min-w-[120px] border-2 py-3 px-3 transition-all ${activeFilter === 'passed'
                  ? 'border-emerald-500 bg-emerald-950/40 ' + filterActiveRing + ' ring-emerald-500'
                  : 'border-slate-700 bg-slate-800 hover:border-emerald-600'
                  }`}
                role="button"
                tabIndex={0}
                onClick={() => setDcctFilter(activeFilter === 'passed' ? null : 'passed')}
                onKeyDown={(e) => e.key === 'Enter' && setDcctFilter(activeFilter === 'passed' ? null : 'passed')}
                aria-pressed={activeFilter === 'passed'}
              >
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                  <span
                    className={`text-xs font-bold text-emerald-400 ${filterLinkBase}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDcctFilter(activeFilter === 'passed' ? null : 'passed');
                    }}
                    role="presentation"
                    tabIndex={-1}
                  >
                    Passed
                  </span>
                  <span className="text-xs font-bold text-emerald-400 tabular-nums">{passedCount}</span>
                </div>
              </div>

              {/* Failed Counter - Clickable */}
              <div
                className={`min-w-[120px] border-2 py-3 px-3 transition-all ${activeFilter === 'failed'
                  ? 'border-red-500 bg-red-950/40 ' + filterActiveRing + ' ring-red-500'
                  : 'border-slate-700 bg-slate-800 hover:border-red-600'
                  }`}
                role="button"
                tabIndex={0}
                onClick={() => setDcctFilter(activeFilter === 'failed' ? null : 'failed')}
                onKeyDown={(e) => e.key === 'Enter' && setDcctFilter(activeFilter === 'failed' ? null : 'failed')}
                aria-pressed={activeFilter === 'failed'}
              >
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                  <span
                    className={`text-xs font-bold text-red-400 ${filterLinkBase}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDcctFilter(activeFilter === 'failed' ? null : 'failed');
                    }}
                    role="presentation"
                    tabIndex={-1}
                  >
                    Failed
                  </span>
                  <span className="text-xs font-bold text-red-400 tabular-nums">{failedCount}</span>
                </div>
              </div>

              {/* Not Tested Counter - Clickable */}
              <div
                className={`min-w-[140px] border-2 py-3 px-3 transition-all ${activeFilter === 'not_tested'
                  ? 'border-white bg-slate-700/40 ' + filterActiveRing + ' ring-white'
                  : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                  }`}
                role="button"
                tabIndex={0}
                onClick={() => setDcctFilter(activeFilter === 'not_tested' ? null : 'not_tested')}
                onKeyDown={(e) => e.key === 'Enter' && setDcctFilter(activeFilter === 'not_tested' ? null : 'not_tested')}
                aria-pressed={activeFilter === 'not_tested'}
              >
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                  <span
                    className={`text-xs font-bold text-white ${filterLinkBase}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDcctFilter(activeFilter === 'not_tested' ? null : 'not_tested');
                    }}
                    role="presentation"
                    tabIndex={-1}
                  >
                    Not Tested
                  </span>
                  <span className="text-xs font-bold text-white tabular-nums">{notTestedCount}</span>
                </div>
              </div>

            </div>
          );
        })()}
      </div>
    ) : null) ||
    (isPL ? (
      <div className="flex min-w-0 items-stretch gap-3 overflow-x-auto pb-1 justify-self-start">
        {(() => {
          const total = plPunches.length;
          const completed = plPunches.filter(p => p.completed).length;
          const remaining = Math.max(0, total - completed);
          const completedPct = total > 0 ? ((completed / total) * 100).toFixed(1) : '0.0';

          return (
            <div className="flex items-center gap-3">
              {/* Total Counter */}
              <div className="min-w-[120px] border-2 border-slate-700 bg-slate-800 py-3 px-3">
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                  <span className="text-xs font-bold text-slate-200">Total</span>
                  <span className="text-xs font-bold text-slate-200 tabular-nums">{total}</span>
                </div>
              </div>

              {/* Completed Counter */}
              <div className="min-w-[160px] border-2 border-emerald-700/50 bg-emerald-900/20 py-3 px-3">
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                  <span className="text-xs font-bold text-emerald-400">Completed</span>
                  <span className="text-xs font-bold text-emerald-400 tabular-nums">{completed} ({completedPct}%)</span>
                </div>
              </div>

              {/* Remaining Counter */}
              <div className="min-w-[120px] border-2 border-slate-700 bg-slate-800 py-3 px-3">
                <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                  <span className="text-xs font-bold text-amber-400">Remaining</span>
                  <span className="text-xs font-bold text-amber-400 tabular-nums">{remaining}</span>
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
      <div ref={headerBarRef} className="sticky top-0 left-0 z-[1100] w-full min-h-[92px] border-b-2 border-slate-700 bg-slate-900 px-4 py-0 sm:px-6 relative flex items-center">
        {/* Punch List Dropdown - Absolute Center */}
        {isPL && (
          <div className="absolute left-1/2 top-1/2 -translate-y-1/2 -translate-x-1/2 z-[1200]">
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setPlListDropdownOpen(!plListDropdownOpen); }}
                className="flex items-center gap-2 bg-slate-800 border-2 border-slate-600 px-3 py-1.5 text-white hover:border-amber-400 min-w-[160px] justify-between transition-colors shadow-lg rounded"
                title="Switch Punch List"
              >
                <div className="flex flex-col items-start leading-none gap-0.5">
                  <span className="text-[9px] text-slate-400 uppercase tracking-widest">Active List</span>
                  <span className="truncate max-w-[140px] text-xs font-bold text-amber-50">{plLists.find(l => l.id === plActiveListId)?.name || 'Loading...'}</span>
                </div>
                <span className="text-[10px] text-slate-400 ml-1">▼</span>
              </button>

              {plListDropdownOpen && (
                <div
                  className="absolute top-[calc(100%+4px)] left-0 min-w-[200px] bg-slate-900 border-2 border-slate-600 shadow-2xl flex flex-col z-[2000] rounded-sm overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="bg-slate-950/50 px-3 py-2 text-[9px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-800">
                    My Lists
                  </div>
                  <div className="max-h-[250px] overflow-y-auto">
                    {plLists.map(l => (
                      <div
                        key={l.id}
                        className={`relative px-3 py-2.5 border-b border-slate-800 hover:bg-slate-800/80 cursor-pointer text-xs flex items-center justify-between group ${l.id === plActiveListId ? 'text-amber-400 font-bold bg-slate-800/50' : 'text-slate-300'}`}
                      >
                        {/* List name - clickable to switch */}
                        <span
                          onClick={() => plSwitchList(l.id)}
                          className="flex-1 truncate mr-2"
                        >
                          {l.name}
                        </span>

                        {/* Checkmark for active + Edit button */}
                        <div className="flex items-center gap-1.5">
                          {l.id === plActiveListId && <span className="text-amber-400">✓</span>}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPlEditingListId(plEditingListId === l.id ? null : l.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 hover:bg-slate-700 p-1 rounded text-[10px] transition-all"
                            title="Düzenle"
                          >
                            ✏️
                          </button>
                        </div>

                        {/* Edit Mini-Menu */}
                        {plEditingListId === l.id && (
                          <div
                            className="absolute right-0 top-full z-[2100] bg-slate-800 border border-slate-600 shadow-xl rounded overflow-hidden min-w-[120px]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => plRenameList(l.id)}
                              className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 flex items-center gap-2"
                            >
                              <span>📝</span>
                              <span>Yeniden Adlandır</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => plDeleteList(l.id)}
                              className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-900/50 flex items-center gap-2 border-t border-slate-700"
                            >
                              <span>🗑️</span>
                              <span>Sil</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="bg-slate-900 p-1.5">
                    <button
                      onClick={plCreateNewList}
                      className="w-full text-center px-3 py-1.5 bg-emerald-700/20 hover:bg-emerald-700/40 text-emerald-400 hover:text-emerald-200 border border-emerald-800/50 hover:border-emerald-500/50 font-bold text-[10px] uppercase tracking-wider rounded transition-all"
                    >
                      + New List
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="w-full">
          <div className="grid grid-cols-[1fr_auto] items-center gap-1">
            {/* Counters (left) */}
            {showCounters ? (
              effectiveCustomCounters ? (
                effectiveCustomCounters
              ) : (
                <div className={`flex min-w-0 gap-3 overflow-x-auto pb-1 justify-self-start ${isLVIB ? 'flex-col items-start gap-1' : 'items-center'}`}>
                  {useSimpleCounters ? (
                    <>
                      {/* LVIB: LV Box / INV Box counters with checkbox toggle (MC4 style) */}
                      {isLVIB ? (
                        <div className="flex flex-col gap-2">
                          {(() => {
                            // Match DC cable pulling counters typography + spacing
                            // - smaller padding
                            // - same label/value fonts
                            // Also reduce label-to-counters gap by shrinking label column and gap-x.
                            const ROW = 'grid grid-cols-[24px_140px_repeat(3,max-content)] items-center gap-x-2 gap-y-2 cursor-pointer';

                            const lvDone = lvibSelectedLvBoxes.size;
                            const lvPct = lvibLvBoxTotal > 0 ? ((lvDone / lvibLvBoxTotal) * 100).toFixed(1) : '0.0';
                            const lvRem = Math.max(0, lvibLvBoxTotal - lvDone);

                            const invDone = lvibSelectedInvBoxes.size;
                            const invPct = lvibInvBoxTotal > 0 ? ((invDone / lvibInvBoxTotal) * 100).toFixed(1) : '0.0';
                            const invRem = Math.max(0, lvibInvBoxTotal - invDone);

                            const checkboxBase = 'w-5 h-5 border-2 rounded flex items-center justify-center transition-colors';

                            return (
                              <>
                                {/* LV Box row */}
                                <div
                                  className={ROW}
                                  onClick={() => {
                                    if (lvibSubMode !== 'lvBox') setLvibSubMode('lvBox');
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (lvibSubMode !== 'lvBox') setLvibSubMode('lvBox');
                                    }}
                                    className={`${checkboxBase} ${lvibSubMode === 'lvBox'
                                      ? 'border-slate-200 bg-slate-200 text-slate-900'
                                      : 'border-slate-500 bg-slate-800 hover:border-slate-200'
                                      }`}
                                    title="Select LV Box"
                                    aria-pressed={lvibSubMode === 'lvBox'}
                                  >
                                    {lvibSubMode === 'lvBox' && <span className="text-xs font-bold">✓</span>}
                                  </button>
                                  <div className={`text-xs font-bold ${lvibSubMode === 'lvBox' ? 'text-white' : 'text-slate-500'}`}>LV Box:</div>
                                  <div className={COUNTER_BOX}>
                                    <div className={COUNTER_GRID}>
                                      <span className={COUNTER_LABEL}>Total</span>
                                      <span className={COUNTER_VALUE}>{lvibLvBoxTotal}</span>
                                    </div>
                                  </div>
                                  <div className={COUNTER_BOX}>
                                    <div className={COUNTER_GRID}>
                                      <span className={COUNTER_LABEL}>Done</span>
                                      <span className={COUNTER_VALUE}>{lvDone} ({lvPct}%)</span>
                                    </div>
                                  </div>
                                  <div className={COUNTER_BOX}>
                                    <div className={COUNTER_GRID}>
                                      <span className={COUNTER_LABEL}>Remaining</span>
                                      <span className={COUNTER_VALUE}>{lvRem}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* INV Box row */}
                                <div
                                  className={ROW}
                                  onClick={() => {
                                    if (lvibSubMode !== 'invBox') setLvibSubMode('invBox');
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (lvibSubMode !== 'invBox') setLvibSubMode('invBox');
                                    }}
                                    className={`${checkboxBase} ${lvibSubMode === 'invBox'
                                      ? 'border-slate-200 bg-slate-200 text-slate-900'
                                      : 'border-slate-500 bg-slate-800 hover:border-slate-200'
                                      }`}
                                    title="Select INV Box"
                                    aria-pressed={lvibSubMode === 'invBox'}
                                  >
                                    {lvibSubMode === 'invBox' && <span className="text-xs font-bold">✓</span>}
                                  </button>
                                  <div className={`text-xs font-bold ${lvibSubMode === 'invBox' ? 'text-white' : 'text-slate-500'}`}>INV Box:</div>
                                  <div className={COUNTER_BOX}>
                                    <div className={COUNTER_GRID}>
                                      <span className={COUNTER_LABEL}>Total</span>
                                      <span className={COUNTER_VALUE}>{lvibInvBoxTotal}</span>
                                    </div>
                                  </div>
                                  <div className={COUNTER_BOX}>
                                    <div className={COUNTER_GRID}>
                                      <span className={COUNTER_LABEL}>Done</span>
                                      <span className={COUNTER_VALUE}>{invDone} ({invPct}%)</span>
                                    </div>
                                  </div>
                                  <div className={COUNTER_BOX}>
                                    <div className={COUNTER_GRID}>
                                      <span className={COUNTER_LABEL}>Remaining</span>
                                      <span className={COUNTER_VALUE}>{invRem}</span>
                                    </div>
                                  </div>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      ) : isTIP ? (
                        <>
                          {/* Right group: Total / Completed / Remaining */}
                          <div className="flex items-center gap-3 self-center">
                            <div className="min-w-[120px] border-2 border-slate-700 bg-slate-800 py-3 px-3">
                              <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                                <span className="text-xs font-bold text-slate-200">Total</span>
                                <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{tipTotal}</span>
                              </div>
                            </div>

                            <div className="min-w-[180px] border-2 border-slate-700 bg-slate-800 py-3 px-3">
                              <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                                <span className="text-xs font-bold text-emerald-400">Completed</span>
                                <span className="text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap">
                                  {tipCompletedTables}, {completedPct.toFixed(2)}%
                                </span>
                              </div>
                            </div>

                            <div className="min-w-[140px] border-2 border-slate-700 bg-slate-800 py-3 px-3">
                              <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4">
                                <span className="text-xs font-bold text-slate-200">Remaining</span>
                                <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{remainingTotal}</span>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : isPTEP ? (
                        <>
                          {/* PTEP: MC4-style sub-mode selector with counters */}
                          {(() => {
                            const isTTMode = ptepSubMode === 'tabletotable';
                            const isParamMode = ptepSubMode === 'parameter';
                            const ttTotal = ptepTotalTableToTable;
                            const ttDone = ptepCompletedTableToTable.size;
                            const ttRem = Math.max(0, ttTotal - ttDone);
                            const ttPct = ttTotal > 0 ? ((ttDone / ttTotal) * 100).toFixed(2) : '0.00';
                            const paramTotal = ptepTotalParameterMeters;
                            const paramDone = ptepCompletedParameterMeters;
                            const paramRem = Math.max(0, paramTotal - paramDone);
                            const paramPct = paramTotal > 0 ? ((paramDone / paramTotal) * 100).toFixed(2) : '0.00';
                            // Fixed-width counter box style for alignment
                            const PTEP_COUNTER_BOX = 'w-[160px] border-2 border-slate-700 bg-slate-800 py-2 px-3';
                            return (
                              <div className="min-w-[900px] border-2 border-slate-700 bg-slate-900/40 py-3 px-3">
                                <div className="flex flex-col gap-2">
                                  {/* Table-to-Table row */}
                                  <div
                                    className="grid grid-cols-[24px_180px_160px_160px_160px] items-center gap-x-3 cursor-pointer"
                                    onClick={() => {
                                      if (!isTTMode) {
                                        ptepSubModeRef.current = 'tabletotable';
                                        setPtepSubMode('tabletotable');
                                        try {
                                          const map = mapRef.current;
                                          if (map) {
                                            const ttPane = map.getPane('ptepTableToTablePane');
                                            const paramPane = map.getPane('ptepParameterPane');
                                            if (ttPane) ttPane.style.pointerEvents = 'auto';
                                            if (paramPane) paramPane.style.pointerEvents = 'none';
                                          }
                                        } catch (_e) {
                                          void _e;
                                        }
                                      }
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isTTMode) {
                                          ptepSubModeRef.current = 'tabletotable';
                                          setPtepSubMode('tabletotable');
                                          try {
                                            const map = mapRef.current;
                                            if (map) {
                                              const ttPane = map.getPane('ptepTableToTablePane');
                                              const paramPane = map.getPane('ptepParameterPane');
                                              if (ttPane) ttPane.style.pointerEvents = 'auto';
                                              if (paramPane) paramPane.style.pointerEvents = 'none';
                                            }
                                          } catch (_e) {
                                            void _e;
                                          }
                                        }
                                      }}
                                      className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${isTTMode
                                        ? 'border-white bg-white text-slate-900'
                                        : 'border-slate-500 bg-slate-800 hover:border-white'
                                        }`}
                                      title="Select Table-to-Table mode"
                                    >
                                      {isTTMode && <span className="text-xs font-bold">✓</span>}
                                    </button>
                                    <div className={`text-xs font-bold ${isTTMode ? 'text-white' : 'text-slate-500'}`}>Table-to-Table:</div>
                                    <div className={PTEP_COUNTER_BOX}>
                                      <div className="flex justify-between items-center">
                                        <span className={COUNTER_LABEL}>Total</span>
                                        <span className={COUNTER_VALUE}>{ttTotal}</span>
                                      </div>
                                    </div>
                                    <div className={PTEP_COUNTER_BOX}>
                                      <div className="flex justify-between items-center">
                                        <span className={isTTMode ? 'text-xs font-bold text-emerald-400' : 'text-xs font-bold text-slate-500'}>Completed</span>
                                        <span className={isTTMode ? 'text-xs font-bold text-emerald-400 tabular-nums' : 'text-xs font-bold text-slate-500 tabular-nums'}>{ttDone}</span>
                                      </div>
                                    </div>
                                    <div className={PTEP_COUNTER_BOX}>
                                      <div className="flex justify-between items-center">
                                        <span className={COUNTER_LABEL}>Remaining</span>
                                        <span className={COUNTER_VALUE}>{ttRem}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Parameter-Earthing row */}
                                  <div
                                    className="grid grid-cols-[24px_180px_160px_160px_160px] items-center gap-x-3 cursor-pointer"
                                    onClick={() => {
                                      if (!isParamMode) {
                                        ptepSubModeRef.current = 'parameter';
                                        setPtepSubMode('parameter');
                                        try {
                                          const map = mapRef.current;
                                          if (map) {
                                            const ttPane = map.getPane('ptepTableToTablePane');
                                            const paramPane = map.getPane('ptepParameterPane');
                                            if (ttPane) ttPane.style.pointerEvents = 'none';
                                            if (paramPane) paramPane.style.pointerEvents = 'auto';
                                          }
                                        } catch (_e) {
                                          void _e;
                                        }
                                      }
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isParamMode) {
                                          ptepSubModeRef.current = 'parameter';
                                          setPtepSubMode('parameter');
                                          try {
                                            const map = mapRef.current;
                                            if (map) {
                                              const ttPane = map.getPane('ptepTableToTablePane');
                                              const paramPane = map.getPane('ptepParameterPane');
                                              if (ttPane) ttPane.style.pointerEvents = 'none';
                                              if (paramPane) paramPane.style.pointerEvents = 'auto';
                                            }
                                          } catch (_e) {
                                            void _e;
                                          }
                                        }
                                      }}
                                      className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-colors ${isParamMode
                                        ? 'border-amber-400 bg-amber-400 text-slate-900'
                                        : 'border-slate-500 bg-slate-800 hover:border-amber-400'
                                        }`}
                                      title="Select Parameter-Earthing mode"
                                    >
                                      {isParamMode && <span className="text-xs font-bold">✓</span>}
                                    </button>
                                    <div className={`text-xs font-bold ${isParamMode ? 'text-amber-400' : 'text-slate-500'}`}>Parameter-Earthing:</div>
                                    <div className={PTEP_COUNTER_BOX}>
                                      <div className="flex justify-between items-center">
                                        <span className={COUNTER_LABEL}>Total</span>
                                        <span className={COUNTER_VALUE}>{paramTotal.toFixed(0)} m</span>
                                      </div>
                                    </div>
                                    <div className={PTEP_COUNTER_BOX}>
                                      <div className="flex justify-between items-center">
                                        <span className={isParamMode ? 'text-xs font-bold text-emerald-400' : 'text-xs font-bold text-slate-500'}>Completed</span>
                                        <span className={isParamMode ? 'text-xs font-bold text-emerald-400 tabular-nums' : 'text-xs font-bold text-slate-500 tabular-nums'}>{paramDone.toFixed(0)} m</span>
                                      </div>
                                    </div>
                                    <div className={PTEP_COUNTER_BOX}>
                                      <div className="flex justify-between items-center">
                                        <span className={COUNTER_LABEL}>Remaining</span>
                                        <span className={COUNTER_VALUE}>{paramRem.toFixed(0)} m</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </>
                      ) : (
                        <>
                          {/* Non-TIP simple counters */}
                          <div className="min-w-[180px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                            <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                              <span className="text-xs font-bold text-slate-200">Total</span>
                              <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{formatSimpleCounter(overallTotal)}</span>
                            </div>
                          </div>

                          <div className="min-w-[220px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                            <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                              <span className="text-xs font-bold text-emerald-400">Completed</span>
                              <span className="text-xs font-bold text-emerald-400 tabular-nums whitespace-nowrap">
                                {formatSimpleCounter(completedTotal)}, {completedPct.toFixed(2)}%
                              </span>
                            </div>
                          </div>

                          <div className="min-w-[180px] border-2 border-slate-700 bg-slate-800 py-3 px-2">
                            <div className="grid w-full grid-cols-[max-content_max-content] items-center justify-between gap-x-4 gap-y-2">
                              <span className="text-xs font-bold text-slate-200">Remaining</span>
                              <span className="text-xs font-bold text-slate-200 tabular-nums whitespace-nowrap">{formatSimpleCounter(remainingTotal)}</span>
                            </div>
                          </div>
                        </>
                      )}
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
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              )}

              {/* Filter Export Buttons (MVT/DCCT testing filter) */}
              {isMVT && String(mvtSubMode || 'termination') === 'testing' && mvtTestFilter ? (
                <button
                  type="button"
                  onClick={mvtExportFilteredTestResultsCsv}
                  disabled={mvtTestResultsDirty}
                  className={`${BTN_COMPACT_NEUTRAL} w-auto h-6 px-2 py-0 leading-none text-[10px] font-medium whitespace-nowrap`}
                  title={mvtTestResultsDirty ? 'Submit first, then export selected' : 'Export selected test results (CSV)'}
                  aria-label="Export Selected MV Test Results"
                >
                  Export {mvtTestFilter === 'passed' ? 'Passed' : mvtTestFilter === 'failed' ? 'Failed' : 'Not Tested'}
                </button>
              ) : null}
              {isDCCT && dcctFilter ? (
                <button
                  type="button"
                  onClick={dcctExportFilteredTestResultsCsv}
                  disabled={dcctTestResultsDirty}
                  className={`${BTN_COMPACT_NEUTRAL} w-auto h-6 px-2 py-0 leading-none text-[10px] font-medium whitespace-nowrap`}
                  title={dcctTestResultsDirty ? 'Submit first, then export selected' : 'Export selected test results (CSV)'}
                  aria-label="Export Selected Test Results"
                >
                  Export {dcctFilter === 'passed' ? 'Passed' : dcctFilter === 'failed' ? 'Failed' : 'Not Tested'}
                </button>
              ) : null}

              {/* Filter Export Button (LVTT testing filter) */}
              {isLVTT && String(lvttSubMode || 'termination') === 'testing' && lvttTestFilter ? (
                <button
                  type="button"
                  onClick={lvttExportFilteredTestResultsCsv}
                  disabled={lvttTestResultsDirty}
                  className={`${BTN_COMPACT_NEUTRAL} w-auto h-6 px-2 py-0 leading-none text-[10px] font-medium whitespace-nowrap`}
                  title={lvttTestResultsDirty ? 'Submit first, then export selected' : 'Export selected test results (CSV)'}
                  aria-label="Export Selected LV Test Results"
                >
                  Export {lvttTestFilter === 'passed' ? 'Passed' : lvttTestFilter === 'failed' ? 'Failed' : 'Not Tested'}
                </button>
              ) : null}

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

              {isDCCT ? (
                <>
                  <button
                    onClick={dcctSubmitTestResults}
                    disabled={noteMode || !dcctTestResultsDirty}
                    className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                    title={dcctTestResultsDirty ? 'Submit (save) DC test results' : 'No changes to submit'}
                    aria-label="Submit Test Results"
                  >
                    Submit
                  </button>

                  <input
                    ref={dcctTestImportFileInputRef}
                    type="file"
                    accept=".csv"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target?.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = () => {
                          const text = String(reader.result || '');
                          dcctImportTestResultsFromText(text, 'import');
                        };
                        reader.readAsText(file);
                      }
                      if (e.target) e.target.value = '';
                    }}
                  />
                  <button
                    onClick={() => dcctTestImportFileInputRef.current?.click()}
                    className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                    title="Import Test Results (CSV)"
                    aria-label="Import Test Results"
                  >
                    Import Test Results
                  </button>
                  <button
                    onClick={dcctExportTestResultsCsv}
                    className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                    title={dcctTestResultsDirty ? 'Submit first, then export' : 'Export submitted test results (CSV)'}
                    aria-label="Export Test Results"
                  >
                    Export Test Results
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      // Punch List: open PL-specific submit modal
                      if (isPL) {
                        setPlShowSubmitModal(true);
                        return;
                      }
                      if (isMVT && String(mvtSubMode || 'termination') === 'testing') {
                        mvtSubmitTestResults();
                        return;
                      }
                      if (isLVTT && String(lvttSubMode || 'termination') === 'testing') {
                        lvttSubmitTestResults();
                        return;
                      }
                      if (isDCTT && String(dcttSubMode || 'termination') === 'testing') {
                        dcttTestSubmitResults();
                        return;
                      }
                      setModalOpen(true);
                    }}
                    disabled={
                      isPL
                        ? false // PL Submit is always enabled
                        : (isDCTT && String(dcttSubMode || 'termination') === 'testing')
                          ? (noteMode || !dcttTestResultsDirty)
                          : (
                            noteMode ||
                            (isMVT && String(mvtSubMode || 'termination') === 'testing'
                              ? !mvtTestResultsDirty
                              : false) ||
                            (isLVTT && String(lvttSubMode || 'termination') === 'testing'
                              ? !lvttTestResultsDirty
                              : false) ||
                            (isMC4 && !mc4SelectionMode) ||
                            (isDCTT && String(dcttSubMode || 'termination') !== 'testing' && !dcttSelectionMode) ||
                            (isDCTT && String(dcttSubMode || 'termination') !== 'testing'
                              ? (dcttSelectionMode === 'termination_panel'
                                ? (dcttCounts?.terminatedCompleted || 0) === 0
                                : Object.keys(dcttInvTerminationByInv || {}).filter((k) => Number(dcttInvTerminationByInv[k]) > 0).length === 0)
                              : (isMVF
                                ? (mvfSelectedTrenchParts.length === 0 && mvfActiveSegmentKeys.size === 0)
                                : (isDATP
                                  ? datpCompletedForSubmit === 0
                                  : (isMVFT
                                    ? mvftCompletedForSubmit === 0
                                    : isPTEP
                                      ? (ptepSubMode === 'tabletotable'
                                        ? ptepCompletedTableToTable.size === 0
                                        : ptepCompletedParameterMeters === 0)
                                      : isLVTT
                                        ? (String(lvttSubMode || 'termination') === 'testing' ? false : lvttCompletedForSubmit === 0)
                                        : isMVT
                                          ? (String(mvtSubMode || 'termination') === 'testing' ? false : mvtCompletedForSubmit === 0)
                                          : isLV
                                            ? workAmount === 0
                                            : workSelectionCount === 0))))
                          )
                    }
                    className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                    title={
                      isMVT && String(mvtSubMode || 'termination') === 'testing'
                        ? (mvtTestResultsDirty ? 'Submit (save) MV test results' : 'No changes to submit')
                        : (isLVTT && String(lvttSubMode || 'termination') === 'testing'
                          ? (lvttTestResultsDirty ? 'Submit (save) LV test results' : 'No changes to submit')
                          : (isDCTT && String(dcttSubMode || 'termination') === 'testing'
                            ? (dcttTestResultsDirty ? 'Submit (save) DC test results' : 'No changes to submit')
                            : (isMC4 && !mc4SelectionMode
                              ? 'Select MC4 Install / Cable Termination Panel Side / Cable Termination Inv. Side first'
                              : 'Submit Work')))
                    }
                    aria-label={
                      isMVT && String(mvtSubMode || 'termination') === 'testing'
                        ? 'Submit Test Results'
                        : (isLVTT && String(lvttSubMode || 'termination') === 'testing'
                          ? 'Submit Test Results'
                          : (isDCTT && String(dcttSubMode || 'termination') === 'testing'
                            ? 'Submit Test Results'
                            : 'Submit Work'))
                    }
                  >
                    Submit
                  </button>

                  {isMVT && String(mvtSubMode || 'termination') === 'testing' ? (
                    <>
                      <input
                        ref={mvtTestImportFileInputRef}
                        type="file"
                        accept=".csv"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target?.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = () => {
                              const text = String(reader.result || '');
                              mvtImportTestResultsFromText(text);
                            };
                            reader.readAsText(file);
                          }
                          if (e.target) e.target.value = '';
                        }}
                      />
                      <button
                        onClick={() => mvtTestImportFileInputRef.current?.click()}
                        className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                        title="Import Test Results (CSV)"
                        aria-label="Import Test Results"
                      >
                        Import Test Results
                      </button>
                      <button
                        onClick={mvtExportTestResultsCsv}
                        className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                        title={mvtTestResultsDirty ? 'Submit first, then export' : 'Export submitted test results (CSV)'}
                        aria-label="Export Test Results"
                      >
                        Export Test Results
                      </button>
                    </>
                  ) : (isDCTT && String(dcttSubMode || 'termination') === 'testing') ? (
                    <>
                      <input
                        ref={dcttTestImportFileInputRef}
                        type="file"
                        accept=".csv"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target?.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = () => {
                              const text = String(reader.result || '');
                              dcttTestImportFromText(text, 'import');
                            };
                            reader.readAsText(file);
                          }
                          if (e.target) e.target.value = '';
                        }}
                      />
                      <button
                        onClick={() => dcttTestImportFileInputRef.current?.click()}
                        className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                        title="Import Test Results (CSV)"
                        aria-label="Import Test Results"
                      >
                        <span className="flex flex-col items-center leading-[1.05]">
                          <span>Import</span>
                          <span>Test Results</span>
                        </span>
                      </button>
                      <button
                        onClick={dcttTestExportCsv}
                        className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                        title={dcttTestResultsDirty ? 'Submit first, then export' : 'Export submitted test results (CSV)'}
                        aria-label="Export Test Results"
                      >
                        <span className="flex flex-col items-center leading-[1.05]">
                          <span>Export</span>
                          <span>Test Results</span>
                        </span>
                      </button>
                    </>
                  ) : (isLVTT && String(lvttSubMode || 'termination') === 'testing') ? (
                    <>
                      <input
                        ref={lvttTestImportFileInputRef}
                        type="file"
                        accept=".csv"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target?.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = () => {
                              const text = String(reader.result || '');
                              lvttImportTestResultsFromText(text);
                            };
                            reader.readAsText(file);
                          }
                          if (e.target) e.target.value = '';
                        }}
                      />
                      <button
                        onClick={() => lvttTestImportFileInputRef.current?.click()}
                        className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                        title="Import Test Results (CSV)"
                        aria-label="Import Test Results"
                      >
                        <span className="flex flex-col items-center leading-[1.05]">
                          <span>Import</span>
                          <span>Test Results</span>
                        </span>
                      </button>
                      <button
                        onClick={lvttExportTestResultsCsv}
                        className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                        title={lvttTestResultsDirty ? 'Submit first, then export' : 'Export submitted test results (CSV)'}
                        aria-label="Export Test Results"
                      >
                        <span className="flex flex-col items-center leading-[1.05]">
                          <span>Export</span>
                          <span>Test Results</span>
                        </span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setHistoryOpen(true)}
                        disabled={isLVTT && String(lvttSubMode || 'termination') === 'testing'}
                        className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                        title={isLVTT && String(lvttSubMode || 'termination') === 'testing'
                          ? 'History disabled in LV_TESTING'
                          : 'History'}
                        aria-label="History"
                      >
                        History
                      </button>

                      {!isLVTT && (
                        <button
                          onClick={() => {
                            const exportModuleKey = String(
                              isMC4
                                ? (mc4SelectionMode === 'termination_panel'
                                  ? 'MC4_TERM_PANEL'
                                  : (mc4SelectionMode === 'termination_inv'
                                    ? 'MC4_TERM_INV'
                                    : 'MC4_INST'))
                                : (isDATP
                                  ? 'DATP'
                                  : (isMVFT
                                    ? 'MVFT'
                                    : (isPTEP
                                      ? (ptepSubMode === 'tabletotable' ? 'PTEP_TT' : 'PTEP_PARAM')
                                      : (isMVT
                                        ? 'MVT_TERM'
                                        : (isLVTT && String(lvttSubMode || 'termination') === 'termination')
                                          ? 'LVTT_TERM'
                                          : (activeMode?.key || '')))))
                            ).toUpperCase();

                            const exportLog = isMC4
                              ? (dailyLog || []).filter((r) => String(r?.module_key || '').toUpperCase() === exportModuleKey)
                              : dailyLog;

                            exportToExcel(exportLog, {
                              moduleKey: exportModuleKey,
                              moduleLabel: isMC4
                                ? (mc4SelectionMode === 'termination_panel'
                                  ? 'Cable Termination Panel Side'
                                  : (mc4SelectionMode === 'termination_inv'
                                    ? 'Cable Termination Inv. Side'
                                    : 'MC4 Installation'))
                                : (isDATP
                                  ? 'DC&AC Trench'
                                  : (isMVFT
                                    ? 'MV&Fibre Trench'
                                    : (isPTEP
                                      ? (ptepSubMode === 'tabletotable' ? 'Table-to-Table Earthing' : 'Parameter Earthing')
                                      : (isMVT
                                        ? 'Cable Termination'
                                        : (isLVTT && String(lvttSubMode || 'termination') === 'termination')
                                          ? 'Cable Termination'
                                          : moduleName)))),
                              unit: isMC4
                                ? 'ends'
                                : (isDATP || isMVFT
                                  ? 'm'
                                  : (isPTEP
                                    ? (ptepSubMode === 'tabletotable' ? 'pcs' : 'm')
                                    : ((isMVT || (isLVTT && String(lvttSubMode || 'termination') === 'termination')) ? 'cables' : 'm'))),
                              chartSheetName: isDATP
                                ? 'DC&AC Trench Progress'
                                : (isMVFT
                                  ? 'MV&Fibre Trench Progress'
                                  : ((isMVT || (isLVTT && String(lvttSubMode || 'termination') === 'termination'))
                                    ? 'Cable Termination'
                                    : (isPTEP
                                      ? (ptepSubMode === 'tabletotable' ? 'Table-to-Table Earthing' : 'Parameter Earthing')
                                      : undefined))),
                              chartTitle: isDATP
                                ? 'DC&AC Trench Progress'
                                : (isMVFT
                                  ? 'MV&Fibre Trench Progress'
                                  : ((isMVT || (isLVTT && String(lvttSubMode || 'termination') === 'termination'))
                                    ? 'Cable Termination'
                                    : (isPTEP
                                      ? (ptepSubMode === 'tabletotable' ? 'Table-to-Table Earthing' : 'Parameter Earthing')
                                      : undefined))),
                            });
                          }}
                          disabled={(isLVTT && String(lvttSubMode || 'termination') === 'testing') || dailyLog.length === 0}
                          className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
                          title={isLVTT && String(lvttSubMode || 'termination') === 'testing'
                            ? 'Export disabled in LV_TESTING'
                            : 'Export Excel'}
                          aria-label="Export Excel"
                        >
                          Export
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* MV PULLING: segments panel - simple list, click to select/unselect (green on map) */}
          {isMVF && mvfSegments.length > 0 && (
            <div className="fixed left-3 sm:left-5 top-[190px] z-[1190] w-[220px] border border-slate-600 bg-slate-900/95 text-white shadow-[0_10px_26px_rgba(0,0,0,0.5)] rounded">
              <div className="border-b border-slate-700 px-3 py-2">
                <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-300">{isFIB ? 'fibre cable route and length' : 'mv cable route and length'}</div>
              </div>
              <div className="max-h-[280px] overflow-y-auto p-2">
                {mvfSegments.map((s) => {
                  const active = mvfActiveSegmentKeys.has(s.key);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => {
                        const ck = String(s.key || '');
                        // Toggle selection - when selected, route shows GREEN on map
                        setMvfActiveSegmentKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(ck)) next.delete(ck);
                          else next.add(ck);
                          return next;
                        });
                        // Also mark as done when selected (so it appears green)
                        setMvfDoneSegmentKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(ck)) next.delete(ck);
                          else next.add(ck);
                          return next;
                        });
                      }}
                      className={`mb-1 flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[12px] transition-colors ${active
                        ? 'bg-emerald-600 text-white font-semibold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      title={active ? `${s.label} (selected - click to unselect)` : `${s.label} (click to select)`}
                    >
                      <span className="min-w-0 truncate">{s.label}</span>
                      <span className="ml-2 tabular-nums text-[11px] opacity-80">
                        {mvfCircuitsMultiplier > 1
                          ? `${Math.round(Number(s.length || 0) / mvfCircuitsMultiplier)}*${mvfCircuitsMultiplier}`
                          : `${Math.round(Number(s.length || 0))}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legend / DWG / Notes (right aligned, vertically centered on screen) */}
          {/* For PUNCH_LIST: Show Punch and Contractor buttons instead of Legend/DWG/TEXT */}
          {isPL ? (
            <div className="fixed right-3 sm:right-5 top-[40%] -translate-y-1/2 z-[1090] flex flex-col items-end gap-4">
              {/* Punch button with red pulsing dot */}
              <button
                type="button"
                onClick={() => {
                  setNoteMode((prev) => !prev);
                }}
                aria-pressed={noteMode}
                aria-label={noteMode ? 'Exit Punch Mode' : 'Punch Mode'}
                title={noteMode ? 'Exit Punch Mode' : 'Punch Mode'}
                className="relative inline-flex h-8 items-center justify-center border-2 border-slate-700 bg-slate-900 px-3 text-[11px] font-extrabold uppercase tracking-wide text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              >
                Punch
                {/* Red corner indicator (pulses when active) */}
                <svg
                  className={`note-dot absolute -right-1 -top-1 ${noteMode ? 'h-3 w-3 note-dot--active' : 'h-2 w-2'}`}
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <circle cx="6" cy="6" r="4" fill="#e23a3a" stroke="#7a0f0f" strokeWidth="2" />
                </svg>
              </button>

              {/* Selected punches indicator */}
              {plSelectedPunches.size > 0 && (
                <div className="inline-flex h-8 items-center gap-2 border-2 border-red-700 bg-red-900/80 px-3 text-[11px] font-extrabold uppercase tracking-wide text-red-200">
                  <span>{plSelectedPunches.size} Selected</span>
                  <button
                    type="button"
                    onClick={() => plDeleteSelectedPunches()}
                    className="text-red-400 hover:text-white ml-1"
                    title="Delete Selected (Delete key)"
                  >
                    🗑️
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlSelectedPunches(new Set())}
                    className="text-red-400 hover:text-white"
                    title="Clear Selection (Escape)"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Legend for PUNCH_LIST - in the middle */}
              <div className="border-2 border-slate-700 bg-slate-900 px-4 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.55)]">
                <div className="text-base font-black uppercase tracking-wide text-white">Legend</div>
                <div className="mt-2 border-2 border-slate-700 bg-slate-800 px-3 py-2">
                  {/* Completed punch indicator */}
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full border-2 border-emerald-300"
                      style={{ backgroundColor: PUNCH_COMPLETED_COLOR }}
                      aria-hidden="true"
                    />
                    <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">Completed</span>
                  </div>
                  {/* Contractor colors */}
                  {plContractors.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-600">
                      {plContractors.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 mt-1 first:mt-0">
                          <span
                            className="h-3 w-3 rounded-full border border-white/40"
                            style={{ backgroundColor: c.color }}
                            aria-hidden="true"
                          />
                          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-300">{c.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Contractor button - at the bottom, always shows "Contractor" */}
            </div>
          ) : (
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
                    </>
                  ) : isPTEP ? (
                    <>
                      {/* Blue dashed line for Table to Table */}
                      <div className="flex items-center gap-2">
                        <svg width="24" height="12" aria-hidden="true">
                          <line x1="0" y1="6" x2="24" y2="6" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 3" />
                        </svg>
                        <span className="text-[11px] font-bold uppercase tracking-wide text-blue-400">Table to Table</span>
                      </div>
                      {/* Yellow line for Parameter Earthing */}
                      <div className="mt-2 flex items-center gap-2">
                        <svg width="24" height="12" aria-hidden="true">
                          <line x1="0" y1="6" x2="24" y2="6" stroke="#facc15" strokeWidth="2" />
                        </svg>
                        <span className="text-[11px] font-bold uppercase tracking-wide text-yellow-400">Parameter Earthing</span>
                      </div>
                      {/* Green line for Completed */}
                      <div className="mt-2 flex items-center gap-2">
                        <svg width="24" height="12" aria-hidden="true">
                          <line x1="0" y1="6" x2="24" y2="6" stroke="#22c55e" strokeWidth="2" />
                        </svg>
                        <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">Completed</span>
                      </div>
                    </>
                  ) : isDATP ? (
                    <>
                      {/* Blue line for Uncompleted */}
                      <div className="flex items-center gap-2">
                        <svg width="24" height="12" aria-hidden="true">
                          <line x1="0" y1="6" x2="24" y2="6" stroke={datpTrenchLineColor} strokeWidth="2" />
                        </svg>
                        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: datpTrenchLineColor }}>Uncompleted</span>
                      </div>
                      {/* Green line for Completed */}
                      <div className="mt-2 flex items-center gap-2">
                        <svg width="24" height="12" aria-hidden="true">
                          <line x1="0" y1="6" x2="24" y2="6" stroke={datpCompletedLineColor} strokeWidth="2" />
                        </svg>
                        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: datpCompletedLineColor }}>Completed</span>
                      </div>
                    </>
                  ) : isMVFT ? (
                    <>
                      {/* Blue line for Uncompleted */}
                      <div className="flex items-center gap-2">
                        <svg width="24" height="12" aria-hidden="true">
                          <line x1="0" y1="6" x2="24" y2="6" stroke={mvftTrenchLineColor} strokeWidth="2" />
                        </svg>
                        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: mvftTrenchLineColor }}>Uncompleted</span>
                      </div>
                      {/* Green line for Completed */}
                      <div className="mt-2 flex items-center gap-2">
                        <svg width="24" height="12" aria-hidden="true">
                          <line x1="0" y1="6" x2="24" y2="6" stroke={mvftCompletedLineColor} strokeWidth="2" />
                        </svg>
                        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: mvftCompletedLineColor }}>Completed</span>
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
                        <span className="h-3 w-3 border-2 border-white bg-white" aria-hidden="true" />
                        <span className="text-[11px] font-bold uppercase tracking-wide text-white">NOT TESTED</span>
                      </div>
                    </>
                  ) : isDCTT ? (
                    <>
                      {String(dcttSubMode || 'termination') === 'testing' ? (
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
                            <span className="h-3 w-3 border-2 border-white bg-white" aria-hidden="true" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-white">NOT TESTED</span>
                          </div>
                        </>
                      ) : dcttSelectionMode === 'termination_panel' ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 border-2 border-white bg-white" aria-hidden="true" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-white">Uncompleted</span>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full border-2 border-emerald-700 bg-emerald-500" aria-hidden="true" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">Completed</span>
                          </div>
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
                    </>
                  ) : (
                    <>
                      {isMVT ? (
                        <>
                          {String(mvtSubMode || 'termination') === 'termination' ? (
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
                              <div className="mt-2 flex items-center gap-2">
                                <span className="h-3 w-3 border-2 border-white bg-white" aria-hidden="true" />
                                <span className="text-[11px] font-bold uppercase tracking-wide text-white">NOT TESTED</span>
                              </div>
                            </>
                          )}
                        </>
                      ) : isLVTT ? (
                        <>
                          {String(lvttSubMode || 'termination') === 'termination' ? (
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
                      ) : isLVIB ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 border-2 border-red-300 bg-red-500" aria-hidden="true" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-red-300">Uncompleted</span>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="h-3 w-3 border-2 border-emerald-300 bg-emerald-500" aria-hidden="true" />
                            <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">Completed</span>
                          </div>
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
          )}

          {/* NOTE button (between header and legend, right-aligned with legend/DWG) */}
          {/* PUNCH_LIST: Note/Punch button is hidden - punch mode is always active */}
          {!isPL && (
            <div className="fixed right-3 sm:right-5 top-[20%] z-[1090] note-btn-wrap flex flex-col items-end gap-1">
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
          )}
        </div>
      </div>

      {/* Title under header */}
      <div className="w-full border-0 bg-[#0b1220] py-2 text-center text-base font-black uppercase tracking-[0.22em] text-slate-200 flex justify-center items-center gap-2 relative">
        {moduleName}
      </div>

      <div className="map-wrapper">
        <div id="map" />
      </div>

      {/* MVT: click-position popups */}
      {isMVT && String(mvtSubMode || 'termination') === 'testing' && mvtTestPopup ? (
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
              <div className="text-[11px] font-black uppercase tracking-wide text-white">MV TESTING</div>
              <div className="mt-1 text-sm font-extrabold text-slate-100 truncate">
                {mvtTestPopup.stationLabel || mvtTestPopup.fromKey || 'Substation'}
              </div>
              {(() => {
                const fromKey = normalizeId(mvtTestPopup.fromKey);
                const toRaw = String(mvtTestToByFromRef.current?.[fromKey] || '').trim();
                return toRaw ? (
                  <div className="mt-0.5 text-[11px] font-bold text-slate-300 truncate">To: {toRaw}</div>
                ) : null;
              })()}
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
              const fromKey = normalizeId(mvtTestPopup.fromKey);
              const live = mvtTestCsvByFromRef.current?.[fromKey]?.[ph];
              const obj = (live && typeof live === 'object') ? live : { value: '', status: 'N/A' };
              const statusRaw = String(obj?.status || 'N/A').trim();
              const statusU = statusRaw.toUpperCase();
              const val = String(obj?.value || '').trim();
              const pass = statusU === 'PASS';
              const isNA = !statusU || statusU === 'N/A' || statusU === 'NA';
              const status = pass ? 'PASS' : (isNA ? 'N/A' : 'FAIL');
              return (
                <div key={ph} className="flex items-center justify-between border border-slate-700 bg-slate-800 px-2 py-1.5">
                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-200">{ph}</span>
                  <span className="ml-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={val}
                      onChange={(e) => {
                        mvtUpdateTestPhase(fromKey, ph, { value: e.target.value });
                      }}
                      placeholder="Value"
                      className={`h-7 w-[110px] border border-slate-700 bg-slate-900 px-2 text-[12px] font-extrabold tabular-nums outline-none focus:border-amber-400 ${pass ? 'text-emerald-200' : (isNA ? 'text-slate-200' : 'text-red-200')}`}
                    />
                    <select
                      value={pass ? 'PASS' : (isNA ? 'N/A' : 'failed')}
                      onChange={(e) => {
                        const next = String(e.target.value || 'N/A');
                        mvtUpdateTestPhase(fromKey, ph, { status: next });
                      }}
                      className={`h-7 w-[80px] border border-slate-700 bg-slate-900 px-2 text-[11px] font-black uppercase tracking-wide outline-none focus:border-amber-400 ${pass ? 'text-emerald-300' : (isNA ? 'text-slate-300' : 'text-red-300')}`}
                      aria-label={`${ph} status`}
                    >
                      <option value="N/A">N/A</option>
                      <option value="PASS">PASS</option>
                      <option value="failed">FAIL</option>
                    </select>
                  </span>
                </div>
              );
            })}
          </div>
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
                {lvttPopup.mode === 'termination'
                  ? 'LV Termination'
                  : lvttPopup.mode === 'sub_termination'
                    ? 'LV Termination'
                    : 'LV Testing'}
              </div>
              <div className="mt-1 text-sm font-extrabold text-slate-100 truncate">
                {lvttPopup.mode === 'sub_termination'
                  ? (lvttPopup.subId || 'SUB')
                  : (lvttPopup.invId || 'Inverter')}
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
              const setDraft = (v) => setLvttPopup((p) => (p ? { ...p, draft: Math.max(0, Math.min(3, v)) } : p));

              const readDraftFromInput = (fallback) => {
                try {
                  const el = lvttTermInvInputRef.current;
                  const raw = el?.value;
                  if (raw == null || raw === '') return fallback;
                  const n = parseInt(String(raw), 10);
                  if (!Number.isFinite(n)) return fallback;
                  return Math.max(0, Math.min(3, n));
                } catch (_e) {
                  void _e;
                  return fallback;
                }
              };

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

              const openNextInv = (appliedValue) => {
                const list = orderedInvs;
                if (!list.length || !invNorm) return;

                const snapshot = {
                  ...(lvttTerminationByInvRef.current || {}),
                  [invNorm]: Math.max(0, Math.min(3, Number(appliedValue ?? draft) || 0)),
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
                    <div className="mt-0 flex items-center justify-end gap-2">
                      <div className="flex items-center gap-1">
                        <input
                          ref={lvttTermInvInputRef}
                          type="number"
                          min={0}
                          max={3}
                          step={1}
                          value={draft}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return;
                            try {
                              e.preventDefault();
                              e.stopPropagation();
                            } catch (_e) { void _e; }
                            const v = readDraftFromInput(draft);
                            applyDraft(v);
                            setLvttPopup(null);
                          }}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '') return;
                            const n = Math.max(0, Math.min(3, parseInt(v, 10)));
                            if (Number.isFinite(n)) setDraft(n);
                          }}
                          className={`w-14 h-8 border-2 bg-slate-900 px-2 text-center text-[13px] font-black tabular-nums outline-none ${draft === 3 ? 'border-emerald-700 text-emerald-200' : 'border-red-700 text-red-200'
                            }`}
                          title="Enter 0..3"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const v = readDraftFromInput(draft);
                        applyDraft(v);
                        openNextInv(v);
                      }}
                      className={`flex-1 h-8 border-2 text-[11px] font-extrabold uppercase tracking-wide ${'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                        }`}
                      title="Apply and open next inverter"
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!invNorm) return;
                        const v = readDraftFromInput(draft);
                        applyDraft(v);
                        setLvttPopup(null);
                      }}
                      className={`flex-1 h-8 border-2 text-[11px] font-extrabold uppercase tracking-wide ${'border-emerald-700 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-950/40'
                        }`}
                      title="Apply"
                    >
                      OK
                    </button>
                  </div>
                </div>
              );
            })()
          ) : lvttPopup.mode === 'sub_termination' ? (
            (() => {
              const LVTT_INV_SIDE_MULTIPLIER = 3;
              const subNorm = String(lvttPopup.subNorm || '');
              const maxInv = Math.max(0, Number(lvttPopup.max ?? 0) || 0);
              const storedRaw = Number(lvttSubTerminationBySubRef.current?.[subNorm] ?? 0);
              const stored = Math.max(0, Math.min(maxInv, Number.isFinite(storedRaw) ? storedRaw : 0));
              const draft = Math.max(0, Math.min(maxInv, Number(lvttPopup.draft ?? stored) || 0));
              const setDraft = (v) => setLvttPopup((p) => (p ? { ...p, draft: Math.max(0, Math.min(maxInv, Number(v) || 0)) } : p));

              const applyDraft = (valueToApply) => {
                if (!subNorm || !(maxInv > 0)) return;
                const nextVal = Math.max(0, Math.min(maxInv, Number(valueToApply ?? 0) || 0));
                const prevVal = Math.max(0, Math.min(maxInv, Number(lvttSubTerminationBySubRef.current?.[subNorm] ?? 0) || 0));
                if (nextVal === prevVal) return;
                setLvttSubTerminationBySub((prev) => {
                  const base = prev && typeof prev === 'object' ? { ...prev } : {};
                  base[subNorm] = nextVal;
                  return base;
                });
              };

              const done = draft;
              const complete = maxInv > 0 && done >= maxInv;
              const doneScaled = done * LVTT_INV_SIDE_MULTIPLIER;
              const maxScaled = maxInv * LVTT_INV_SIDE_MULTIPLIER;

              return (
                <div className="mt-3">
                  <div className="border border-slate-700 bg-slate-800 px-2 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black uppercase tracking-wide text-slate-300">Progress</span>
                      <span className={`text-[11px] font-black uppercase tracking-wide ${complete ? 'text-emerald-300' : 'text-red-300'}`}>{doneScaled}/{maxScaled}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <input
                        type="number"
                        min={0}
                        max={maxInv}
                        step={1}
                        value={draft}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          try {
                            e.preventDefault();
                            e.stopPropagation();
                          } catch (_e) { void _e; }
                          applyDraft(draft);
                          setLvttPopup(null);
                        }}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '') return;
                          const n = Math.max(0, Math.min(maxInv, parseInt(v, 10)));
                          if (Number.isFinite(n)) setDraft(n);
                        }}
                        className={`w-20 h-8 border-2 bg-slate-900 px-2 text-center text-[13px] font-black tabular-nums outline-none ${complete
                          ? 'border-emerald-700 text-emerald-200'
                          : 'border-red-700 text-red-200'
                          }`}
                        title={`Enter 0..${maxInv}`}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        applyDraft(draft);
                        setLvttPopup(null);
                      }}
                      className="flex-1 h-8 border-2 border-emerald-700 bg-emerald-950/30 text-[11px] font-extrabold uppercase tracking-wide text-emerald-200 hover:bg-emerald-950/40"
                      title="Apply"
                    >
                      OK
                    </button>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="mt-3 space-y-2">
              {(['L1', 'L2', 'L3']).map((ph) => {
                const invNorm = normalizeId(lvttPopup.invIdNorm);
                const live = lvttTestCsvByInvRef.current?.[invNorm]?.[ph];
                const obj = (live && typeof live === 'object') ? live : { value: '', status: 'N/A' };
                const statusRaw = String(obj?.status || 'N/A').trim();
                const statusU = statusRaw.toUpperCase();
                const val = String(obj?.value || '').trim();
                const pass = statusU === 'PASS';
                const isNA = !statusU || statusU === 'N/A' || statusU === 'NA';

                return (
                  <div key={ph} className="flex items-center justify-between border border-slate-700 bg-slate-800 px-2 py-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wide text-slate-200">{ph}</span>
                    <span className="ml-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => {
                          lvttUpdateTestPhase(invNorm, ph, { value: e.target.value });
                        }}
                        placeholder="Value"
                        className={`h-7 w-[110px] border border-slate-700 bg-slate-900 px-2 text-[12px] font-extrabold tabular-nums outline-none focus:border-amber-400 ${pass ? 'text-emerald-200' : (isNA ? 'text-slate-200' : 'text-red-200')}`}
                      />
                      <select
                        value={pass ? 'PASS' : (isNA ? 'N/A' : 'failed')}
                        onChange={(e) => {
                          const next = String(e.target.value || 'N/A');
                          lvttUpdateTestPhase(invNorm, ph, { status: next });
                        }}
                        className={`h-7 w-[80px] border border-slate-700 bg-slate-900 px-2 text-[11px] font-black uppercase tracking-wide outline-none focus:border-amber-400 ${pass ? 'text-emerald-300' : (isNA ? 'text-slate-300' : 'text-red-300')}`}
                        aria-label={`${ph} status`}
                      >
                        <option value="N/A">N/A</option>
                        <option value="PASS">PASS</option>
                        <option value="failed">FAIL</option>
                      </select>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* DCCT: click-position popup (testing) */}
      {isDCCT && dcctPopup ? (
        <div
          style={{
            position: 'fixed',
            left: Math.min(window.innerWidth - 300, Math.max(8, (dcctPopup.x || 0) + 10)),
            top: Math.min(window.innerHeight - 240, Math.max(8, (dcctPopup.y || 0) + 10)),
            zIndex: 1400,
          }}
          className="w-[280px] border-2 border-slate-700 bg-slate-900 px-3 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-wide text-white">DC Cable Testing</div>
              <div className="mt-1 text-sm font-extrabold text-slate-100 truncate">{dcctPopup.displayId || dcctPopup.idNorm}</div>
            </div>
            <button
              type="button"
              onClick={() => setDcctPopup(null)}
              className="inline-flex h-6 w-6 items-center justify-center border-2 border-slate-700 bg-slate-800 text-xs font-black text-white hover:bg-slate-700"
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {([
              { key: 'plus', label: 'Ins. Res (+)' },
              { key: 'minus', label: 'Ins. Res (-)' },
            ]).map((row) => {
              const val = row.key === 'plus' ? String(dcctPopup.draftPlus ?? '') : String(dcctPopup.draftMinus ?? '');
              const ok = row.key === 'plus' ? dcctPopup.draftStatus === 'passed' : dcctPopup.draftStatus === 'passed';
              void ok;
              return (
                <div key={row.key} className="flex items-center justify-between border border-slate-700 bg-slate-800 px-2 py-1.5">
                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-200">{row.label}</span>
                  <input
                    type="text"
                    value={val}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setDcctPopup((p) => {
                        if (!p) return p;
                        return row.key === 'plus'
                          ? { ...p, draftPlus: nextVal }
                          : { ...p, draftMinus: nextVal };
                      });
                      const idNorm = String(dcctPopup.idNorm || '');
                      if (!idNorm) return;
                      const riso = dcctRisoByIdRef.current || {};
                      const prev = riso[idNorm] || {};
                      riso[idNorm] = {
                        ...prev,
                        plus: row.key === 'plus' ? nextVal : (prev.plus ?? '0'),
                        minus: row.key === 'minus' ? nextVal : (prev.minus ?? '0'),
                        status: dcctNormalizeStatus(prev.status || prev.remarkRaw) || null,
                        remarkRaw: prev.remarkRaw || '',
                        originalId: prev.originalId || dcctFormatDisplayId(idNorm, ''),
                      };
                      dcctRisoByIdRef.current = riso;
                      setDcctTestResultsDirty(true);
                      dcctTestResultsSubmittedRef.current = null;
                      try { localStorage.removeItem('cew:dcct:test_results_submitted'); } catch (_e) { void _e; }
                    }}
                    className="h-7 w-[110px] border border-slate-700 bg-slate-900 px-2 text-[12px] font-extrabold tabular-nums text-slate-200 outline-none focus:border-amber-400"
                    placeholder="Value"
                  />
                </div>
              );
            })}

            <div className="flex items-center justify-between border border-slate-700 bg-slate-800 px-2 py-1.5">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-200">Status</span>
              <select
                value={dcctPopup.draftStatus === 'passed' ? 'PASSED' : dcctPopup.draftStatus === 'failed' ? 'FAILED' : ''}
                onChange={(e) => {
                  const raw = String(e.target.value || '');
                  const next = raw === 'PASSED' ? 'passed' : raw === 'FAILED' ? 'failed' : null;
                  const idNorm = String(dcctPopup.idNorm || '');
                  if (!idNorm) return;

                  setDcctPopup((p) => (p ? { ...p, draftStatus: next } : p));

                  const riso = dcctRisoByIdRef.current || {};
                  const prev = riso[idNorm] || {};
                  riso[idNorm] = {
                    ...prev,
                    plus: prev.plus ?? '0',
                    minus: prev.minus ?? '0',
                    status: next,
                    remarkRaw: next === 'passed' ? 'PASSED' : next === 'failed' ? 'FAILED' : '',
                    originalId: prev.originalId || dcctFormatDisplayId(idNorm, ''),
                  };
                  dcctRisoByIdRef.current = riso;

                  setDcctTestData((prevTest) => {
                    const out = { ...(prevTest || {}) };
                    if (next === 'passed') out[idNorm] = 'passed';
                    else if (next === 'failed') out[idNorm] = 'failed';
                    else delete out[idNorm];
                    return out;
                  });

                  setDcctTestResultsDirty(true);
                  dcctTestResultsSubmittedRef.current = null;
                  try { localStorage.removeItem('cew:dcct:test_results_submitted'); } catch (_e) { void _e; }
                  setStringMatchVersion((v) => v + 1);
                }}
                className={`h-7 w-[140px] border border-slate-700 bg-slate-900 px-2 text-[11px] font-black uppercase tracking-wide outline-none focus:border-amber-400 ${dcctPopup.draftStatus === 'passed'
                  ? 'text-emerald-300'
                  : (dcctPopup.draftStatus === 'failed' ? 'text-red-300' : 'text-white')
                  }`}
                aria-label="Status"
              >
                <option value="">NOT TESTED</option>
                <option value="PASSED">PASSED</option>
                <option value="FAILED">FAILED</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {/* DCTT Testing: click-position popup (same as DCCT) */}
      {isDCTT && dcttTestPopup ? (
        <div
          style={{
            position: 'fixed',
            left: Math.min(window.innerWidth - 300, Math.max(8, (dcttTestPopup.x || 0) + 10)),
            top: Math.min(window.innerHeight - 240, Math.max(8, (dcttTestPopup.y || 0) + 10)),
            zIndex: 1400,
          }}
          className="w-[280px] border-2 border-slate-700 bg-slate-900 px-3 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-wide text-white">DC Cable Testing</div>
              <div className="mt-1 text-sm font-extrabold text-slate-100 truncate">{dcttTestPopup.displayId || dcttTestPopup.idNorm}</div>
            </div>
            <button
              type="button"
              onClick={() => setDcttTestPopup(null)}
              className="inline-flex h-6 w-6 items-center justify-center border-2 border-slate-700 bg-slate-800 text-xs font-black text-white hover:bg-slate-700"
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {([
              { key: 'plus', label: 'Ins. Res (+)' },
              { key: 'minus', label: 'Ins. Res (-)' },
            ]).map((row) => {
              const val = row.key === 'plus' ? String(dcttTestPopup.draftPlus ?? '') : String(dcttTestPopup.draftMinus ?? '');
              return (
                <div key={row.key} className="flex items-center justify-between border border-slate-700 bg-slate-800 px-2 py-1.5">
                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-200">{row.label}</span>
                  <input
                    type="text"
                    value={val}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      setDcttTestPopup((p) => {
                        if (!p) return p;
                        return row.key === 'plus'
                          ? { ...p, draftPlus: nextVal }
                          : { ...p, draftMinus: nextVal };
                      });
                      const idNorm = String(dcttTestPopup.idNorm || '');
                      if (!idNorm) return;
                      const riso = dcttTestRisoByIdRef.current || {};
                      const prev = riso[idNorm] || {};
                      riso[idNorm] = {
                        ...prev,
                        plus: row.key === 'plus' ? nextVal : (prev.plus ?? '0'),
                        minus: row.key === 'minus' ? nextVal : (prev.minus ?? '0'),
                        status: dcttTestNormalizeStatus(prev.status || prev.remarkRaw) || null,
                        remarkRaw: prev.remarkRaw || '',
                        originalId: prev.originalId || dcttTestFormatDisplayId(idNorm, ''),
                      };
                      dcttTestRisoByIdRef.current = riso;
                      setDcttTestResultsDirty(true);
                      dcttTestResultsSubmittedRef.current = null;
                      try { localStorage.removeItem('cew:dctt:test_results_submitted'); } catch (_e) { void _e; }
                    }}
                    className="h-7 w-[110px] border border-slate-700 bg-slate-900 px-2 text-[12px] font-extrabold tabular-nums text-slate-200 outline-none focus:border-amber-400"
                    placeholder="Value"
                  />
                </div>
              );
            })}

            <div className="flex items-center justify-between border border-slate-700 bg-slate-800 px-2 py-1.5">
              <span className="text-[11px] font-black uppercase tracking-wide text-slate-200">Status</span>
              <select
                value={dcttTestPopup.draftStatus === 'passed' ? 'PASSED' : dcttTestPopup.draftStatus === 'failed' ? 'FAILED' : ''}
                onChange={(e) => {
                  const raw = String(e.target.value || '');
                  const next = raw === 'PASSED' ? 'passed' : raw === 'FAILED' ? 'failed' : null;
                  const idNorm = String(dcttTestPopup.idNorm || '');
                  if (!idNorm) return;

                  setDcttTestPopup((p) => (p ? { ...p, draftStatus: next } : p));

                  const riso = dcttTestRisoByIdRef.current || {};
                  const prev = riso[idNorm] || {};
                  riso[idNorm] = {
                    ...prev,
                    plus: prev.plus ?? '0',
                    minus: prev.minus ?? '0',
                    status: next,
                    remarkRaw: next === 'passed' ? 'PASSED' : next === 'failed' ? 'FAILED' : '',
                    originalId: prev.originalId || dcttTestFormatDisplayId(idNorm, ''),
                  };
                  dcttTestRisoByIdRef.current = riso;

                  setDcttTestData((prevTest) => {
                    const out = { ...(prevTest || {}) };
                    if (next === 'passed') out[idNorm] = 'passed';
                    else if (next === 'failed') out[idNorm] = 'failed';
                    else delete out[idNorm];
                    return out;
                  });

                  setDcttTestResultsDirty(true);
                  dcttTestResultsSubmittedRef.current = null;
                  try { localStorage.removeItem('cew:dctt:test_results_submitted'); } catch (_e) { void _e; }
                  setStringMatchVersion((v) => v + 1);
                }}
                className={`h-7 w-[140px] border border-slate-700 bg-slate-900 px-2 text-[11px] font-black uppercase tracking-wide outline-none focus:border-amber-400 ${dcttTestPopup.draftStatus === 'passed'
                  ? 'text-emerald-300'
                  : (dcttTestPopup.draftStatus === 'failed' ? 'text-red-300' : 'text-white')
                  }`}
                aria-label="Status"
              >
                <option value="">NOT TESTED</option>
                <option value="PASSED">PASSED</option>
                <option value="FAILED">FAILED</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {/* MC4: inverter termination popup (click inv_id in Cable Termination Inv. Side mode) */}
      {isMC4 && mc4InvPopup ? (
        <div
          style={{
            position: 'fixed',
            left: Math.min(window.innerWidth - 320, Math.max(8, (mc4InvPopup.x || 0) + 10)),
            top: Math.min(window.innerHeight - 260, Math.max(8, (mc4InvPopup.y || 0) + 10)),
            zIndex: 1400,
          }}
          className="w-[300px] border-2 border-slate-700 bg-slate-900 px-3 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-wide text-white">DC Cable Termination</div>
              <div className="mt-1 text-sm font-extrabold text-slate-100 truncate">{mc4InvPopup.invId || 'Inverter'}</div>
            </div>
            <button
              type="button"
              onClick={() => setMc4InvPopup(null)}
              className="inline-flex h-6 w-6 items-center justify-center border-2 border-slate-700 bg-slate-800 text-xs font-black text-white hover:bg-slate-700"
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {(() => {
            const invNorm = normalizeId(mc4InvPopup.invIdNorm || '');
            const max = Math.max(0, Number(mc4InvPopup.max ?? 0) || 0);
            const stored = Math.max(0, Number(mc4InvTerminationByInv?.[invNorm] ?? 0) || 0);
            const draft = Math.max(0, Math.min(max > 0 ? max : 999999, Number(mc4InvPopup.draft ?? stored) || 0));
            const complete = max > 0 && draft >= max;

            const setDraft = (v) => setMc4InvPopup((p) => (p ? { ...p, draft: Math.max(0, Math.min(max > 0 ? max : 999999, Number(v) || 0)) } : p));

            const applyDraft = (valueToApply) => {
              if (!invNorm) return;
              const nextVal = Math.max(0, Math.min(max > 0 ? max : 999999, Number(valueToApply ?? 0) || 0));
              setMc4InvTerminationByInv((prev) => {
                const base = prev && typeof prev === 'object' ? { ...prev } : {};
                base[invNorm] = nextVal;
                return base;
              });
            };

            return (
              <div className="mt-3">
                <div className="border border-slate-700 bg-slate-800 px-2 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase tracking-wide text-slate-300">Progress</span>
                    <span className={`text-[11px] font-black uppercase tracking-wide ${complete ? 'text-emerald-300' : 'text-red-300'}`}>{draft}/{max || '—'}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <input
                      ref={mc4InvInputRef}
                      type="number"
                      min={0}
                      max={max || undefined}
                      step={1}
                      value={draft}
                      onFocus={(e) => {
                        try { e.target.select?.(); } catch (_e) { void _e; }
                      }}
                      onClick={(e) => {
                        try { e.target.select?.(); } catch (_e) { void _e; }
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        try { e.preventDefault(); e.stopPropagation(); } catch (_e) { void _e; }
                        applyDraft(draft);
                        setMc4InvPopup(null);
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') return;
                        const n = parseInt(v, 10);
                        if (!Number.isFinite(n)) return;
                        setDraft(n);
                      }}
                      className={`w-24 h-8 border-2 bg-slate-900 px-2 text-center text-[13px] font-black tabular-nums outline-none ${complete ? 'border-emerald-700 text-emerald-200' : 'border-red-700 text-red-200'
                        }`}
                      title={max > 0 ? `Enter 0..${max}` : 'Max not found in dc_strings.csv'}
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      applyDraft(draft);
                      setMc4InvPopup(null);
                    }}
                    className="flex-1 h-8 border-2 border-emerald-700 bg-emerald-950/30 text-[11px] font-extrabold uppercase tracking-wide text-emerald-200 hover:bg-emerald-950/40"
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

      {/* DCTT: inverter termination popup (click inv_id in Cable Termination Inv. Side mode) */}
      {isDCTT && dcttInvPopup ? (
        <div
          style={{
            position: 'fixed',
            left: Math.min(window.innerWidth - 320, Math.max(8, (dcttInvPopup.x || 0) + 10)),
            top: Math.min(window.innerHeight - 260, Math.max(8, (dcttInvPopup.y || 0) + 10)),
            zIndex: 1400,
          }}
          className="w-[300px] border-2 border-slate-700 bg-slate-900 px-3 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-wide text-white">DC Cable Termination</div>
              <div className="mt-1 text-sm font-extrabold text-slate-100 truncate">{dcttInvPopup.invId || 'Inverter'}</div>
            </div>
            <button
              type="button"
              onClick={() => setDcttInvPopup(null)}
              className="inline-flex h-6 w-6 items-center justify-center border-2 border-slate-700 bg-slate-800 text-xs font-black text-white hover:bg-slate-700"
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {(() => {
            const invNorm = normalizeId(dcttInvPopup.invIdNorm || '');
            const max = Math.max(0, Number(dcttInvPopup.max ?? 0) || 0);
            const stored = Math.max(0, Number(dcttInvTerminationByInv?.[invNorm] ?? 0) || 0);
            const draft = Math.max(0, Math.min(max > 0 ? max : 999999, Number(dcttInvPopup.draft ?? stored) || 0));
            const complete = max > 0 && draft >= max;

            const setDraft = (v) => setDcttInvPopup((p) => (p ? { ...p, draft: Math.max(0, Math.min(max > 0 ? max : 999999, Number(v) || 0)) } : p));

            const applyDraft = (valueToApply) => {
              if (!invNorm) return;
              const nextVal = Math.max(0, Math.min(max > 0 ? max : 999999, Number(valueToApply ?? 0) || 0));
              setDcttInvTerminationByInv((prev) => {
                const base = prev && typeof prev === 'object' ? { ...prev } : {};
                base[invNorm] = nextVal;
                return base;
              });
            };

            return (
              <div className="mt-3">
                <div className="border border-slate-700 bg-slate-800 px-2 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase tracking-wide text-slate-300">Progress</span>
                    <span className={`text-[11px] font-black uppercase tracking-wide ${complete ? 'text-emerald-300' : 'text-red-300'}`}>{draft}/{max || '—'}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <input
                      ref={dcttInvInputRef}
                      type="number"
                      min={0}
                      max={max || undefined}
                      step={1}
                      value={draft}
                      onFocus={(e) => {
                        try { e.target.select?.(); } catch (_e) { void _e; }
                      }}
                      onClick={(e) => {
                        try { e.target.select?.(); } catch (_e) { void _e; }
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        try { e.preventDefault(); e.stopPropagation(); } catch (_e) { void _e; }
                        applyDraft(draft);
                        setDcttInvPopup(null);
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') return;
                        const n = parseInt(v, 10);
                        if (!Number.isFinite(n)) return;
                        setDraft(n);
                      }}
                      className={`w-24 h-8 border-2 bg-slate-900 px-2 text-center text-[13px] font-black tabular-nums outline-none ${complete ? 'border-emerald-700 text-emerald-200' : 'border-red-700 text-red-200'
                        }`}
                      title={max > 0 ? `Enter 0..${max}` : 'Max not found in CSV'}
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      applyDraft(draft);
                      setDcttInvPopup(null);
                    }}
                    className="flex-1 h-8 border-2 border-emerald-700 bg-emerald-950/30 text-[11px] font-extrabold uppercase tracking-wide text-emerald-200 hover:bg-emerald-950/40"
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

      {isMVT && String(mvtSubMode || 'termination') === 'termination' && mvtTermPopup ? (
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
            const max = mvtTerminationMaxForNorm(stationNorm);
            const stored = clampMvtTerminationCount(stationNorm, mvtTerminationByStation?.[stationNorm] ?? 0);
            const draft = clampMvtTerminationCount(stationNorm, mvtTermPopup.draft ?? stored);
            const locked = Boolean(max) && stored === max;
            const complete = Boolean(max) && draft >= max;
            const setDraft = (v) => setMvtTermPopup((p) => (p ? { ...p, draft: clampMvtTerminationCount(stationNorm, v) } : p));

            const applyDraft = (valueToApply) => {
              if (!stationNorm) return;
              const nextVal = clampMvtTerminationCount(stationNorm, valueToApply ?? 0);
              const prevVal = clampMvtTerminationCount(stationNorm, mvtTerminationByStationRef.current?.[stationNorm] ?? 0);
              if (nextVal === prevVal) return;
              mvtTermPushHistory(stationNorm, prevVal, nextVal);
              setMvtTerminationByStation((prev) => {
                const base = prev && typeof prev === 'object' ? { ...prev } : {};
                base[stationNorm] = nextVal;
                return base;
              });
            };

            const orderedStations = (() => {
              const norm = mvtCanonicalTerminationStationNorm(stationNorm);
              const prefix = norm.startsWith('ss') ? 'ss' : 'sub';
              const mk = (n) => ({ norm: `${prefix}${String(n).padStart(2, '0')}`, label: `${prefix.toUpperCase()}${n}` });
              return [mk(1), mk(2), mk(3), mk(4), mk(5), mk(6), { norm: 'css', label: 'CSS' }];
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
                const vv = clampMvtTerminationCount(cand.norm, snapshot?.[cand.norm] ?? 0);
                const mm = mvtTerminationMaxForNorm(cand.norm);
                if (mm > 0 && vv === mm) continue; // skip locked
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

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase tracking-wide text-slate-300">Progress</span>
                    <span className={`text-[11px] font-black uppercase tracking-wide tabular-nums ${complete ? 'text-emerald-300' : 'text-slate-200'}`}>{draft}/{max}</span>
                  </div>

                  <div className="mt-2 flex items-center justify-end gap-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={max || 0}
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
                          const n = clampMvtTerminationCount(stationNorm, parseInt(v, 10));
                          if (Number.isFinite(n)) setDraft(n);
                        }}
                        className={`w-14 h-8 border-2 bg-slate-900 px-2 text-center text-[13px] font-black tabular-nums outline-none ${locked ? 'border-slate-700 text-slate-500 cursor-not-allowed' : (max > 0 && draft === max ? 'border-emerald-700 text-emerald-200' : 'border-red-700 text-red-200')
                          }`}
                        title={max ? `Enter 0..${max}` : 'Enter value'}
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
                    className={`flex-1 h-8 border-2 text-[11px] font-extrabold uppercase tracking-wide ${locked ? 'border-slate-700 bg-slate-900/40 text-slate-500 cursor-not-allowed' : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                      }`}
                    title={locked ? (max ? `Locked at ${max}/${max}` : 'Locked') : 'Apply and open next station'}
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
                    className={`flex-1 h-8 border-2 text-[11px] font-extrabold uppercase tracking-wide ${locked ? 'border-slate-700 bg-slate-900/40 text-slate-500 cursor-not-allowed' : 'border-emerald-700 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-950/40'
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

      {/* PL Legend Bar */}
      {isPL && (
        <div className="fixed bottom-4 left-4 z-[400] flex gap-2">
          <div className="bg-slate-900/90 border border-slate-700 shadow-xl p-2 flex gap-3 items-center rounded">
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">FILTER</span>

            {/* Contractor Dropdown */}
            <div className="relative">
              <button
                id="pl-contractor-btn"
                onClick={(e) => { e.stopPropagation(); setPlContractorDropdownOpen(!plContractorDropdownOpen); setPlDisciplineDropdownOpen(false); }}
                className="flex items-center gap-2 bg-slate-800 border border-slate-600 px-2 py-1 hover:border-amber-400 transition-colors rounded min-w-[120px] justify-between"
              >
                <span className="text-xs font-bold text-white max-w-[100px] truncate">
                  {plSelectedContractorId ? plGetContractor(plSelectedContractorId)?.name : 'Contractors'}
                </span>
                <span className="text-[8px] text-slate-400">▼</span>
              </button>

              {plContractorDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-[1400]" onClick={() => setPlContractorDropdownOpen(false)} />
                  <div className="absolute bottom-full left-0 mb-[5px] w-48 bg-slate-900 border border-slate-700 shadow-xl rounded overflow-hidden flex flex-col z-[1500]">
                    <button
                      className={`px-3 py-2 text-left text-xs font-bold hover:bg-slate-800 ${!plSelectedContractorId ? 'text-amber-400' : 'text-slate-300'}`}
                      onClick={() => { setPlSelectedContractorId(null); setPlContractorDropdownOpen(false); }}
                    >
                      Contractors
                    </button>
                    {/* Dynamically Filtered List with Cross-Filtering */}
                    {plContractors
                      .filter(c => {
                        const used = new Set(plPunches.map(p => p.contractorId));
                        return used.has(c.id);
                      })
                      .map(c => {
                        // Cross-filter: check if this contractor has punches matching selected discipline
                        const isAvailable = !plSelectedDisciplineFilter || plPunches.some(
                          p => p.contractorId === c.id && p.discipline === plSelectedDisciplineFilter
                        );
                        return (
                          <button
                            key={c.id}
                            className={`px-3 py-2 text-left text-xs font-bold flex items-center gap-2 ${plSelectedContractorId === c.id ? 'text-amber-400' : 'text-slate-300'} ${isAvailable ? 'hover:bg-slate-800' : ''}`}
                            style={isAvailable ? {} : { opacity: 0.4, cursor: 'not-allowed', color: '#999' }}
                            onClick={() => {
                              if (isAvailable) {
                                setPlSelectedContractorId(c.id);
                                setPlContractorDropdownOpen(false);
                              }
                            }}
                          >
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                            {c.name}
                          </button>
                        );
                      })}
                  </div>
                </>
              )}
            </div>

            {/* Discipline Dropdown */}
            <div className="relative">
              <button
                id="pl-discipline-btn"
                onClick={(e) => { e.stopPropagation(); setPlDisciplineDropdownOpen(!plDisciplineDropdownOpen); setPlContractorDropdownOpen(false); }}
                className="flex items-center gap-2 bg-slate-800 border border-slate-600 px-2 py-1 hover:border-amber-400 transition-colors rounded min-w-[120px] justify-between"
              >
                <span className="text-xs font-bold text-white max-w-[100px] truncate">
                  {plSelectedDisciplineFilter || 'Disciplines'}
                </span>
                <span className="text-[8px] text-slate-400">▼</span>
              </button>

              {plDisciplineDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-[1400]" onClick={() => setPlDisciplineDropdownOpen(false)} />
                  <div className="absolute bottom-full left-0 mb-[5px] w-48 bg-slate-900 border border-slate-700 shadow-xl rounded overflow-hidden flex flex-col z-[1500]">
                    <button
                      className={`px-3 py-2 text-left text-xs font-bold hover:bg-slate-800 ${!plSelectedDisciplineFilter ? 'text-amber-400' : 'text-slate-300'}`}
                      onClick={() => { setPlSelectedDisciplineFilter(''); setPlDisciplineDropdownOpen(false); }}
                    >
                      Disciplines
                    </button>
                    {/* Dynamically Filtered List with Cross-Filtering */}
                    {plDisciplines
                      .filter(d => {
                        const used = new Set(plPunches.map(p => p.discipline).filter(Boolean));
                        return used.has(d.name);
                      })
                      .map(d => {
                        // Cross-filter: check if this discipline has punches matching selected contractor
                        const isAvailable = !plSelectedContractorId || plPunches.some(
                          p => p.discipline === d.name && p.contractorId === plSelectedContractorId
                        );
                        return (
                          <button
                            key={d.id}
                            className={`px-3 py-2 text-left text-xs font-bold ${plSelectedDisciplineFilter === d.name ? 'text-amber-400' : 'text-slate-300'} ${isAvailable ? 'hover:bg-slate-800' : ''}`}
                            style={isAvailable ? {} : { opacity: 0.4, cursor: 'not-allowed', color: '#999' }}
                            onClick={() => {
                              if (isAvailable) {
                                setPlSelectedDisciplineFilter(d.name);
                                setPlDisciplineDropdownOpen(false);
                              }
                            }}
                          >
                            {d.name}
                          </button>
                        );
                      })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
                  <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20c0-6.6-5.4-12-12-12z" fill="url(#popupPinGrad)" />
                  <circle cx="12" cy="11" r="5" fill="white" opacity="0.9" />
                  <circle cx="12" cy="11" r="3" fill="#dc2626" />
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

      {/* ─────────────────────────────────────────────────────────────────
          PUNCH LIST: Punch Edit Popup - Dark Industrial Theme
          ───────────────────────────────────────────────────────────────── */}
      {isPL && plEditingPunch && (() => {
        // Calculate popup position to avoid covering the punch point
        const popupWidth = 320;
        const popupHeight = 400;
        const margin = 20;
        let popupX = (plPopupPosition?.x || window.innerWidth / 2) + margin;
        let popupY = (plPopupPosition?.y || window.innerHeight / 2) - popupHeight / 2;

        // Adjust if would go off-screen right
        if (popupX + popupWidth > window.innerWidth - margin) {
          popupX = (plPopupPosition?.x || window.innerWidth / 2) - popupWidth - margin;
        }
        // Adjust if would go off-screen bottom
        if (popupY + popupHeight > window.innerHeight - margin) {
          popupY = window.innerHeight - popupHeight - margin;
        }
        // Adjust if would go off-screen top
        if (popupY < margin) {
          popupY = margin;
        }

        return (
          <div
            className="punch-popup-overlay"
            onClick={() => {
              setPlEditingPunch(null);
              setPlPunchText('');
              setPlPunchContractorId(null);
              setPlPunchDiscipline('');
              setPlPunchPhotoDataUrl(null);
              setPlPunchPhotoName('');
              setPlPopupPosition(null);
            }}
          >
            <div
              className="punch-popup-compact"
              onClick={(e) => e.stopPropagation()}
              style={{ left: popupX, top: popupY }}
            >
              <div
                className="punch-popup-header-compact punch-popup-draggable"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startLeft = popupX;
                  const startTop = popupY;

                  const onMouseMove = (ev) => {
                    const dx = ev.clientX - startX;
                    const dy = ev.clientY - startY;
                    setPlPopupPosition({ x: startLeft + dx - 20, y: startTop + dy + 160 });
                  };

                  const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                  };

                  document.addEventListener('mousemove', onMouseMove);
                  document.addEventListener('mouseup', onMouseUp);
                }}
              >
                <h3>
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-white/40"
                    style={{ backgroundColor: plGetContractor(plPunchContractorId)?.color || '#888' }}
                  />
                  Punch
                </h3>
                <button
                  className="punch-close-btn-compact"
                  onClick={() => {
                    setPlEditingPunch(null);
                    setPlPunchText('');
                    setPlPunchContractorId(null);
                    setPlPunchPhotoDataUrl(null);
                    setPlPunchPhotoName('');
                    setPlPopupPosition(null);
                  }}
                >
                  ×
                </button>
              </div>

              {/* Contractor selector */}
              <div className="punch-form-row-compact">
                <select
                  className="punch-select-compact"
                  value={plPunchContractorId || ''}
                  onChange={(e) => setPlPunchContractorId(e.target.value || null)}
                >
                  <option value="">Contractor...</option>
                  {plContractors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Discipline selector */}
              <div className="punch-form-row-compact">
                <select
                  className="punch-select-compact"
                  value={plPunchDiscipline || ''}
                  onChange={(e) => setPlPunchDiscipline(e.target.value || '')}
                >
                  <option value="">Discipline...</option>
                  {plDisciplines.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>


              {/* Photo section */}
              <div className="punch-photo-section-compact">
                <input
                  ref={plPunchPhotoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    handlePlPunchPhotoSelected(file);
                    e.target.value = '';
                  }}
                />
                <button
                  className="punch-btn-photo-compact"
                  onClick={() => plPunchPhotoInputRef.current?.click()}
                  type="button"
                >
                  📷
                </button>
                {plPunchPhotoDataUrl && (
                  <button
                    className="punch-btn-remove-photo-compact"
                    onClick={() => {
                      setPlPunchPhotoDataUrl(null);
                      setPlPunchPhotoName('');
                    }}
                    type="button"
                  >
                    ✕
                  </button>
                )}
              </div>

              {plPunchPhotoDataUrl && (
                <div
                  className="punch-photo-preview-medium"
                  onClick={(e) => {
                    // Open lightbox on click
                    e.stopPropagation();
                    // Position lightbox dynamically - offset from popup
                    const lightboxX = popupX + 280;
                    const lightboxY = popupY;
                    // If would go off-screen right, put it on the left
                    const finalX = lightboxX + 350 > window.innerWidth ? popupX - 370 : lightboxX;
                    setPlPhotoLightbox({ url: plPunchPhotoDataUrl, name: plPunchPhotoName, x: finalX, y: lightboxY });
                  }}
                  title="Click to enlarge"
                >
                  <img src={plPunchPhotoDataUrl} alt={plPunchPhotoName || 'Punch attachment'} draggable={false} />
                  <div className="punch-photo-zoom-hint">🔍 Click to enlarge</div>
                </div>
              )}

              {/* Description */}
              <div className="punch-form-row-compact">
                <textarea
                  className="punch-textarea-compact"
                  value={plPunchText}
                  onChange={(e) => setPlPunchText(e.target.value)}
                  placeholder="Description..."
                  autoFocus
                />
              </div>

              {/* Actions - compact */}
              <div className="punch-actions-compact">
                <button className="punch-btn-delete-compact" onClick={() => plDeletePunch(plEditingPunch.id)} title="Delete">
                  🗑️
                </button>
                {!plEditingPunch.completed ? (
                  <button
                    className="punch-btn-done-compact"
                    onClick={() => plMarkPunchCompleted(plEditingPunch.id)}
                    title="Mark as completed"
                  >
                    ✓
                  </button>
                ) : (
                  <button
                    className="punch-btn-uncomplete-compact"
                    onClick={() => plMarkPunchUncompleted(plEditingPunch.id)}
                    title="Mark as uncompleted"
                  >
                    ↩
                  </button>
                )}
                <button className="punch-btn-save-compact" onClick={plSavePunch} title="Save">
                  💾
                </button>
              </div>

              {plEditingPunch.completed && (
                <div className="punch-completed-badge">✓ COMPLETED</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Photo Lightbox - enlarged view */}
      {isPL && plPhotoLightbox && (
        <div
          className="punch-lightbox-overlay"
          onClick={() => setPlPhotoLightbox(null)}
        >
          <div
            className="punch-lightbox"
            style={{ left: plPhotoLightbox.x, top: plPhotoLightbox.y }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              e.preventDefault();

              // Middle mouse button (button === 1) = pan the image
              if (e.button === 1) {
                const startX = e.clientX;
                const startY = e.clientY;
                const startPanX = plPhotoLightbox.panX || 0;
                const startPanY = plPhotoLightbox.panY || 0;

                const onMouseMove = (ev) => {
                  const dx = ev.clientX - startX;
                  const dy = ev.clientY - startY;
                  setPlPhotoLightbox(prev => ({ ...prev, panX: startPanX + dx, panY: startPanY + dy }));
                };

                const onMouseUp = () => {
                  document.removeEventListener('mousemove', onMouseMove);
                  document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
                return;
              }

              // Left mouse button = drag the lightbox
              const startX = e.clientX;
              const startY = e.clientY;
              const startLeft = plPhotoLightbox.x;
              const startTop = plPhotoLightbox.y;

              const onMouseMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                setPlPhotoLightbox(prev => ({ ...prev, x: startLeft + dx, y: startTop + dy }));
              };

              const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
              };

              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            }}
            onWheel={(e) => {
              // Mouse wheel zoom
              e.preventDefault();
              e.stopPropagation();
              const delta = e.deltaY > 0 ? -0.1 : 0.1; // scroll down = zoom out, scroll up = zoom in
              setPlPhotoLightbox(prev => ({
                ...prev,
                zoom: Math.min(3, Math.max(0.5, (prev.zoom || 1) + delta))
              }));
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              className="punch-lightbox-close"
              onClick={() => setPlPhotoLightbox(null)}
            >
              ×
            </button>
            <div className="punch-lightbox-content">
              <img
                src={plPhotoLightbox.url}
                alt={plPhotoLightbox.name || 'Punch attachment'}
                style={{
                  transform: `scale(${plPhotoLightbox.zoom || 1}) translate(${(plPhotoLightbox.panX || 0) / (plPhotoLightbox.zoom || 1)}px, ${(plPhotoLightbox.panY || 0) / (plPhotoLightbox.zoom || 1)}px)`
                }}
                draggable={false}
              />
            </div>
            <div className="punch-lightbox-zoom-hint">
              🖱️ Scroll: Zoom ({Math.round((plPhotoLightbox.zoom || 1) * 100)}%) | Middle click + drag: Pan
            </div>
            <div className="punch-lightbox-caption">{plPhotoLightbox.name}</div>
          </div>
        </div>
      )}

      {/* PL Submit Modal */}
      {isPL && plShowSubmitModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-[400px] border-2 border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h2 className="mb-4 text-xl font-bold text-white">Submit Punch List</h2>
            <div className="mb-4 text-sm text-slate-300">
              <p>This will create a snapshot of the current punches in History.</p>
              <p>Current punches will remain on the map.</p>
              <div className="mt-2 text-xs">
                Open: {plPunches.filter(p => !p.completed).length},
                Completed: {plPunches.filter(p => p.completed).length}
              </div>
            </div>
            <div className="mb-6">
              <label className="mb-1 block text-xs font-bold uppercase text-slate-400">Punch List Name / Reference</label>
              <input
                type="text"
                className="w-full border border-slate-600 bg-slate-800 px-3 py-2 text-white outline-none focus:border-amber-400"
                placeholder="e.g. Block A Inspection 1"
                value={plSubmitName}
                onChange={(e) => setPlSubmitName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white"
                onClick={() => setPlShowSubmitModal(false)}
              >
                Cancel
              </button>
              <button
                className="bg-amber-600 px-6 py-2 text-sm font-bold text-white hover:bg-amber-500"
                onClick={plSubmitPunchList}
              >
                Submit Snapshot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PL History Panel (Draggable, Non-blocking) - DISABLED (Obsolete) */}
      {isPL && historyOpen && false && (() => {
        const viewingRecord = plViewingHistoryId ? plHistory.find(r => r.id === plViewingHistoryId) : null;

        return (
          <div
            className="fixed z-[1900] h-[650px] w-[950px] flex flex-col border-2 border-slate-700 bg-slate-900 shadow-2xl"
            style={{ left: plHistoryPos.x, top: plHistoryPos.y }}
          >
            {/* Draggable Header */}
            <div
              className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-3 cursor-move select-none"
              onMouseDown={plHistoryDragStart}
            >
              <div className="flex items-center gap-3">
                {viewingRecord && (
                  <button
                    className="text-slate-400 hover:text-white text-lg"
                    onClick={() => setPlViewingHistoryId(null)}
                    title="Back to list"
                  >
                    ←
                  </button>
                )}
                <h2 className="text-lg font-bold text-white">
                  {viewingRecord ? viewingRecord.name : 'Punch List History'}
                </h2>
              </div>
              <button
                className="text-slate-400 hover:text-white text-xl"
                onClick={() => { setHistoryOpen(false); setPlViewingHistoryId(null); }}
              >
                ✕
              </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto">
              {!viewingRecord ? (
                /* ═══════════════ ALL HISTORY SUMMARY VIEW ═══════════════ */
                <div className="p-4">
                  {plHistory.filter(h => !plActiveListId || h.punchListId === plActiveListId).length === 0 ? (
                    <div className="py-12 text-center text-slate-500">No history records found for this list.</div>
                  ) : (
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-800 text-slate-300 text-left">
                          <th className="px-3 py-2 border-b border-slate-700 font-semibold">Punch List</th>
                          <th className="px-3 py-2 border-b border-slate-700 font-semibold">First Created</th>
                          <th className="px-3 py-2 border-b border-slate-700 font-semibold">Last Updated</th>
                          <th className="px-3 py-2 border-b border-slate-700 font-semibold text-center">Total Punch</th>
                          <th className="px-3 py-2 border-b border-slate-700 font-semibold text-center">Open</th>
                          <th className="px-3 py-2 border-b border-slate-700 font-semibold text-center">Closed</th>
                          <th className="px-3 py-2 border-b border-slate-700 font-semibold text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plHistory.filter(h => !plActiveListId || h.punchListId === plActiveListId).map(record => (
                          <tr
                            key={record.id}
                            className="hover:bg-slate-800/50 cursor-pointer"
                            onClick={() => setPlViewingHistoryId(record.id)}
                          >
                            <td className="px-3 py-2 border-b border-slate-700 text-white font-medium">{record.name}</td>
                            <td className="px-3 py-2 border-b border-slate-700 text-slate-400">{new Date(record.createdAt).toLocaleString()}</td>
                            <td className="px-3 py-2 border-b border-slate-700 text-slate-400">{new Date(record.updatedAt || record.createdAt).toLocaleString()}</td>
                            <td className="px-3 py-2 border-b border-slate-700 text-center text-white">{record.punches?.length || 0}</td>
                            <td className="px-3 py-2 border-b border-slate-700 text-center text-red-400">{record.openCount || 0}</td>
                            <td className="px-3 py-2 border-b border-slate-700 text-center text-emerald-400">{record.closedCount || 0}</td>
                            <td className="px-3 py-2 border-b border-slate-700 text-center" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => setPlViewingHistoryId(record.id)}
                                className="bg-slate-700 px-2 py-1 text-xs font-bold text-white hover:bg-slate-600 mr-1"
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                /* ═══════════════ SINGLE PUNCH LIST DETAIL VIEW ═══════════════ */
                <div className="p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-400">Created: {new Date(viewingRecord.createdAt).toLocaleString()}</div>
                      <div className="mt-1 text-sm">
                        <span className="mr-4 text-red-400">Open: {viewingRecord.openCount || 0}</span>
                        <span className="text-emerald-400">Closed: {viewingRecord.closedCount || 0}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => plExportHistoryRecord(viewingRecord.id, 'excel')}
                        className="bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600"
                      >
                        Export Excel
                      </button>
                      <button
                        onClick={() => plExportHistoryRecord(viewingRecord.id, 'pdf')}
                        className="bg-red-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600"
                      >
                        Export PDF
                      </button>
                    </div>
                  </div>

                  {/* Punches Table */}
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-800 text-slate-300 text-left">
                        <th className="px-3 py-2 border-b border-slate-700 font-semibold">Punch No</th>
                        <th className="px-3 py-2 border-b border-slate-700 font-semibold">Date & Time</th>
                        <th className="px-3 py-2 border-b border-slate-700 font-semibold">Contractor</th>
                        <th className="px-3 py-2 border-b border-slate-700 font-semibold">Discipline</th>
                        <th className="px-3 py-2 border-b border-slate-700 font-semibold">Description</th>
                        <th className="px-3 py-2 border-b border-slate-700 font-semibold text-center">Photo</th>
                        <th className="px-3 py-2 border-b border-slate-700 font-semibold text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(viewingRecord.punches || []).map((punch, idx) => (
                        <tr key={punch.id || idx} className="hover:bg-slate-800/30">
                          <td className="px-3 py-2 border-b border-slate-700 text-white font-mono">{punch.punchNo || `#${idx + 1}`}</td>
                          <td className="px-3 py-2 border-b border-slate-700 text-slate-400">{punch.createdAt ? new Date(punch.createdAt).toLocaleString() : '-'}</td>
                          <td className="px-3 py-2 border-b border-slate-700">
                            <span className="flex items-center gap-2">
                              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: punch.contractorColor || '#888' }}></span>
                              <span className="text-white">{punch.contractorName || '-'}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 border-b border-slate-700 text-slate-300">{punch.discipline || '-'}</td>
                          <td className="px-3 py-2 border-b border-slate-700 text-slate-400 max-w-[200px] truncate">{punch.description || '-'}</td>
                          <td className="px-3 py-2 border-b border-slate-700 text-center">
                            {punch.photoUrl ? (
                              <a href={punch.photoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-xs">View</a>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2 border-b border-slate-700 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                plTogglePunchStatus(viewingRecord.id, punch.id);
                              }}
                              className={`px-2 py-0.5 text-xs font-bold rounded border transition-colors border-transparent ${punch.completed ? 'bg-emerald-900/50 text-emerald-400 hover:border-emerald-500' : 'bg-slate-800 text-slate-400 hover:border-slate-500 hover:text-white'}`}
                              title={punch.completed ? 'Mark as Open' : 'Mark as Closed'}
                            >
                              {punch.completed ? 'Closed' : 'Open'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(!viewingRecord.punches || viewingRecord.punches.length === 0) && (
                    <div className="py-8 text-center text-slate-500">No punches in this list.</div>
                  )}
                </div>
              )}
            </div>

            {/* Footer with Export All Summary */}
            <div className="border-t border-slate-700 bg-slate-800 px-4 py-3 flex justify-between items-center">
              <div className="text-xs text-slate-400">
                {viewingRecord
                  ? `${viewingRecord.punches?.length || 0} punch(es)`
                  : `${plHistory.length} punch list(s)`}
              </div>
              {!viewingRecord && plHistory.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => plExportAllHistorySummary('excel')}
                    className="bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600"
                  >
                    Export All Summary (Excel)
                  </button>
                  <button
                    onClick={() => plExportAllHistorySummary('pdf')}
                    className="bg-red-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600"
                  >
                    Export All Summary (PDF)
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ─────────────────────────────────────────────────────────────────
          PUNCH LIST: Contractor Dropdown Menu (appears below button)
          ───────────────────────────────────────────────────────────────── */}


      {/* ─────────────────────────────────────────────────────────────────
          PUNCH LIST: Isometric Side Panel (fixed right panel, map stays interactive)
          ───────────────────────────────────────────────────────────────── */}
      {
        isPL && plIsometricOpen && plIsometricTableId && (
          <div
            className="fixed right-0 w-[380px] z-[1100] bg-slate-900 border-l-2 border-slate-700 shadow-2xl flex flex-col"
            style={{ pointerEvents: 'auto', top: '60px', height: 'calc(100vh - 60px)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800 flex-shrink-0">
              <div className="flex flex-col">
                <span className="text-white font-bold text-sm uppercase tracking-wide">Isometric</span>
                <span className="text-amber-400 font-mono text-base font-bold">{plIsometricTableId}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-[11px]">
                  {plPunches.filter(p => p.tableId === plIsometricTableId).length} punch
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPlIsometricOpen(false);
                    setPlIsometricTableId(null);
                  }}
                  className="text-slate-400 hover:text-white text-xl font-bold leading-none"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Contractor Selector */}
            <div className="px-3 py-2 border-b border-slate-700 bg-slate-800/50">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-[10px] uppercase">Contractor:</span>
                <select
                  className="flex-1 border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-400 rounded"
                  value={plSelectedContractorId || ''}
                  onChange={(e) => setPlSelectedContractorId(e.target.value || null)}
                >
                  <option value="">Select...</option>
                  {plContractors.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {plSelectedContractorId && (
                  <span
                    className="w-4 h-4 rounded-full border border-white/40"
                    style={{ backgroundColor: plGetContractor(plSelectedContractorId)?.color || '#888' }}
                  />
                )}
              </div>
            </div>

            {/* Isometric content area with zoom/pan */}
            <div className="flex-1 overflow-hidden p-3 flex flex-col gap-2">
              {/* Isometric PNG with clickable punch points, zoom & pan support */}
              <div
                className="relative flex-1 border border-slate-600 rounded overflow-hidden bg-slate-800"
                style={{ minHeight: '300px' }}
                onWheel={(e) => {
                  e.preventDefault();
                  const container = e.currentTarget;
                  const inner = container.querySelector('[data-iso-inner]');
                  if (!inner) return;

                  // Get current transform values
                  const currentScale = parseFloat(inner.dataset.scale || '1');
                  const currentX = parseFloat(inner.dataset.panX || '0');
                  const currentY = parseFloat(inner.dataset.panY || '0');

                  // Calculate zoom
                  const delta = e.deltaY > 0 ? 0.9 : 1.1;
                  const newScale = Math.min(Math.max(currentScale * delta, 0.5), 5);

                  // Get mouse position relative to container
                  const rect = container.getBoundingClientRect();
                  const mouseX = e.clientX - rect.left;
                  const mouseY = e.clientY - rect.top;

                  // Adjust pan to zoom towards mouse position
                  const scaleChange = newScale / currentScale;
                  const newX = mouseX - (mouseX - currentX) * scaleChange;
                  const newY = mouseY - (mouseY - currentY) * scaleChange;

                  inner.dataset.scale = String(newScale);
                  inner.dataset.panX = String(newX);
                  inner.dataset.panY = String(newY);
                  inner.style.transform = `translate(${newX}px, ${newY}px) scale(${newScale})`;
                }}
                onMouseDown={(e) => {
                  // Only middle mouse button (button 1) for pan
                  if (e.button !== 1) return;
                  e.preventDefault();
                  const container = e.currentTarget;
                  const inner = container.querySelector('[data-iso-inner]');
                  if (!inner) return;

                  const startX = e.clientX;
                  const startY = e.clientY;
                  const startPanX = parseFloat(inner.dataset.panX || '0');
                  const startPanY = parseFloat(inner.dataset.panY || '0');

                  const onMouseMove = (ev) => {
                    const dx = ev.clientX - startX;
                    const dy = ev.clientY - startY;
                    const newX = startPanX + dx;
                    const newY = startPanY + dy;
                    const scale = parseFloat(inner.dataset.scale || '1');

                    inner.dataset.panX = String(newX);
                    inner.dataset.panY = String(newY);
                    inner.style.transform = `translate(${newX}px, ${newY}px) scale(${scale})`;
                  };

                  const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                  };

                  document.addEventListener('mousemove', onMouseMove);
                  document.addEventListener('mouseup', onMouseUp);
                }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {/* Fit button - top right corner of image */}
                <button
                  type="button"
                  onClick={() => {
                    const inner = plIsoInnerRef.current;
                    if (inner) {
                      inner.dataset.scale = '1';
                      inner.dataset.panX = '0';
                      inner.dataset.panY = '0';
                      inner.style.transform = 'translate(0px, 0px) scale(1)';
                    }
                  }}
                  className="absolute top-2 right-2 z-10 flex items-center justify-center w-7 h-7 bg-slate-700/80 hover:bg-slate-600 border border-slate-500 rounded transition-colors"
                  title="Fit to screen"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                </button>
                <div
                  ref={plIsoInnerRef}
                  data-iso-inner="true"
                  data-scale="1"
                  data-pan-x="0"
                  data-pan-y="0"
                  className="absolute inset-0 origin-top-left cursor-crosshair"
                  style={{ transform: 'translate(0px, 0px) scale(1)' }}
                  onClick={(e) => {
                    // Don't create punch on middle click
                    if (e.button === 1) return;

                    // Get click position relative to the inner container, accounting for transform
                    const inner = e.currentTarget;
                    const scale = parseFloat(inner.dataset.scale || '1');
                    const panX = parseFloat(inner.dataset.panX || '0');
                    const panY = parseFloat(inner.dataset.panY || '0');

                    const rect = inner.parentElement.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const clickY = e.clientY - rect.top;

                    // Convert to original coordinates
                    const x = ((clickX - panX) / scale / rect.width) * 100;
                    const y = ((clickY - panY) / scale / rect.height) * 100;

                    // Only create punch if click is within bounds
                    if (x < 0 || x > 100 || y < 0 || y > 100) return;

                    // Check if contractor is selected (use ref for reliability)
                    const currentContractorId = plSelectedContractorIdRef.current;
                    if (!currentContractorId) {
                      // Show warning toast
                      const toast = document.createElement('div');
                      toast.className = 'punch-warning-toast';
                      toast.innerHTML = '⚠️ Please select a contractor first!';
                      document.body.appendChild(toast);
                      setTimeout(() => toast.remove(), 2500);
                      return;
                    }

                    // Get next punch number using ref (always current) and increment both ref and state
                    const nextNumber = plPunchCounterRef.current + 1;
                    plPunchCounterRef.current = nextNumber; // Update ref immediately for next call
                    setPlPunchCounter(nextNumber); // Update state for persistence

                    // Create punch with isometric position (no popup - click on dot to edit)
                    const punch = {
                      id: `punch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                      lat: 0,
                      lng: 0,
                      contractorId: currentContractorId,
                      text: '',
                      photoDataUrl: null,
                      photoName: '',
                      tableId: plIsometricTableId,
                      isoX: x,
                      isoY: y,
                      createdAt: new Date().toISOString(),
                      punchNumber: nextNumber // Permanent number - never changes
                    };
                    setPlPunches(prev => [...prev, punch]);
                  }}
                >
                  <img
                    src="/PUNCH_LIST/photo/table.png"
                    alt="Table Isometric"
                    className="w-full h-full object-contain"
                    draggable={false}
                    onError={(e) => {
                      console.error('Failed to load isometric image');
                      e.target.style.display = 'none';
                    }}
                  />
                  {/* Punch markers on isometric */}
                  {plPunches
                    .filter(p => p.tableId === plIsometricTableId && p.isoX != null && p.isoY != null)
                    .map((p) => {
                      const c = plGetContractor(p.contractorId);
                      // Use green for completed punches
                      const dotColor = p.completed ? PUNCH_COMPLETED_COLOR : (c?.color || '#888');
                      const isIsoEditing = plEditingPunch?.id === p.id;
                      return (
                        <div
                          key={p.id}
                          className={`absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-transform ${isIsoEditing ? 'scale-150 z-50' : 'hover:scale-150'}`}
                          style={{
                            left: `${p.isoX}%`,
                            top: `${p.isoY}%`,
                            ...(isIsoEditing ? { animation: 'punch-editing-pulse 1s ease-in-out infinite' } : {}),
                          }}
                          title={`${c?.name || 'No contractor'}: ${p.text || '(no description)'}${p.completed ? ' ✓ COMPLETED' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPlEditingPunch(p);
                            setPlPunchText(p.text || '');
                            setPlPunchContractorId(p.contractorId);
                            setPlPunchDiscipline(p.discipline || '');
                            setPlPunchPhotoDataUrl(p.photoDataUrl || null);
                            setPlPunchPhotoName(p.photoName || '');
                          }}
                        >
                          <div
                            className={`w-full h-full rounded-full border shadow-md ${isIsoEditing ? 'border-2 border-yellow-400' : 'border border-white'}`}
                            style={{ backgroundColor: dotColor }}
                          />
                          {p.completed && (
                            <span className="absolute -top-1 -right-1 text-[8px] text-white font-bold">✓</span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Instructions */}
              <div className="text-slate-500 text-[10px] text-center py-1">
                Scroll to zoom • Middle-click drag to pan • Click to add punch
              </div>
            </div>

            {/* Close button at bottom */}
            <div className="px-3 py-2 border-t border-slate-700 bg-slate-800">
              <button
                type="button"
                onClick={() => {
                  setPlIsometricOpen(false);
                  setPlIsometricTableId(null);
                }}
                className="w-full border border-slate-600 bg-slate-700 px-3 py-2 text-[11px] font-bold uppercase text-white hover:bg-slate-600 rounded"
              >
                Close
              </button>
            </div>
          </div>
        )
      }

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
            const activeSegments = mvfActiveSegmentKeysRef.current || new Set();

            // Check if there's anything to submit
            if (toCommitParts.length === 0 && activeSegments.size === 0) {
              alert('No selections to submit. Please select cable routes.');
              return;
            }

            // Calculate meters: from trench parts + from selected segments (via CSV)
            let meters = 0;
            const partIds = [];
            const segmentIds = [];

            // Add meters from trench parts
            toCommitParts.forEach((p) => {
              meters += (Number(p?.meters) || 0) * (mvfCircuitsMultiplier || 1);
              partIds.push(String(p?.id || ''));
            });

            // Add meters from selected segments (full routes from CSV)
            activeSegments.forEach((segKey) => {
              const segLen = Number(mvfSegmentLenByKeyRef.current?.[segKey]) || 0;
              meters += segLen;
              segmentIds.push(`segment:${segKey}`);
            });

            if (recordDate && toCommitParts.length > 0) {
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
            }

            // Save record with selectedPolygonIds for history highlighting
            const recordWithSelections = {
              ...record,
              total_cable: meters,
              notes: notesOnDate,
              selectedPolygonIds: [...partIds, ...segmentIds], // MVF uses part IDs + segment IDs for history
            };
            addRecord(recordWithSelections);

            // Clear current selection after submit (submit button disables until new selection)
            setMvfSelectedTrenchParts([]);
            setMvfActiveSegmentKeys(new Set());

            alert('Work submitted successfully!');
            return;
          }

          // LV: submit ONLY the NEW (unsubmitted) inv_id selections (same behavior as DC: non-cumulative per submit)
          if (isLV) {
            const committed = lvCommittedInvIdsRef.current || new Set();
            const newInvIds = new Set();
            (lvCompletedInvIdsRef.current || lvCompletedInvIds).forEach((invIdNorm) => {
              const id = normalizeId(invIdNorm);
              if (!committed.has(id)) newInvIds.add(id);
            });

            if (newInvIds.size === 0) {
              alert('No new selections to submit. Please select new areas.');
              return;
            }

            let meters = 0;
            newInvIds.forEach((invIdNorm) => {
              const data = lengthData[normalizeId(invIdNorm)];
              if (data?.plus?.length) meters += data.plus.reduce((a, b) => a + b, 0);
            });

            const recordWithSelections = {
              ...record,
              total_cable: meters,
              notes: notesOnDate,
              // Reuse key name for history highlight (LV uses inv_id norms here)
              selectedPolygonIds: Array.from(newInvIds),
            };
            addRecord(recordWithSelections);

            setLvCommittedInvIds((prev) => {
              const next = new Set(prev);
              newInvIds.forEach((id) => next.add(id));
              // keep ref in sync immediately (handlers can fire before next render)
              lvCommittedInvIdsRef.current = next;
              return next;
            });

            alert('Work submitted successfully!');
            return;
          }

          // MC4: Submit panel state selections (MC4 Install or Cable Termination)
          if (isMC4) {
            const currentStates = mc4PanelStatesRef.current || {};
            const mode = mc4SelectionModeRef.current || 'mc4';

            const invKeys = Object.keys(mc4InvTerminationByInvRef.current || {}).filter((k) => {
              const n = Number(mc4InvTerminationByInvRef.current?.[k] ?? 0) || 0;
              return n > 0;
            });

            const panelKeys = Object.keys(currentStates).filter((k) => {
              const st = currentStates[k];
              if (mode === 'termination_panel') {
                return st?.left === MC4_PANEL_STATES.TERMINATED || st?.right === MC4_PANEL_STATES.TERMINATED;
              }
              return st?.left === MC4_PANEL_STATES.MC4 || st?.right === MC4_PANEL_STATES.MC4 || st?.left === MC4_PANEL_STATES.TERMINATED || st?.right === MC4_PANEL_STATES.TERMINATED;
            });

            // Persist per-day submitted totals so Submit Daily Work is not cumulative.
            try {
              const invDoneNow = (() => {
                const byInv = mc4InvTerminationByInvRef.current || {};
                let sum = 0;
                for (const [k, v] of Object.entries(byInv)) {
                  const invNorm = normalizeId(k);
                  const max = Math.max(0, Number(mc4InvMaxByInvRef.current?.[invNorm] ?? 0) || 0);
                  const n = Math.max(0, Number(v) || 0);
                  sum += max > 0 ? Math.min(max, n) : n;
                }
                return sum;
              })();

              const doneNow = mode === 'termination_panel'
                ? (Number(mc4Counts?.terminatedCompleted) || 0)
                : mode === 'termination_inv'
                  ? invDoneNow
                  : (Number(mc4Counts?.mc4Completed) || 0);

              const prev = mc4SubmittedCountsRef.current || { mc4: 0, termination_panel: 0, termination_inv: 0 };
              const key = mode === 'termination_panel' ? 'termination_panel' : mode === 'termination_inv' ? 'termination_inv' : 'mc4';
              const nextSubmitted = { ...prev, [key]: doneNow };
              localStorage.setItem(mc4SubmittedStorageKey, JSON.stringify(nextSubmitted));
              setMc4SubmittedCounts(nextSubmitted);
              mc4SubmittedCountsRef.current = nextSubmitted;
            } catch (_e) {
              void _e;
            }

            const recordWithSelections = {
              ...record,
              notes: notesOnDate,
              selectedPolygonIds: mode === 'termination_inv' ? invKeys : panelKeys, // MC4 uses string keys
            };
            addRecord(recordWithSelections);
            alert('Work submitted successfully!');
            return;
          }

          // DCTT: Submit panel termination states or inv termination counts
          if (isDCTT) {
            const currentStates = dcttPanelStatesRef.current || {};
            const mode = dcttSelectionModeRef.current || 'termination_panel';

            const invKeys = Object.keys(dcttInvTerminationByInvRef.current || {}).filter((k) => {
              const n = Number(dcttInvTerminationByInvRef.current?.[k] ?? 0) || 0;
              return n > 0;
            });

            const panelKeys = Object.keys(currentStates).filter((k) => {
              const st = currentStates[k];
              return st?.left === DCTT_PANEL_STATES.TERMINATED || st?.right === DCTT_PANEL_STATES.TERMINATED;
            });

            // Persist per-day submitted totals so Submit Daily Work is not cumulative.
            try {
              const invDoneNow = (() => {
                const byInv = dcttInvTerminationByInvRef.current || {};
                let sum = 0;
                for (const [k, v] of Object.entries(byInv)) {
                  const invNorm = normalizeId(k);
                  const max = Math.max(0, Number(dcttInvMaxByInvRef.current?.[invNorm] ?? 0) || 0);
                  const n = Math.max(0, Number(v) || 0);
                  sum += max > 0 ? Math.min(max, n) : n;
                }
                return sum;
              })();

              const doneNow = mode === 'termination_panel'
                ? (Number(dcttCounts?.terminatedCompleted) || 0)
                : invDoneNow;

              const prev = dcttSubmittedCountsRef.current || { termination_panel: 0, termination_inv: 0 };
              const key = mode === 'termination_panel' ? 'termination_panel' : 'termination_inv';
              const nextSubmitted = { ...prev, [key]: doneNow };
              localStorage.setItem(dcttSubmittedStorageKey, JSON.stringify(nextSubmitted));
              setDcttSubmittedCounts(nextSubmitted);
              dcttSubmittedCountsRef.current = nextSubmitted;
            } catch (_e) {
              void _e;
            }

            const recordWithSelections = {
              ...record,
              notes: notesOnDate,
              selectedPolygonIds: mode === 'termination_inv' ? invKeys : panelKeys,
            };
            addRecord(recordWithSelections);

            // Lock submitted panel selections against right-click erase immediately.
            if (mode === 'termination_panel' && Array.isArray(panelKeys) && panelKeys.length > 0) {
              const nextCommitted = new Set(dcttCommittedPanelIdsRef.current || []);
              panelKeys.forEach((id) => nextCommitted.add(String(id)));
              dcttCommittedPanelIdsRef.current = nextCommitted;
            }
            alert('Work submitted successfully!');
            return;
          }

          // DATP: Submit trench part selections
          if (isDATP) {
            const parts = datpSelectedTrenchPartsRef.current || [];
            if (parts.length === 0) {
              alert('No selections to submit.');
              return;
            }
            const meters = parts.reduce((sum, p) => sum + (p?.meters || 0), 0);
            const partIds = parts.map((p) => String(p?.id || ''));

            const recordWithSelections = {
              ...record,
              total_cable: meters,
              notes: notesOnDate,
              selectedPolygonIds: partIds,
            };
            addRecord(recordWithSelections);

            // Clear selection after submit
            setDatpSelectedTrenchParts([]);
            alert('Work submitted successfully!');
            return;
          }

          // MVFT: Submit trench part selections
          if (isMVFT) {
            const parts = mvftSelectedTrenchPartsRef.current || [];
            if (parts.length === 0) {
              alert('No selections to submit.');
              return;
            }
            const meters = parts.reduce((sum, p) => sum + (p?.meters || 0), 0);
            const partIds = parts.map((p) => String(p?.id || ''));

            const recordWithSelections = {
              ...record,
              total_cable: meters,
              notes: notesOnDate,
              selectedPolygonIds: partIds,
            };
            addRecord(recordWithSelections);

            // Commit submitted parts (LV-like): keep them in the main completed set.
            setMvftCommittedTrenchParts((prev) => {
              const base = Array.isArray(prev) ? prev : [];
              const seen = new Set(base.map((p) => String(p?.id || '')));
              const next = [...base];
              parts.forEach((p) => {
                const id = String(p?.id || '');
                if (!id || seen.has(id)) return;
                seen.add(id);
                next.push(p);
              });
              return next;
            });

            // Clear ONLY the draft selection after submit
            setMvftSelectedTrenchParts([]);
            alert('Work submitted successfully!');
            return;
          }

          // PTEP: Submit table-to-table or parameter selections
          if (isPTEP) {
            const mode = ptepSubModeRef.current || 'tabletotable';
            if (mode === 'tabletotable') {
              const completed = ptepCompletedTableToTableRef.current || new Set();
              if (completed.size === 0) {
                alert('No selections to submit.');
                return;
              }
              const recordWithSelections = {
                ...record,
                notes: notesOnDate,
                selectedPolygonIds: Array.from(completed),
              };
              addRecord(recordWithSelections);
              // Clear after submit
              setPtepCompletedTableToTable(new Set());
            } else {
              const parts = ptepSelectedParameterPartsRef.current || [];
              if (parts.length === 0) {
                alert('No selections to submit.');
                return;
              }
              const meters = parts.reduce((sum, p) => sum + (p?.meters || 0), 0);
              const partIds = parts.map((p) => String(p?.id || ''));
              const recordWithSelections = {
                ...record,
                total_cable: meters,
                notes: notesOnDate,
                selectedPolygonIds: partIds,
              };
              addRecord(recordWithSelections);
              // Clear after submit
              setPtepSelectedParameterParts([]);
            }
            alert('Work submitted successfully!');
            return;
          }

          // MVT: Submit station termination counts
          if (isMVT) {
            const terminations = mvtTerminationByStationRef.current || {};
            const stationIds = Object.entries(terminations)
              .map(([k, v]) => {
                const kk = mvtCanonicalTerminationStationNorm(k);
                const vv = clampMvtTerminationCount(kk, v);
                return vv > 0 ? kk : null;
              })
              .filter(Boolean);
            if (stationIds.length === 0) {
              alert('No terminations to submit.');
              return;
            }
            const totalCables = Object.entries(terminations).reduce((sum, [k, v]) => sum + clampMvtTerminationCount(k, v), 0);
            const recordWithSelections = {
              ...record,
              total_cable: totalCables,
              notes: notesOnDate,
              selectedPolygonIds: stationIds,
            };
            addRecord(recordWithSelections);
            alert('Work submitted successfully!');
            return;
          }

          // LVTT: Submit inv termination counts (termination mode only)
          if (isLVTT && String(lvttSubModeRef.current || 'termination') === 'termination') {
            const terminations = lvttTerminationByInvRef.current || {};
            const invIds = Object.keys(terminations).filter((k) => (terminations[k] || 0) > 0);
            if (invIds.length === 0) {
              alert('No terminations to submit.');
              return;
            }
            const totalCables = Object.values(terminations).reduce((sum, v) => sum + Math.max(0, Math.min(3, Number(v) || 0)), 0);
            const recordWithSelections = {
              ...record,
              total_cable: totalCables,
              notes: notesOnDate,
              selectedPolygonIds: invIds,
            };
            addRecord(recordWithSelections);
            alert('Work submitted successfully!');
            return;
          }

          // Calculate ONLY the NEW polygons (not previously submitted)
          const newPolygonIds = new Set();
          selectedPolygons.forEach((id) => {
            if (!committedPolygonsRef.current.has(id)) {
              newPolygonIds.add(id);
            }
          });

          // If no new polygons, show error
          if (newPolygonIds.size === 0) {
            alert('No new selections to submit. Please select new areas.');
            return;
          }

          // Calculate work amount ONLY for NEW polygons
          let newWorkAmount = 0;
          if (isDC) {
            const stringIds = new Set();
            newPolygonIds.forEach((polygonId) => {
              const polygonInfo = polygonById.current[polygonId];
              if (polygonInfo && polygonInfo.stringId) {
                stringIds.add(normalizeId(polygonInfo.stringId));
              }
            });
            let plus = 0;
            let minus = 0;
            stringIds.forEach((stringId) => {
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
            newWorkAmount = plus + minus;
          } else {
            // For other modules: count new polygons
            newWorkAmount = newPolygonIds.size;
          }

          // Store only NEW polygon IDs with the record
          const recordWithSelections = {
            ...record,
            total_cable: newWorkAmount,
            notes: notesOnDate,
            selectedPolygonIds: Array.from(newPolygonIds),
          };
          addRecord(recordWithSelections);

          // Add new polygons to committed set (so they won't be counted again)
          setCommittedPolygons((prev) => {
            const next = new Set(prev);
            newPolygonIds.forEach((id) => next.add(id));
            // IMPORTANT: keep ref in sync immediately (Leaflet click handlers can run before next render)
            committedPolygonsRef.current = next;
            return next;
          });

          alert('Work submitted successfully!');
        }}
        moduleKey={isMC4
          ? (mc4SelectionMode === 'termination_panel'
            ? 'MC4_TERM_PANEL'
            : (mc4SelectionMode === 'termination_inv'
              ? 'MC4_TERM_INV'
              : 'MC4_INST'))
          : (isDCTT
            ? (dcttSelectionMode === 'termination_panel' ? 'DCTT_TERM_PANEL' : 'DCTT_TERM_INV')
            : (isDATP
              ? 'DATP'
              : (isMVFT
                ? 'MVFT'
                : (isPTEP
                  ? (ptepSubMode === 'tabletotable' ? 'PTEP_TT' : 'PTEP_PARAM')
                  : (isMVT
                    ? 'MVT_TERM'
                    : (isLVTT && String(lvttSubMode || 'termination') === 'termination')
                      ? 'LVTT_TERM'
                      : (activeMode?.key || ''))))))}
        moduleLabel={isMC4
          ? (mc4SelectionMode === 'termination_panel'
            ? 'Cable Termination Panel Side'
            : (mc4SelectionMode === 'termination_inv'
              ? 'Cable Termination Inv. Side'
              : 'MC4 Installation'))
          : (isDCTT
            ? (dcttSelectionMode === 'termination_panel' ? 'DC Termination Panel Side' : 'DC Termination Inv. Side')
            : (isDATP
              ? 'DC&AC Trench'
              : (isMVFT
                ? 'MV&Fibre Trench'
                : (isPTEP
                  ? (ptepSubMode === 'tabletotable' ? 'Table-to-Table Earthing' : 'Parameter Earthing')
                  : (isMVT
                    ? 'Cable Termination'
                    : (isLVTT && String(lvttSubMode || 'termination') === 'termination')
                      ? 'Cable Termination'
                      : moduleName)))))}
        workAmount={isDCTT
          ? (dcttSelectionMode === 'termination_panel'
            ? (dcttCounts?.terminatedCompleted || 0)
            : Object.values(dcttInvTerminationByInv || {}).reduce((sum, v) => sum + (Number(v) || 0), 0))
          : isDATP
            ? datpCompletedForSubmit
            : isMVFT
              ? mvftCompletedForSubmit
              : isPTEP
                ? ptepCompletedForSubmit
                : isMVT
                  ? mvtCompletedForSubmit
                  : isLVTT && String(lvttSubMode || 'termination') === 'termination'
                    ? lvttCompletedForSubmit
                    : workAmount
        }
        workUnit={
          isMC4
            ? (mc4SelectionMode === 'termination_panel' || mc4SelectionMode === 'termination_inv' ? 'cables terminated' : 'mc4')
            : isDCTT
              ? 'mc4 terminated'
              : isDATP
                ? datpWorkUnit
                : isMVFT
                  ? mvftWorkUnit
                  : isPTEP
                    ? ptepWorkUnit
                    : isMVT
                      ? 'cables terminated'
                      : isLVTT && String(lvttSubMode || 'termination') === 'termination'
                        ? lvttWorkUnit
                        : activeMode?.submitWorkUnit
                          ? String(activeMode.submitWorkUnit)
                          : activeMode?.workUnitWeights
                            ? 'panels'
                            : (typeof activeMode?.simpleCounterUnit === 'string' ? String(activeMode.simpleCounterUnit) : 'm')
        }
      />

      {/* History Panel - Draggable, non-blocking (Generic + PL Master-Detail) */}
      {
        historyOpen && (
          <div
            ref={historyPanelRef}
            className="history-panel"
            style={{
              transform: `translate(${historyPanelPos.x}px, ${historyPanelPos.y}px)`,
              cursor: historyDragging ? 'grabbing' : 'default',
              width: isPL ? '90vw' : undefined,
              height: isPL ? '85vh' : undefined,
              maxWidth: isPL ? 'none' : undefined,
              maxHeight: isPL ? 'none' : undefined
            }}
          >
            <div
              className="history-panel-header"
              style={{ cursor: historyDragging ? 'grabbing' : 'grab' }}
              onMouseDown={(e) => {
                if (e.target.closest('button')) return;
                setHistoryDragging(true);
                historyDragOffset.current = {
                  x: e.clientX - historyPanelPos.x,
                  y: e.clientY - historyPanelPos.y
                };
              }}
              onTouchStart={(e) => {
                if (e.target.closest('button')) return;
                const touch = e.touches[0];
                setHistoryDragging(true);
                historyDragOffset.current = {
                  x: touch.clientX - historyPanelPos.x,
                  y: touch.clientY - historyPanelPos.y
                };
              }}
            >
              <div className="history-panel-title">{isPL ? '📋 Punch List Summary' : '📊 Work History'}</div>
              <div className="history-panel-actions">
                <button
                  className="history-panel-close"
                  onClick={() => {
                    setHistoryOpen(false);
                    setHistorySelectedRecordId(null);
                    if (isPL) setPlSummaryViewMode('summary');
                  }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Mouse/Touch move handlers for dragging */}
            {historyDragging && (
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 99999, cursor: 'grabbing' }}
                onMouseMove={(e) => {
                  setHistoryPanelPos({
                    x: e.clientX - historyDragOffset.current.x,
                    y: e.clientY - historyDragOffset.current.y
                  });
                }}
                onMouseUp={() => setHistoryDragging(false)}
                onTouchMove={(e) => {
                  const touch = e.touches[0];
                  setHistoryPanelPos({
                    x: touch.clientX - historyDragOffset.current.x,
                    y: touch.clientY - historyDragOffset.current.y
                  });
                }}
                onTouchEnd={() => setHistoryDragging(false)}
              />
            )}

            {/* Punch List Summary Table (isPL mode) */}
            {isPL ? (
              <div className="pl-summary-table" style={{ padding: '12px', overflowX: 'auto' }}>
                {plSummaryViewMode === 'summary' ? (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #475569' }}>
                          {[
                            { key: 'name', label: 'Punch List' },
                            { key: 'createdAt', label: 'First Created' },
                            { key: 'updatedAt', label: 'Last Updated' },
                            { key: 'total', label: 'Total' },
                            { key: 'open', label: 'Open' },
                            { key: 'closed', label: 'Closed' },
                          ].map(col => (
                            <th
                              key={col.key}
                              onClick={() => {
                                if (plSummarySortBy === col.key) {
                                  setPlSummarySortOrder(o => o === 'asc' ? 'desc' : 'asc');
                                } else {
                                  setPlSummarySortBy(col.key);
                                  setPlSummarySortOrder('asc');
                                }
                              }}
                              style={{
                                padding: '8px 6px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                color: plSummarySortBy === col.key ? '#fbbf24' : '#94a3b8',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {col.label} {plSummarySortBy === col.key && (plSummarySortOrder === 'desc' ? '↓' : '↑')}
                            </th>
                          ))}
                          <th style={{ padding: '8px 6px', textAlign: 'center', color: '#94a3b8' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const rows = plLists.map(l => {
                            const punches = l.punches || [];
                            const total = punches.length;
                            const closed = punches.filter(p => p.completed || p.status === 'closed').length;
                            const open = total - closed;
                            return { ...l, total, open, closed };
                          });

                          const mult = plSummarySortOrder === 'desc' ? -1 : 1;
                          rows.sort((a, b) => {
                            let av, bv;
                            if (plSummarySortBy === 'name') {
                              av = String(a.name || '').toLowerCase();
                              bv = String(b.name || '').toLowerCase();
                              return mult * av.localeCompare(bv);
                            }
                            if (plSummarySortBy === 'createdAt') {
                              av = a.createdAt || 0;
                              bv = b.createdAt || 0;
                            } else if (plSummarySortBy === 'updatedAt') {
                              av = a.updatedAt || 0;
                              bv = b.updatedAt || 0;
                            } else if (plSummarySortBy === 'total') {
                              av = a.total;
                              bv = b.total;
                            } else if (plSummarySortBy === 'open') {
                              av = a.open;
                              bv = b.open;
                            } else if (plSummarySortBy === 'closed') {
                              av = a.closed;
                              bv = b.closed;
                            } else {
                              av = 0; bv = 0;
                            }
                            return mult * (av - bv);
                          });

                          if (rows.length === 0) {
                            return (
                              <tr>
                                <td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                                  No punch lists found
                                </td>
                              </tr>
                            );
                          }

                          return rows.map(row => {
                            const formatDate = (ts) => {
                              if (!ts) return '-';
                              return new Date(ts).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                            };
                            const isActive = row.id === plActiveListId;

                            // Row interaction: Click to drill down (Master -> Detail)
                            return (
                              <tr
                                key={row.id}
                                style={{
                                  borderBottom: '1px solid #334155',
                                  backgroundColor: isActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                                  cursor: 'pointer'
                                }}
                                onClick={() => {
                                  setPlActiveListId(row.id);
                                  setPlSummaryViewMode('detail');
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.15)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent'}
                              >
                                <td style={{ padding: '8px 6px', color: isActive ? '#60a5fa' : '#e2e8f0', fontWeight: isActive ? 'bold' : 'normal' }}>
                                  {row.name} {isActive && <span style={{ fontSize: '10px', marginLeft: '4px' }}>✓</span>}
                                </td>
                                <td style={{ padding: '8px 6px', color: '#94a3b8' }}>{formatDate(row.createdAt)}</td>
                                <td style={{ padding: '8px 6px', color: '#94a3b8' }}>{formatDate(row.updatedAt)}</td>
                                <td style={{ padding: '8px 6px', textAlign: 'center', color: '#e2e8f0' }}>{row.total}</td>
                                <td style={{ padding: '8px 6px', textAlign: 'center', color: '#f87171' }}>{row.open}</td>
                                <td style={{ padding: '8px 6px', textAlign: 'center', color: '#4ade80' }}>{row.closed}</td>
                                <td style={{ padding: '8px 6px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                  <button
                                    title="Rename"
                                    onClick={() => {
                                      setPlEditingListId(row.id);
                                    }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', marginRight: '8px' }}
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    title="Delete"
                                    onClick={() => plDeleteList(row.id)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
                                  >
                                    🗑️
                                  </button>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <div style={{ padding: '8px 0' }}>
                    <button
                      type="button"
                      onClick={() => setPlSummaryViewMode('summary')}
                      style={{
                        background: 'none',
                        border: '1px solid #475569',
                        borderRadius: '4px',
                        padding: '6px 12px',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        fontSize: '11px',
                        marginBottom: '12px'
                      }}
                    >
                      ← Back to Summary
                    </button>

                    {/* Active List Name */}
                    <div style={{ marginBottom: '12px', fontSize: '13px', fontWeight: 'bold', color: '#fbbf24' }}>
                      {plLists.find(l => l.id === plActiveListId)?.name || 'Punch List'}
                    </div>

                    {/* Punch Detail Table */}
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', minWidth: '500px' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #475569' }}>
                            <th style={{ padding: '6px 4px', textAlign: 'left', color: '#94a3b8', fontWeight: 'bold' }}>Punch No</th>
                            <th style={{ padding: '6px 4px', textAlign: 'left', color: '#94a3b8', fontWeight: 'bold' }}>Date</th>
                            <th style={{ padding: '6px 4px', textAlign: 'left', color: '#94a3b8', fontWeight: 'bold' }}>Discipline</th>
                            <th style={{ padding: '6px 4px', textAlign: 'left', color: '#94a3b8', fontWeight: 'bold', maxWidth: '120px' }}>Description</th>
                            <th style={{ padding: '6px 4px', textAlign: 'center', color: '#94a3b8', fontWeight: 'bold' }}>Photo</th>
                            <th style={{ padding: '6px 4px', textAlign: 'center', color: '#94a3b8', fontWeight: 'bold' }}>Status</th>
                            <th style={{ padding: '6px 4px', textAlign: 'center', color: '#94a3b8', fontWeight: 'bold' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const punches = plPunches.slice().sort((a, b) => (a.punchNumber || 0) - (b.punchNumber || 0));

                            if (punches.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                                    No punches in this list
                                  </td>
                                </tr>
                              );
                            }

                            return punches.map(punch => {
                              const contractor = plGetContractor(punch.contractorId);
                              const contractorColor = contractor?.color || '#94a3b8';
                              const formatDate = (ts) => {
                                if (!ts) return '-';
                                return new Date(ts).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                              };
                              const disc = activeMode?.punchListDisciplines?.find(d => d.id === punch.disciplineId);
                              const discCode = disc?.code || '-';

                              return (
                                <tr key={punch.id} style={{ borderBottom: '1px solid #334155' }}>
                                  <td
                                    style={{ padding: '6px 4px', color: '#60a5fa', cursor: 'pointer', textDecoration: 'underline' }}
                                    onClick={() => {
                                      // Pan to punch and highlight
                                      plHighlightPunchOnMap(punch);
                                      // Close history panel to see map? Optional. For now keep open.
                                    }}
                                    title="View on Map"
                                  >
                                    {punch.punchNumber || '-'}
                                  </td>
                                  <td style={{ padding: '6px 4px', color: '#cbd5e1' }}>{formatDate(punch.createdAt)}</td>
                                  <td style={{ padding: '6px 4px', color: contractorColor, fontWeight: 'bold' }}>
                                    {discCode}
                                  </td>
                                  <td style={{ padding: '6px 4px', color: '#cbd5e1', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={punch.description}>
                                    {punch.description || '-'}
                                  </td>
                                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                                    {punch.photos && punch.photos.length > 0 ? '📷' : '-'}
                                  </td>
                                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                                    {punch.completed ? <span style={{ color: '#4ade80' }}>Closed</span> : <span style={{ color: '#f87171' }}>Open</span>}
                                  </td>
                                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                                    <button
                                      title="Delete Punch"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        plDeleteSinglePunch(punch.id);
                                      }}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
                                    >
                                      🗑️
                                    </button>
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (

              <>
                <div className="history-sort">
                  <span>Sort:</span>
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
                    className={`sort-btn ${historySortBy === 'amount' ? 'active' : ''}`}
                    onClick={() => {
                      if (historySortBy === 'amount') setHistorySortOrder(o => o === 'asc' ? 'desc' : 'asc');
                      else { setHistorySortBy('amount'); setHistorySortOrder('desc'); }
                    }}
                  >
                    Amount {historySortBy === 'amount' && (historySortOrder === 'desc' ? '↓' : '↑')}
                  </button>
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
                      if (historySortBy === 'amount') return recs.reduce((s, r) => s + (r.total_cable || 0), 0);
                      return new Date(d).getTime();
                    };

                    dates.sort((a, b) => mult * (dateMetric(a) - dateMetric(b)));

                    if (dates.length === 0) {
                      return <div className="history-empty">No work records or notes yet</div>;
                    }

                    return dates.map((d) => {
                      const recs = [...(recordsByDate[d] || [])];
                      const dayNotes = [...(notesByDate[d] || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                      const dateLabel = new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

                      return (
                        <div key={d} className="history-day">
                          <div className="history-day-header">
                            <span className="history-day-date">{dateLabel}</span>
                          </div>

                          {recs.map((record) => {
                            const isSelected = historySelectedRecordId === record.id;
                            const recordPolygonIds = record.selectedPolygonIds || [];

                            return (
                              <div
                                key={record.id}
                                className={`history-item ${isSelected ? 'history-item-selected' : ''}`}
                                onClick={() => {
                                  // Toggle select/deselect for orange highlight on map
                                  if (historySelectedRecordId === record.id) {
                                    setHistorySelectedRecordId(null);
                                  } else {
                                    setHistorySelectedRecordId(record.id);
                                  }
                                }}
                              >
                                <div className="history-item-header">
                                  <span className="history-subcontractor">{record.subcontractor}</span>
                                  <button
                                    className="history-item-delete"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (window.confirm('Delete this record?')) {
                                        // LV records store inv_id norms in selectedPolygonIds
                                        if (isLV) {
                                          setLvCommittedInvIds((prev) => {
                                            const next = new Set(prev);
                                            recordPolygonIds.forEach((id) => next.delete(normalizeId(id)));
                                            lvCommittedInvIdsRef.current = next;
                                            return next;
                                          });
                                          setLvCompletedInvIds((prev) => {
                                            const next = new Set(prev);
                                            recordPolygonIds.forEach((id) => next.delete(normalizeId(id)));
                                            return next;
                                          });
                                        } else if (isMVF) {
                                          // MVF: remove committed trench parts by ID
                                          setMvfCommittedTrenchParts((prev) => {
                                            const idsToRemove = new Set(recordPolygonIds);
                                            return prev.filter((p) => !idsToRemove.has(String(p?.id || '')));
                                          });
                                          mvfCommittedTrenchPartsRef.current = (mvfCommittedTrenchPartsRef.current || []).filter(
                                            (p) => !recordPolygonIds.includes(String(p?.id || ''))
                                          );

                                          // MVF/FIBRE: unselect submitted segments when history record is deleted
                                          const segKeys = recordPolygonIds
                                            .map((id) => String(id || ''))
                                            .filter((id) => id.startsWith('segment:'))
                                            .map((id) => id.replace('segment:', ''))
                                            .filter(Boolean);
                                          if (segKeys.length > 0) {
                                            setMvfDoneSegmentKeys((prev) => {
                                              const next = new Set(prev);
                                              segKeys.forEach((k) => next.delete(String(k)));
                                              return next;
                                            });
                                            setMvfActiveSegmentKeys((prev) => {
                                              const next = new Set(prev);
                                              segKeys.forEach((k) => next.delete(String(k)));
                                              return next;
                                            });
                                          }
                                        } else if (isMVFT) {
                                          // MVFT: remove committed trench parts by ID
                                          setMvftCommittedTrenchParts((prev) => {
                                            const idsToRemove = new Set(recordPolygonIds.map(String));
                                            const base = Array.isArray(prev) ? prev : [];
                                            return base.filter((p) => !idsToRemove.has(String(p?.id || '')));
                                          });
                                          mvftCommittedTrenchPartsRef.current = (mvftCommittedTrenchPartsRef.current || []).filter(
                                            (p) => !recordPolygonIds.map(String).includes(String(p?.id || ''))
                                          );
                                        } else if (isDCTT) {
                                          // DCTT: allow removal ONLY via History by clearing panel states for polygon IDs.
                                          const idsToRemove = recordPolygonIds
                                            .map((id) => String(id || ''))
                                            .filter((id) => Boolean(id) && Boolean(polygonById.current?.[id]));

                                          if (idsToRemove.length > 0) {
                                            setDcttPanelStates((prev) => {
                                              const out = { ...(prev || {}) };
                                              idsToRemove.forEach((id) => {
                                                delete out[id];
                                              });
                                              return out;
                                            });

                                            // Keep committed ref in sync immediately.
                                            const nextCommitted = new Set(dcttCommittedPanelIdsRef.current || []);
                                            idsToRemove.forEach((id) => nextCommitted.delete(id));
                                            dcttCommittedPanelIdsRef.current = nextCommitted;
                                          }
                                        } else {
                                          // Remove from committedPolygons
                                          setCommittedPolygons((prev) => {
                                            const next = new Set(prev);
                                            recordPolygonIds.forEach((id) => next.delete(id));
                                            return next;
                                          });
                                          // Also remove from selectedPolygons (make them disappear from map)
                                          setSelectedPolygons((prev) => {
                                            const next = new Set(prev);
                                            recordPolygonIds.forEach((id) => next.delete(id));
                                            return next;
                                          });
                                        }
                                        deleteRecord(record.id);
                                        if (historySelectedRecordId === record.id) {
                                          setHistorySelectedRecordId(null);
                                        }
                                      }
                                    }}
                                    title="Delete record"
                                  >
                                    🗑️
                                  </button>
                                </div>

                                <div className="history-item-stats">
                                  <div className="stat">
                                    <span>{record.workers} workers</span>
                                  </div>
                                  <div className="stat stat-total">
                                    <span>
                                      {(record.total_cable || 0).toFixed(0)} {record.unit || 'm'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}

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
              </>
            )}
          </div >
        )
      }
    </div >
  );
}

// FORCE POINTER EVENTS FIX FOR PUNCH LIST AND TOASTS
const plStyleFix = document.createElement('style');
plStyleFix.innerHTML = `
  /* 
    CRITICAL FIX: Leaflet Marker Pane blocks events by default.
    We must DISABLE pointer events on the pane, but ENABLE them on the markers.
  */
  .leaflet-marker-pane {
    pointer-events: none !important;
  }
  .leaflet-marker-icon {
    pointer-events: auto !important;
  }
  /* Ensure punch warning toast is visible and non-blocking */
  .punch-warning-toast {
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(220, 38, 38, 0.9);
    color: white;
    padding: 12px 24px;
    border-radius: 4px;
    font-weight: bold;
    z-index: 9999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    pointer-events: none;
    animation: fadeInOut 2.5s ease-in-out;
  }
  @keyframes fadeInOut {
    0% { opacity: 0; transform: translate(-50%, -20px); }
    10% { opacity: 1; transform: translate(-50%, 0); }
    90% { opacity: 1; transform: translate(-50%, 0); }
    100% { opacity: 0; transform: translate(-50%, -20px); }
  }
`;
document.head.appendChild(plStyleFix);
