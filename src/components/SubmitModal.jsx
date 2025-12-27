import { useState } from 'react';
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
    
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Submit Daily Work</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <form onSubmit={handleSubmit}>
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

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-cancel">
              Cancel
            </button>
            <button type="submit" className="btn-submit">
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
