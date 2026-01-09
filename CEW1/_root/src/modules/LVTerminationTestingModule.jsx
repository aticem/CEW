import createModule from './createModule.jsx';
import { LV_TERMINATION_AND_TESTING_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: LV_TERMINATION_AND_TESTING_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: LV_TERMINATION_AND_TESTING_MODULE_CONFIG,
});
