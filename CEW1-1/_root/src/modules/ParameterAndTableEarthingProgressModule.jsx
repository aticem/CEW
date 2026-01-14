import createModule from './createModule.jsx';
import { PARAMETER_AND_TABLE_EARTHING_PROGRESS_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: PARAMETER_AND_TABLE_EARTHING_PROGRESS_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: PARAMETER_AND_TABLE_EARTHING_PROGRESS_MODULE_CONFIG,
});
