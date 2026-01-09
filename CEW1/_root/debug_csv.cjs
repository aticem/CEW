const fs = require('fs');
const path = require('path');

const csvPath = '/workspaces/CEW1/public/DC_CABLE_PULLING _PROGRESS_TRACKING/dc_strings.csv';
const text = fs.readFileSync(csvPath, 'utf8');

const normalizeId = (id) => (id ? id.toString().replace(/\s+/g, '').toLowerCase().trim() : '');

const rows = text.split(/\r?\n/).slice(1);
const dict = {}; 

rows.forEach(r => {
  const parts = r.split(',');
  if (parts.length >= 2) {
    const id = normalizeId(parts[0]);
    const length = parseFloat(parts[1]);
    if (id && !isNaN(length)) {
      if (!dict[id]) {
        dict[id] = { plus: [], minus: [] };
      }
      if (length > 0) {
        dict[id].plus.push(length);
      } else if (length < 0) {
        dict[id].minus.push(Math.abs(length));
      }
    }
  }
});

const targetId = normalizeId('TX6-INV1-STR1');
console.log('Target ID:', targetId);
console.log('Data:', dict[targetId]);

// Check for potential collisions
Object.keys(dict).forEach(key => {
    if (key !== targetId && key.includes(targetId)) {
        console.log('Potential collision:', key, dict[key]);
    }
});
