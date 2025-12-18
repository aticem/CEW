import createModule from './createModule.jsx';
import { MODULE_INSTALLATION_PROGRESS_TRACKING_MODULE_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: MODULE_INSTALLATION_PROGRESS_TRACKING_MODULE_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: MODULE_INSTALLATION_PROGRESS_TRACKING_MODULE_CONFIG,
});
