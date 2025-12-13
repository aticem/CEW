import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import SubmitModal from './components/SubmitModal';
import useDailyLog from './hooks/useDailyLog';
import { useChartExport } from './hooks/useChartExport';

// ═══════════════════════════════════════════════════════════════
// CUSTOM CANVAS TEXT LABEL CLASS
// ═══════════════════════════════════════════════════════════════
L.TextLabel = L.CircleMarker.extend({
  options: {
    text: '',
    textStyle: '300',
    textColor: 'rgba(255,255,255,0.65)',
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
    const scale = Math.pow(2, zoom - this.options.refZoom);
    const fontSize = this.options.textBaseSize * scale;

    if (fontSize < 1) return;

    ctx.save();
    
    const rotationRad = (this.options.rotation || 0) * Math.PI / 180;
    ctx.translate(p.x, p.y);
    ctx.rotate(rotationRad);

    ctx.font = this.options.textStyle + ' ' + fontSize + 'px sans-serif';
    ctx.fillStyle = this.options.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Make text look less "bold/fill-heavy":
    // - A bright stroke thickens glyphs; use a thin dark stroke instead.
    // - Skip stroke at small sizes (expensive + visually noisy).
    if (fontSize >= 10) {
      ctx.lineWidth = Math.max(0.55, fontSize / 18);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(this.options.text, 0, 0);
    }
    
    ctx.fillText(this.options.text, 0, 0);
    
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
// MODES + DATA CONFIG
// ═══════════════════════════════════════════════════════════════
const MODES = {
  DC: {
    key: 'DC',
    label: 'DC CABLE PULLING PROGRESS',
    basePath: '/dc-cable-pulling-progress',
    csvPath: '/dc-cable-pulling-progress/dc_strings.csv',
    linkPath: '/dc-cable-pulling-progress/link',
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
        fillOpacity: 0.6
      }
    ]
  },
  LV: {
    key: 'LV',
    label: 'LV CABLE PULLING PROGRESS',
    basePath: '/LV_CABLE_PULLING _PROGRESS_TRACKING',
    csvPath: '/LV_CABLE_PULLING _PROGRESS_TRACKING/lv_pulling.csv',
    linkPath: '/LV_CABLE_PULLING _PROGRESS_TRACKING/link',
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
        fillOpacity: 0.6
      }
    ]
  }
};

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

