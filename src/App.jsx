import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import SubmitModal from './components/SubmitModal';
import useDailyLog from './hooks/useDailyLog';
import { useChartExport } from './hooks/useChartExport';

// ═══════════════════════════════════════════════════════════════
// ÖZEL CANVAS TEXT LABEL SINIFI
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

    ctx.lineWidth = fontSize / 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.strokeText(this.options.text, 0, 0);
    
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
const canvasRenderer = L.canvas({ padding: 0.5 });

// ═══════════════════════════════════════════════════════════════
// GEOJSON DOSYALARI KONFİGÜRASYONU
// ═══════════════════════════════════════════════════════════════
const GEOJSON_FILES = [
  { 
    url: '/DC_CABLE_PULLING _PROGRESS_TRACKING/full.geojson',
    name: 'full',
    color: '#2563eb',
    fillColor: '#3b82f6'
  },
  { 
    url: '/DC_CABLE_PULLING _PROGRESS_TRACKING/string_text.geojson', 
    name: 'string_text', 
    color: '#dc2626', 
    fillColor: '#ef4444' 
  },
  { 
    url: '/DC_CABLE_PULLING _PROGRESS_TRACKING/inv_id.geojson', 
    name: 'inv_id', 
    color: '#16a34a', 
    fillColor: '#22c55e' 
  },
  { 
    url: '/DC_CABLE_PULLING _PROGRESS_TRACKING/lv_box.geojson', 
    name: 'lv_box', 
    color: '#eab308', 
    fillColor: '#facc15',
    weight: 3,
    fillOpacity: 0.6
  },
];

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
  const mapRef = useRef(null);
  const layersRef = useRef([]);
  const polygonIdCounter = useRef(0); // Counter for unique polygon IDs
  const polygonById = useRef({}); // uniqueId -> {layer, stringId}
  const boxRectRef = useRef(null);
  const draggingRef = useRef(null);
  
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
  const [notes, setNotes] = useState(() => {
    const saved = localStorage.getItem('cew_notes');
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedNotes, setSelectedNotes] = useState(new Set());
  const [editingNote, setEditingNote] = useState(null); // { id, lat, lng, text }
  const [noteText, setNoteText] = useState('');
  const noteMarkersRef = useRef({}); // id -> marker
  const markerClickedRef = useRef(false); // Track if a marker was just clicked
  
  // Hooks for daily log and export
  const { dailyLog, addRecord, resetLog } = useDailyLog();
  const { exportToExcel } = useChartExport();
  
  // Save notes to localStorage
  useEffect(() => {
    localStorage.setItem('cew_notes', JSON.stringify(notes));
  }, [notes]);
  
  // Render note markers on map
  useEffect(() => {
    if (!mapRef.current) return;
    
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
      
      marker.on('click', (e) => {
        e.originalEvent?.stopPropagation();
        L.DomEvent.stopPropagation(e);
        markerClickedRef.current = true;
        
        // Open popup immediately when marker is clicked
        setEditingNote(note);
        setNoteText(note.text || '');
        
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
  
  // Handle Delete key for selected notes
  useEffect(() => {
    const handleKeyDown = (e) => {
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
      createdAt: new Date().toISOString()
    };
    setNotes(prev => [...prev, newNote]);
    // Don't open popup on create - user clicks the marker to edit
  };
  
  // Save note text
  const saveNote = () => {
    if (!editingNote) return;
    setNotes(prev => prev.map(n => 
      n.id === editingNote.id ? { ...n, text: noteText } : n
    ));
    setEditingNote(null);
    setNoteText('');
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
  };
  
  // Delete all selected notes
  const deleteSelectedNotes = () => {
    if (selectedNotes.size === 0) return;
    const toDelete = new Set(selectedNotes);
    setNotes(prev => prev.filter(n => !toDelete.has(n.id)));
    setSelectedNotes(new Set());
  };

  // CSV yükle
  useEffect(() => {
    fetch('/DC_CABLE_PULLING _PROGRESS_TRACKING/dc_strings.csv')
      .then(res => res.text())
      .then(text => {
        const rows = text.split(/\r?\n/).slice(1);
        const dict = {}; // Her ID için {plus: [], minus: []} array'leri tutacak
        rows.forEach(r => {
          const parts = r.split(',');
          if (parts.length >= 2) {
            const id = normalizeId(parts[0]);
            const valStr = parts[1].trim();
            const length = parseFloat(valStr);
            
            if (id && !isNaN(length)) {
              if (!dict[id]) {
                dict[id] = { plus: [], minus: [] };
              }
              
              // Stricter check: if string starts with '-' or value is negative
              if (valStr.startsWith('-') || length < 0) {
                dict[id].minus.push(Math.abs(length));
              } else {
                dict[id].plus.push(length);
              }
            }
          }
        });
        setLengthData(dict);
        
        // Calculate total +/- DC Cable from all CSV data
        let allPlus = 0, allMinus = 0;
        Object.values(dict).forEach(data => {
          if (data.plus) allPlus += data.plus.reduce((a, b) => a + b, 0);
          if (data.minus) allMinus += data.minus.reduce((a, b) => a + b, 0);
        });
        setTotalPlus(allPlus);
        setTotalMinus(allMinus);
        
        console.log('CSV loaded:', Object.keys(dict).length, 'entries');
      })
      .catch(err => console.error('CSV yüklenemedi:', err));
  }, []);

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
        polygonInfo.layer.setStyle({
          color: isSelected ? '#22c55e' : '#2563eb',
          fillColor: isSelected ? '#22c55e' : '#3b82f6',
          fillOpacity: isSelected ? 0.7 : 0.4,
          weight: 2
        });
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
    
    const allBounds = L.latLngBounds();
    let totalFeatures = 0;
    let textCount = 0;
    const collectedPoints = [];
    
    // String text'leri topla (text konumları için)
    const stringTextMap = {}; // stringId -> {lat, lng, angle, text}

    for (const file of GEOJSON_FILES) {
      try {
        const response = await fetch(file.url);
        if (!response.ok) continue;
        const data = await response.json();
        totalFeatures += data.features?.length || 0;

        // Special handling for string_text - ONLY text labels (no red dots)
        if (file.name === 'string_text') {
          const stringLayer = L.layerGroup();
          
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
              
              // Create ONLY text label (NO red dot)
              textCount++;
              const label = L.textLabel([lat, lng], {
                text: feature.properties.text,
                renderer: canvasRenderer,
                textBaseSize: 12,
                refZoom: 20,
                textStyle: '500',
                textColor: '#222',
                rotation: feature.properties.angle || 0
              });
              label.addTo(stringLayer);
              
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
              color: '#2563eb',
              weight: 2,
              fillColor: '#3b82f6',
              fillOpacity: 0.4,
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
          
          style: (feature) => ({
            color: file.color,
            weight: file.weight || 1,
            fillColor: file.fillColor,
            fillOpacity: file.fillOpacity || 0.4,
          }),
          
          pointToLayer: (feature, latlng) => {
            if (feature.properties?.text) {
              textCount++;
              return L.textLabel(latlng, {
                text: feature.properties.text,
                renderer: canvasRenderer,
                textBaseSize: 12,
                refZoom: 20,
                textStyle: '500',
                textColor: '#222',
                rotation: feature.properties.angle || 0
              });
            }
            return L.circleMarker(latlng, { 
              renderer: canvasRenderer, 
              radius: 2 
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
                  textColor: '#333',
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

          Object.keys(stringTextMap).forEach(stringId => {
            if (!isSmallTable && assignedToLargeTable.has(stringId)) {
              return;
            }
            
            const pt = stringTextMap[stringId];
            const ptLatLng = L.latLng(pt.lat, pt.lng);
            const distToCenter = center.distanceTo(ptLatLng);
            
            // Fast check: bounds is enough for label matching; skip heavy geometry calc
            const insideBounds = bounds.contains(ptLatLng);

            if (insideBounds) {
              matchesInside.push({ stringId, dist: distToCenter });
              return;
            }
            
            if (isSmallTable && distToCenter < NEAR_DISTANCE_METERS) {
              matchesNearby.push({ stringId, dist: distToCenter });
            }
          });
          
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
            Object.keys(stringTextMap).forEach(stringId => {
              const pt = stringTextMap[stringId];
              const ptLatLng = L.latLng(pt.lat, pt.lng);
              const distToCenter = center.distanceTo(ptLatLng);
              if (distToCenter < LOOSE_DISTANCE_METERS) {
                if (!bestLoose || distToCenter < bestLoose.dist) {
                  bestLoose = { stringId, dist: distToCenter };
                }
              }
            });
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
    
    // Prevent default context menu only on map container
    const preventContextMenu = (e) => {
      e.preventDefault();
    };
    container.addEventListener('contextmenu', preventContextMenu);
    
    const onMouseDown = (e) => {
      if (e.button !== 0 && e.button !== 2) return; // Left or right click
      
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
      zoomControl: true,
      preferCanvas: true,
      zoomAnimation: true,
      markerZoomAnimation: true,
      fadeAnimation: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 23,
      maxNativeZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(mapRef.current);

    fetchAllGeoJson();

    return () => mapRef.current?.remove();
  }, []);

  // Seçimi temizle


  return (
    <div className="app">
      {/* Header with Buttons and Counters */}
      <div className="header">
        {/* Action Buttons on the left */}
        <div className="action-buttons">
          <button
            onClick={() => {
              setNoteMode(!noteMode);
              if (noteMode) setSelectedNotes(new Set());
            }}
            className={`btn-icon ${noteMode ? 'btn-icon-active' : ''}`}
            title={noteMode ? 'Exit Notes' : 'Notes'}
          >
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <ellipse cx="16" cy="28" rx="4" ry="2" fill="rgba(0,0,0,0.2)"/>
              <path d="M16 4C11.6 4 8 7.6 8 12c0 6 8 14 8 14s8-8 8-14c0-4.4-3.6-8-8-8z" fill="url(#pinGrad)" stroke="#b91c1c" strokeWidth="1"/>
              <circle cx="16" cy="12" r="3" fill="white"/>
              <defs>
                <linearGradient id="pinGrad" x1="8" y1="4" x2="24" y2="26">
                  <stop stopColor="#f87171"/>
                  <stop offset="1" stopColor="#dc2626"/>
                </linearGradient>
              </defs>
            </svg>
            {noteMode && selectedNotes.size > 0 && <span className="badge">{selectedNotes.size}</span>}
          </button>
          
          {noteMode && selectedNotes.size > 0 && (
            <button onClick={deleteSelectedNotes} className="btn-icon" title="Delete Selected">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          )}
          
          <div className="btn-divider"></div>
          
          <button
            onClick={() => setModalOpen(true)}
            disabled={selectedPolygons.size === 0 || noteMode}
            className={`btn-icon ${(selectedPolygons.size === 0 || noteMode) ? 'disabled' : ''}`}
            title="Submit Work"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12l2 2 4-4"/>
              <circle cx="12" cy="12" r="10"/>
            </svg>
            {selectedPolygons.size > 0 && <span className="badge">{selectedPolygons.size}</span>}
          </button>
          
          <button
            onClick={() => setHistoryOpen(true)}
            disabled={dailyLog.length === 0}
            className={`btn-icon ${dailyLog.length === 0 ? 'disabled' : ''}`}
            title="History"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            {dailyLog.length > 0 && <span className="badge">{dailyLog.length}</span>}
          </button>
          
          <button
            onClick={() => exportToExcel(dailyLog)}
            disabled={dailyLog.length === 0}
            className={`btn-icon ${dailyLog.length === 0 ? 'disabled' : ''}`}
            title="Export Excel"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>

          {dailyLog.length > 0 && (
            <button onClick={resetLog} className="btn-icon" title="Reset All">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </button>
          )}
        </div>
        
        {/* Counters on the right */}
        <div className="counters">
        <div className="counter-group">
          <div className="group-title">Total</div>
          <div className="counter positive">
            <span className="counter-label">+DC Cable</span>
            <span className="counter-value">{totalPlus.toFixed(0)} m</span>
          </div>
          <div className="counter negative">
            <span className="counter-label">-DC Cable</span>
            <span className="counter-value">{totalMinus.toFixed(0)} m</span>
          </div>
          <div className="counter total">
            <span className="counter-label">Total</span>
            <span className="counter-value">{(totalPlus + totalMinus).toFixed(0)} m</span>
          </div>
        </div>
        
        <div className="counter-group">
          <div className="group-title">Completed ({selectedPolygons.size} tables)</div>
          <div className="counter positive">
            <span className="counter-label">+DC Cable</span>
            <span className="counter-value">{completedPlus.toFixed(0)} m</span>
          </div>
          <div className="counter negative">
            <span className="counter-label">-DC Cable</span>
            <span className="counter-value">{completedMinus.toFixed(0)} m</span>
          </div>
          <div className="counter total">
            <span className="counter-label">Total</span>
            <span className="counter-value">{(completedPlus + completedMinus).toFixed(0)} m</span>
          </div>
        </div>
        
        <div className="counter-group">
          <div className="group-title">Remaining</div>
          <div className="counter remaining">
            <span className="counter-value">{((totalPlus + totalMinus) - (completedPlus + completedMinus)).toFixed(0)} m</span>
          </div>
        </div>
        </div>
      </div>

      <div className="map-wrapper">
        <div id="map" />
        
        {/* Note Mode Indicator */}
        {noteMode && (
          <div className="note-mode-indicator" onClick={() => setNoteMode(false)}>
            <span className="note-mode-dot" aria-hidden="true" />
            <span>NOTE MODE ON</span>
            <span className="note-mode-hint">Click to add • Drag to select</span>
          </div>
        )}        
      </div>
      
      {/* Note Edit Popup */}
      {editingNote && (
        <div className="note-popup-overlay" onClick={() => setEditingNote(null)}>
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
              <button className="note-close-btn" onClick={() => setEditingNote(null)}>×</button>
            </div>
            <textarea
              className="note-textarea"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Enter your note here..."
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
            const noteDate = new Date(n.createdAt).toISOString().split('T')[0];
            return noteDate === recordDate;
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
              {[...dailyLog].sort((a, b) => {
                const mult = historySortOrder === 'desc' ? -1 : 1;
                if (historySortBy === 'date') return mult * (new Date(a.date) - new Date(b.date));
                if (historySortBy === 'workers') return mult * ((a.workers || 0) - (b.workers || 0));
                if (historySortBy === 'cable') return mult * ((a.total_cable || 0) - (b.total_cable || 0));
                return 0;
              }).map((record, idx) => (
                <div key={idx} className="history-item">
                  <div className="history-item-header">
                    <span className="history-date">{new Date(record.date).toLocaleDateString('tr-TR', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</span>
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
                  {record.notes && record.notes.length > 0 && (
                    <div className="history-notes">
                      <span className="notes-label">📌 Notes ({record.notes.length}):</span>
                      {record.notes.map((note, nidx) => (
                        <div key={nidx} className="history-note">
                          {note.text || '(empty note)'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {dailyLog.length === 0 && (
                <div className="history-empty">No work records yet</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
