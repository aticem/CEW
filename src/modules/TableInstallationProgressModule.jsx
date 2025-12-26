import createModule from './createModule.jsx';
import { TABLE_INSTALLATION_PROGRESS_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: TABLE_INSTALLATION_PROGRESS_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: TABLE_INSTALLATION_PROGRESS_MODULE_CONFIG,
});