const isPointInsideFeature = (lat, lng, geometry) => {
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
function App() {
  const [mode, setMode] = useState('DC'); // 'DC' | 'LV'
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const activeMode = MODES[mode] || MODES.DC;

  const mapRef = useRef(null);
  const layersRef = useRef([]);
  const polygonIdCounter = useRef(0); // Counter for unique polygon IDs
  const polygonById = useRef({}); // uniqueId -> {layer, stringId}
  const boxRectRef = useRef(null);
  const draggingRef = useRef(null);
  const rafRef = useRef(null);
  const stringTextPointsRef = useRef([]); // [{lat,lng,text,angle,stringId}]
  const stringTextLayerRef = useRef(null); // L.LayerGroup
  
  const [status, setStatus] = useState('Initializing map...');
  const [lengthData, setLengthData] = useState({}); // Length data from CSV
  const [stringPoints, setStringPoints] = useState([]); // String points (id, lat, lng)
  const [selectedPolygons, setSelectedPolygons] = useState(new Set()); // Selected polygon unique IDs
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

  const [selectedNotes, setSelectedNotes] = useState(new Set());
  const [editingNote, setEditingNote] = useState(null); // { id, lat, lng, text }
  const [noteText, setNoteText] = useState('');
  const [noteDate, setNoteDate] = useState(''); // YYYY-MM-DD
  const [notePhotoDataUrl, setNotePhotoDataUrl] = useState(null); // string | null
  const [notePhotoName, setNotePhotoName] = useState(''); // original filename (optional)
  const notePhotoInputRef = useRef(null);
  const noteMarkersRef = useRef({}); // id -> marker
  const markerClickedRef = useRef(false); // Track if a marker was just clicked

  const getTodayYmd = () => new Date().toISOString().split('T')[0];
  const getNoteYmd = (note) =>
    note?.noteDate ||
    (note?.createdAt ? new Date(note.createdAt).toISOString().split('T')[0] : getTodayYmd());

  // Performance knobs (labels are the #1 cost in this app)
  const STRING_LABEL_MIN_ZOOM = 18; // only render string_text IDs when zoomed in
  const STRING_LABEL_MAX = 2500; // hard cap to avoid blowing up canvas on huge datasets
  const STRING_LABEL_PAD = 0.12; // smaller pad = fewer offscreen labels to build
  const STRING_LABEL_GRID_CELL_DEG = 0.001; // ~111m latitude; good speed/accuracy tradeoff

  // LV mode: keep string_text hidden until the mouse is over the map
  const stringLabelsEnabledRef = useRef(true);
  useEffect(() => {
    stringLabelsEnabledRef.current = mode === 'DC';
  }, [mode]);

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

      // LV mode: string_text labels are hidden unless explicitly enabled (hover over map)
      if (!stringLabelsEnabledRef.current) {
        // remove any active pooled labels from the layer
        const pool = stringTextLabelPoolRef.current;
        const prevActive = stringTextLabelActiveCountRef.current;
        for (let i = 0; i < prevActive; i++) {
          const lbl = pool[i];
          if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
        }
        stringTextLabelActiveCountRef.current = 0;
        lastStringLabelKeyRef.current = '';
        return;
      }

      if (zoom < STRING_LABEL_MIN_ZOOM) return;

      const bounds = map.getBounds().pad(STRING_LABEL_PAD);
      const key = `${zoom}|${bounds.getSouth().toFixed(5)},${bounds.getWest().toFixed(5)},${bounds.getNorth().toFixed(5)},${bounds.getEast().toFixed(5)}`;
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

      const iterateIndices = candidates.length ? candidates : null;
      const total = iterateIndices ? iterateIndices.length : points.length;
      for (let k = 0; k < total; k++) {
        if (count >= STRING_LABEL_MAX) break;
        const idx = iterateIndices ? iterateIndices[k] : k;
        const pt = points[idx];
        if (!pt) continue;
        if (!bounds.contains([pt.lat, pt.lng])) continue;

        // Create once, then reuse
        let label = pool[count];
        if (!label) {
          label = L.textLabel([pt.lat, pt.lng], {
            text: pt.text,
            renderer: canvasRenderer,
            textBaseSize: 11,
            refZoom: 20,
            textStyle: '300',
            textColor: 'rgba(255,255,255,0.92)',
            rotation: pt.angle || 0
          });
          pool[count] = label;
        }

        // Update position + text/rotation then ensure it's on the layer
        const nextLatLng = [pt.lat, pt.lng];
        label.setLatLng(nextLatLng);
        let needsRedraw = false;
        if (label.options.text !== pt.text) {
          label.options.text = pt.text;
          needsRedraw = true;
        }
        const nextRot = pt.angle || 0;
        if (label.options.rotation !== nextRot) {
          label.options.rotation = nextRot;
          needsRedraw = true;
        }
        if (!layer.hasLayer(label)) layer.addLayer(label);
        if (needsRedraw) label.redraw?.();

        count++;
      }

      // Remove unused pooled labels from the layer (but keep them for reuse)
      const prevActive = stringTextLabelActiveCountRef.current;
      for (let i = count; i < prevActive; i++) {
        const lbl = pool[i];
        if (lbl && layer.hasLayer(lbl)) layer.removeLayer(lbl);
      }
      stringTextLabelActiveCountRef.current = count;
    });
  }, []);
  
  // Hooks for daily log and export
  const { dailyLog, addRecord, resetLog } = useDailyLog();
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
          undoNotes();
          return;
        }
        if (isRedo) {
          e.preventDefault();
          redoNotes();
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
  }, [noteMode, selectedNotes]);
  
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

  // CSV load (mode-aware)
  useEffect(() => {
    const csvPath = activeMode.csvPath;
    if (!csvPath) return;

    fetch(csvPath)
      .then((res) => res.text())
      .then((text) => {
        const dict = {}; // id -> {plus: number[], minus: number[]}

        if (mode === 'DC') {
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
        } else {
          // LV CSV: tab-separated with columns: DI, *1, Length (Length is 3rd col)
          const lines = text.split(/\r?\n/).slice(1);
          lines.forEach((line) => {
            if (!line.trim()) return;
            const parts = line.split(/\t|,/);
            if (parts.length < 3) return;
            const id = normalizeId(parts[0]);
            const len = parseFloat(String(parts[2]).trim());
            if (!id || isNaN(len)) return;
            if (!dict[id]) dict[id] = { plus: [], minus: [] };
            // LV has no +/- separation; treat as "+" to keep UI identical
            dict[id].plus.push(len);
          });
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

        // Reset selection when switching modes (avoids mismatched IDs)
        setSelectedPolygons(new Set());
        setCompletedPlus(0);
        setCompletedMinus(0);
      })
      .catch((err) => console.error('CSV yüklenemedi:', err));
  }, [mode, activeMode.csvPath]);

  // Calculate counters when selection changes
  useEffect(() => {
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
  }, [selectedPolygons, lengthData]);

  // Store previous selection to compare changes
  const prevSelectedRef = useRef(new Set());

  // Update ONLY changed polygon colors (performance optimization)
  useEffect(() => {
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
  }, [selectedPolygons]);

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
    if (stringTextLayerRef.current) {
      try { stringTextLayerRef.current.remove(); } catch (e) {}
      stringTextLayerRef.current = null;
    }
    
    const allBounds = L.latLngBounds();
    let totalFeatures = 0;
    let textCount = 0;
    const collectedPoints = [];
    
    // String text'leri topla (text konumları için)
    const stringTextMap = {}; // stringId -> {lat, lng, angle, text}

    for (const file of activeMode.geojsonFiles) {
      try {
        const response = await fetch(file.url);
        if (!response.ok) continue;
        const data = await response.json();
        totalFeatures += data.features?.length || 0;

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
          
          stringLayer.addTo(mapRef.current);
          layersRef.current.push(stringLayer);
          continue;
        }
        
        // Special handling for full.geojson - tables will be selectable (MultiPolygon)
        if (file.name === 'full') {
          const fullLayer = L.geoJSON(data, {
            renderer: canvasRenderer,
            interactive: true,
            
            style: (feature) => ({
              color: 'rgba(255,255,255,0.35)',
              weight: 1.05,
              fill: false,
              fillOpacity: 0,
            }),
            
            onEachFeature: (feature, featureLayer) => {
              if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon' || feature.geometry.type === 'LineString')) {
                // Assign unique ID to this polygon
                const uniqueId = `polygon_${polygonIdCounter.current++}`;
                featureLayer._uniquePolygonId = uniqueId;
                
                // Store reference (will be updated with stringId and size later)
                polygonById.current[uniqueId] = {
                  layer: featureLayer,
                  stringId: null,
                  isSmallTable: false
                };
                
                // Add click events - left click to select
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
        const layer = L.geoJSON(data, {
          renderer: canvasRenderer,
          interactive: false,
          
          style: (feature) => {
            // Restore the "dim white" look for all layers, with a stronger LV box outline.
            if (file.name === 'lv_box') {
              return {
                color: 'rgba(255,255,255,0.95)',
                weight: 3.2,
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
        if (!p?.stringId || seen.has(p.stringId)) continue;
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
              } catch (e) {}
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
          const { featureLayer, bounds, center, geometry, isSmallTable } = polygonInfos[i];
          const matchesInside = [];
          const matchesNearby = [];

          const candidates = queryStringCandidates(bounds, center, isSmallTable);
          for (const c of candidates) {
            if (!isSmallTable && assignedToLargeTable.has(c.stringId)) continue;
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
            if (!isSmallTable) {
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
          setStatus(`Ready: ${totalFeatures} objects, ${textCount} labels, ${collectedPoints.length} selectable strings`);
        }
      };

      processBatch();
    }, 50);
  };

  // Box Selection event handlers - left click to select, right click to unselect
  useEffect(() => {
    if (!mapRef.current) return;
    
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
      
      draggingRef.current = {
        start: map.mouseEventToLatLng(e),
        startPoint: { x: e.clientX, y: e.clientY },
        isRightClick: e.button === 2,
        isDrag: false
      };
      map.dragging.disable();
    };
    
    const onMouseMove = (e) => {
      if (!draggingRef.current) return;
      
      // Check if moved enough to be a drag
      const dx = e.clientX - draggingRef.current.startPoint.x;
      const dy = e.clientY - draggingRef.current.startPoint.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        draggingRef.current.isDrag = true;
      }
      
      const current = map.mouseEventToLatLng(e);
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
    
    const onMouseUp = (e) => {
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
          // NORMAL MODE: Select polygons
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
        
        boxRectRef.current.remove();
        boxRectRef.current = null;
      } else if (!wasDrag && !isRightClick && noteMode) {
        // NOTE MODE: Create note on simple click (unless a marker click just happened)
        if (!markerClickedRef.current) {
          createNote(clickLatLng);
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
  }, [stringPoints, noteMode, notes]);

  useEffect(() => {
    mapRef.current = L.map('map', {
      zoomControl: false,
      preferCanvas: true,
      // Animations can feel laggy with lots of canvas layers
      zoomAnimation: false,
      markerZoomAnimation: false,
      fadeAnimation: false,
    });

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

    return () => {
      try {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        mapRef.current?.off('zoomend moveend', scheduleStringTextLabelUpdate);
      } catch (e) {}
      mapRef.current?.remove();
    };
  }, []);

  // Reload GeoJSON layers when mode changes (same UI, different dataset)
  useEffect(() => {
    if (!mapRef.current) return;
    fetchAllGeoJson();
    setModeMenuOpen(false);
  }, [mode]);

  // LV mode: show string_text labels only while mouse is over the map
  useEffect(() => {
    if (!mapRef.current) return;
    const el = mapRef.current.getContainer();
    if (!el) return;

    const onEnter = () => {
      if (mode !== 'LV') return;
      stringLabelsEnabledRef.current = true;
      scheduleStringTextLabelUpdate();
    };
    const onLeave = () => {
      if (mode !== 'LV') return;
      stringLabelsEnabledRef.current = false;
      scheduleStringTextLabelUpdate(); // clears active labels
    };

    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [mode, scheduleStringTextLabelUpdate]);

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

  const overallTotal = totalPlus + totalMinus;
  const completedTotal = completedPlus + completedMinus;
  const completedPct = overallTotal > 0 ? (completedTotal / overallTotal) * 100 : 0;
  const remainingPlus = Math.max(0, totalPlus - completedPlus);
  const remainingMinus = Math.max(0, totalMinus - completedMinus);
  const remainingTotal = Math.max(0, overallTotal - completedTotal);

  const [dwgUrl, setDwgUrl] = useState('');
  useEffect(() => {
    const linkPath = activeMode.linkPath;
    if (!linkPath) return;
    fetch(linkPath)
      .then((r) => r.text())
      .then((t) => setDwgUrl((t || '').trim()))
      .catch(() => setDwgUrl(linkPath));
  }, [activeMode.linkPath]);

  return (
    <div className="app">
      {/* Header with Buttons and Counters */}
      <div className="sticky top-0 left-0 z-[1100] w-full min-h-[92px] border-b-2 border-slate-700 bg-slate-900 px-4 py-0 sm:px-6 relative flex items-center">
        <div className="w-full">
        <div className="grid grid-cols-[1fr_auto] items-center gap-1">
          {/* Counters (left) */}
          <div className="flex min-w-0 items-stretch gap-3 overflow-x-auto pb-1 justify-self-start">
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

                <span className="text-xs font-black text-emerald-400">Completed ({completedPct.toFixed(2)}%)</span>
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
          </div>

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

            <button onClick={undoNotes} disabled={!canUndoNotes} className={BTN_SMALL_NEUTRAL} title="Undo (Ctrl+Z)" aria-label="Undo">
              <svg className={ICON_SMALL} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 14l-4-4 4-4" />
                <path d="M5 10h9a6 6 0 010 12h-1" />
              </svg>
            </button>

            <button onClick={redoNotes} disabled={!canRedoNotes} className={BTN_SMALL_NEUTRAL} title="Redo (Ctrl+Y / Ctrl+Shift+Z)" aria-label="Redo">
              <svg className={ICON_SMALL} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 14l4-4-4-4" />
                <path d="M19 10H10a6 6 0 000 12h1" />
              </svg>
            </button>

            <button
              onClick={() => setModalOpen(true)}
              disabled={selectedPolygons.size === 0 || noteMode}
              className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
              title="Submit Work"
              aria-label="Submit Work"
            >
              Submit
            </button>

            <button
              onClick={() => setHistoryOpen(true)}
              disabled={dailyLog.length === 0 && notes.length === 0}
              className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
              title="History"
              aria-label="History"
            >
              History
            </button>

            <button
              onClick={() => exportToExcel(dailyLog)}
              disabled={dailyLog.length === 0}
              className={`${BTN_NEUTRAL} w-auto min-w-14 h-6 px-2 leading-none text-[11px] font-extrabold uppercase tracking-wide`}
              title="Export Excel"
              aria-label="Export Excel"
            >
              Export
            </button>

            {dailyLog.length > 0 && (
              <button onClick={resetLog} className={BTN_DANGER} title="Reset All" aria-label="Reset All">
                <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Legend / DWG / Notes (right aligned, vertically centered on screen) */}
        <div className="fixed right-3 sm:right-5 top-[40%] -translate-y-1/2 z-[1090] flex flex-col items-end gap-2">
          <div className="border-2 border-slate-700 bg-slate-900 px-4 py-3 shadow-[0_10px_26px_rgba(0,0,0,0.55)]">
            <div className="text-base font-black uppercase tracking-wide text-white">Legend</div>
            <div className="mt-2 border-2 border-slate-700 bg-slate-800 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 border-2 border-white bg-transparent" aria-hidden="true" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-white">Uncompleted</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="h-3 w-3 border-2 border-emerald-300 bg-emerald-500" aria-hidden="true" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">Completed</span>
              </div>
            </div>
          </div>

          <a
             href={dwgUrl || activeMode.linkPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-6 items-center justify-center border-2 border-slate-700 bg-slate-900 px-2 text-[10px] font-extrabold uppercase tracking-wide text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            title="Open Original DWG"
          >
            Original DWG
          </a>
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
        DC CABLE PULLING PROGRESS TRACKING
      </div>

      <div className="map-wrapper">
        <div id="map" />
      </div>

      {/* Mode button (left), aligned with Legend (right) */}
      <div className="fixed left-3 sm:left-5 top-[40%] -translate-y-1/2 z-[1091]">
        <div className="relative">
          <button
            type="button"
            onClick={() => setModeMenuOpen((v) => !v)}
            aria-expanded={modeMenuOpen}
            aria-label="Mode"
            className="inline-flex h-10 w-10 items-center justify-center border-2 border-slate-700 bg-slate-900 text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>

          {modeMenuOpen && (
            <div className="absolute left-0 mt-2 w-72 border-2 border-slate-700 bg-slate-900 shadow-[0_10px_26px_rgba(0,0,0,0.55)]">
              <button
                type="button"
                onClick={() => setMode('DC')}
                className={`w-full border-b-2 border-slate-700 px-3 py-3 text-left text-xs font-extrabold uppercase tracking-wide ${
                  mode === 'DC' ? 'bg-amber-500 text-black' : 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                }`}
              >
                DC CABLE PULLING PROGRESS
              </button>
              <button
                type="button"
                onClick={() => setMode('LV')}
                className={`w-full px-3 py-3 text-left text-xs font-extrabold uppercase tracking-wide ${
                  mode === 'LV' ? 'bg-amber-500 text-black' : 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                }`}
              >
                LV CABLE PULLING PROGRESS
              </button>
            </div>
          )}
        </div>
      </div>
      
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
          addRecord({ ...record, notes: notesOnDate });
          alert('Work submitted successfully!');
        }}
        completedPlus={completedPlus}
        completedMinus={completedMinus}
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

export default App;
