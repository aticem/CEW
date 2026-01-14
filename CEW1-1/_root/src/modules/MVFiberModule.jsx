import createModule from './createModule.jsx';
import { MV_FIBER_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: MV_FIBER_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: MV_FIBER_MODULE_CONFIG,
});


