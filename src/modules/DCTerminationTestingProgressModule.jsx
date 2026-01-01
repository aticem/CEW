import createModule from './createModule.jsx';
import { DC_TERMINATION_AND_TESTING_PROGRESS_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: DC_TERMINATION_AND_TESTING_PROGRESS_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: DC_TERMINATION_AND_TESTING_PROGRESS_MODULE_CONFIG,
});
