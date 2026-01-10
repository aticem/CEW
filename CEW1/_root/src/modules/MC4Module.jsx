import createModule from './createModule.jsx';
import { MC4_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: MC4_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: MC4_MODULE_CONFIG,
});

