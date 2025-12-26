import createModule from './createModule.jsx';
import { PUNCH_LIST_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: PUNCH_LIST_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: PUNCH_LIST_MODULE_CONFIG,
});
