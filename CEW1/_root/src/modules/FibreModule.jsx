import createModule from './createModule.jsx';
import { FIBRE_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: FIBRE_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: FIBRE_MODULE_CONFIG,
});



