import createModule from './createModule.jsx';
import { MV_TERMINATION_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: MV_TERMINATION_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: MV_TERMINATION_MODULE_CONFIG,
});
