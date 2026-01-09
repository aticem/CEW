import { useEffect, useRef, useState } from 'react';
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
    textColor: '#333',
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
    url: '/full.geojson',
    name: 'full',
    color: '#2563eb',
    fillColor: '#3b82f6'
  },
  { 
    url: '/string_text.geojson', 
    name: 'string_text', 
    color: '#dc2626', 
    fillColor: '#ef4444' 
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
// ANA UYGULAMA
// ═══════════════════════════════════════════════════════════════
function App() {
  const mapRef = useRef(null);
  const layersRef = useRef([]);
  const [status, setStatus] = useState('Harita başlatılıyor...');
  const [modalOpen, setModalOpen] = useState(false);
  
  // Hooks for daily log and export
  const { dailyLog, addRecord, resetLog } = useDailyLog();
  const { exportToExcel } = useChartExport();
  
  // Dummy completed values for now (will be replaced with actual selection data)
  const [completedPlus, setCompletedPlus] = useState(0);
  const [completedMinus, setCompletedMinus] = useState(0);

  const fetchAllGeoJson = async () => {
    if (!mapRef.current) return;
    setStatus('Veriler yükleniyor...');

    layersRef.current.forEach(l => l.remove());
    layersRef.current = [];
    
    const allBounds = L.latLngBounds();
    let totalFeatures = 0;
    let textCount = 0;

    for (const file of GEOJSON_FILES) {
      try {
        const response = await fetch(file.url);
        if (!response.ok) continue;
        const data = await response.json();
        totalFeatures += data.features?.length || 0;

        const layer = L.geoJSON(data, {
          renderer: canvasRenderer,
          interactive: false,
          
          style: {
            color: file.color,
            weight: 1,
            fillColor: file.fillColor,
            fillOpacity: 0.4,
          },
          
          pointToLayer: (feature, latlng) => {
            if (feature.properties?.text) {
              textCount++;
              return L.textLabel(latlng, {
                text: feature.properties.text,
                renderer: canvasRenderer,
                textBaseSize: 8,
                refZoom: 20,
                textStyle: '300',
                textColor: '#444',
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
        console.error('GeoJSON yüklenirken hata:', err); 
      }
    }

    if (allBounds.isValid()) {
      mapRef.current.fitBounds(allBounds);
    }
    
    setStatus('Hazır: ' + totalFeatures + ' obje, ' + textCount + ' text (Canvas Mode)');
  };

  useEffect(() => {
    mapRef.current = L.map('map', {
      zoomControl: true,
      preferCanvas: true,
      zoomAnimation: true,
      markerZoomAnimation: true,
      fadeAnimation: false,
    }).setView([39, 35], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 23,
      maxNativeZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(mapRef.current);

    fetchAllGeoJson();

    return () => mapRef.current?.remove();
  }, []);

  return (
    <div className="app">
      {/* Action Buttons */}
      <div style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 1000,
        display: 'flex',
        gap: '12px'
      }}>
        <button
          onClick={() => setModalOpen(true)}
          style={{
            padding: '12px 24px',
            background: '#22c55e',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '600',
            fontSize: '14px',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => e.target.style.background = '#16a34a'}
          onMouseOut={(e) => e.target.style.background = '#22c55e'}
        >
          📋 Submit Work
        </button>
        
        <button
          onClick={() => exportToExcel(dailyLog)}
          disabled={dailyLog.length === 0}
          style={{
            padding: '12px 24px',
            background: dailyLog.length === 0 ? '#9ca3af' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '600',
            fontSize: '14px',
            cursor: dailyLog.length === 0 ? 'not-allowed' : 'pointer',
            boxShadow: dailyLog.length === 0 ? 'none' : '0 4px 12px rgba(59, 130, 246, 0.3)',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => {
            if (dailyLog.length > 0) e.target.style.background = '#2563eb';
          }}
          onMouseOut={(e) => {
            if (dailyLog.length > 0) e.target.style.background = '#3b82f6';
          }}
        >
          📊 Export to Excel
        </button>

        {dailyLog.length > 0 && (
          <button
            onClick={resetLog}
            style={{
              padding: '12px 24px',
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontWeight: '600',
              fontSize: '14px',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => e.target.style.background = '#dc2626'}
            onMouseOut={(e) => e.target.style.background = '#ef4444'}
          >
            🗑️ Reset
          </button>
        )}
      </div>

      {/* Daily Log Summary */}
      {dailyLog.length > 0 && (
        <div style={{
          position: 'fixed',
          top: 80,
          right: 20,
          zIndex: 1000,
          background: 'white',
          padding: '16px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          minWidth: '200px'
        }}>
          <div style={{ fontWeight: '700', marginBottom: '8px', color: '#1f2937' }}>
            Total Records: {dailyLog.length}
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280' }}>
            Total Cable: {dailyLog.reduce((sum, r) => sum + (r.total_cable || 0), 0).toFixed(0)} m
          </div>
        </div>
      )}

      <div className="map-wrapper">
        <div id="map" />
        <div className="status" style={{
          position: 'absolute', 
          top: 10, 
          left: 50, 
          zIndex: 999, 
          background: 'white', 
          padding: '5px 10px', 
          borderRadius: '4px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.2)', 
          fontWeight: 'bold'
        }}>
          {status}
        </div>
      </div>

      {/* Submit Modal */}
      <SubmitModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={(record) => {
          addRecord(record);
          alert('Work submitted successfully!');
        }}
        completedPlus={completedPlus}
        completedMinus={completedMinus}
      />
    </div>
  );
}

export default App;
