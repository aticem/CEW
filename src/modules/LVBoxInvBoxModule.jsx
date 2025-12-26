import createModule from './createModule.jsx';
import { LV_BOX_INV_BOX_INSTALLATION_PROGRESS_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: LV_BOX_INV_BOX_INSTALLATION_PROGRESS_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: LV_BOX_INV_BOX_INSTALLATION_PROGRESS_CONFIG,
});
