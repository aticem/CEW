import createModule from './createModule.jsx';
import { MV_FIBRE_TRENCH_PROGRESS_TRACKING_CONFIG } from './moduleConfigs.js';

export default createModule({
  name: MV_FIBRE_TRENCH_PROGRESS_TRACKING_CONFIG.label,
  counters: true,
  customLogic: null,
  moduleConfig: MV_FIBRE_TRENCH_PROGRESS_TRACKING_CONFIG,
});
