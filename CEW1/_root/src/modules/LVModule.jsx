import createModule from './createModule.jsx';
import { LV_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: LV_MODULE_CONFIG.label,
  counters: true, // keep same UI for now; can set false per module later
  customLogic: null,
  moduleConfig: LV_MODULE_CONFIG,
});


