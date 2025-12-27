import { useState, useRef } from 'react';
import './SubmitModal.css';

export default function SubmitModal({
  isOpen,
  onClose,
  onSubmit,
  moduleKey,
  moduleLabel,
  workAmount = 0,
  workUnit = 'm',
  selectedPolygons = new Set(), // Add selected polygons parameter
}) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [subcontractor, setSubcontractor] = useState('');
  const [workers, setWorkers] = useState(1);
  
  // Draggable state
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!date || !subcontractor || workers < 1) {
      alert('Please fill all fields');
      return;
    }

    const record = {
      date,
      module_key: moduleKey || '',
      module_label: moduleLabel || '',
      // Keep `total_cable` for backwards compatibility with existing history/export logic.
      total_cable: Number(workAmount) || 0,
      unit: workUnit || 'm',
      subcontractor,
      workers: parseInt(workers),
      selections: Array.from(selectedPolygons), // Store selected polygon IDs
      timestamp: new Date().toISOString()
    };

    onSubmit(record);
    
    // Reset form
    setDate(new Date().toISOString().split('T')[0]);
    setSubcontractor('');
    setWorkers(1);
    setPanelPos({ x: 0, y: 0 }); // Reset position
    
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Draggable panel - non-blocking */}
      <div 
        className="submit-panel"
        style={{
          transform: `translate(${panelPos.x}px, ${panelPos.y}px)`,
          cursor: dragging ? 'grabbing' : 'default'
        }}
      >
        <div 
          className="submit-panel-header"
          style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          onMouseDown={(e) => {
            if (e.target.closest('button')) return;
            setDragging(true);
            dragOffset.current = {
              x: e.clientX - panelPos.x,
              y: e.clientY - panelPos.y
            };
          }}
          onTouchStart={(e) => {
            if (e.target.closest('button')) return;
            const touch = e.touches[0];
            setDragging(true);
            dragOffset.current = {
              x: touch.clientX - panelPos.x,
              y: touch.clientY - panelPos.y
            };
          }}
        >
          <h2>Submit Daily Work</h2>
          <button className="submit-panel-close" onClick={onClose}>×</button>
        </div>
        
        {/* Drag overlay */}
        {dragging && (
          <div 
            style={{ position: 'fixed', inset: 0, zIndex: 99999, cursor: 'grabbing' }}
            onMouseMove={(e) => {
              setPanelPos({
                x: e.clientX - dragOffset.current.x,
                y: e.clientY - dragOffset.current.y
              });
            }}
            onMouseUp={() => setDragging(false)}
            onTouchMove={(e) => {
              const touch = e.touches[0];
              setPanelPos({
                x: touch.clientX - dragOffset.current.x,
                y: touch.clientY - dragOffset.current.y
              });
            }}
            onTouchEnd={() => setDragging(false)}
          />
        )}
        
        <form onSubmit={handleSubmit} className="submit-panel-form">
          <div className="form-group">
            <label>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Subcontractor</label>
            <input
              type="text"
              value={subcontractor}
              onChange={(e) => setSubcontractor(e.target.value)}
              placeholder="Enter subcontractor name"
              required
            />
          </div>

          <div className="form-group">
            <label>Workers</label>
            <input
              type="number"
              min="1"
              value={workers}
              onChange={(e) => setWorkers(e.target.value)}
              required
            />
          </div>

          <div className="form-summary">
            <div className="summary-row">
              <span>Amount of Work</span>
              <strong>{(Number(workAmount) || 0).toFixed(0)} {workUnit}</strong>
            </div>
          </div>

          <div className="submit-panel-actions">
            <button type="button" onClick={onClose} className="btn-cancel">
              Cancel
            </button>
            <button type="submit" className="btn-submit">
              Submit
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
