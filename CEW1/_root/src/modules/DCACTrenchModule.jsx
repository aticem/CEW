import createModule from './createModule.jsx';
import { DC_AC_TRENCH_PROGRESS_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: DC_AC_TRENCH_PROGRESS_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: DC_AC_TRENCH_PROGRESS_MODULE_CONFIG,
});
