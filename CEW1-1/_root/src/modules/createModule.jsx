import BaseModule from './BaseModule.jsx';

/**
 * Factory to create standardized modules from the immutable BaseModule.
 *
 * createModule({
 *   name: "Module Name",
 *   counters: false,
 *   customLogic: null,
 *   customSidebar,
 *   customCounters,
 *   customFooter,
 *   customPanelLogic,
 *   customBoundaryLogic,
 *   moduleConfig,
 * })
 */
export default function createModule({
  name,
  counters = false,
  customLogic = null,
  customSidebar = null,
  customCounters = null,
  customFooter = null,
  customPanelLogic = null,
  customBoundaryLogic = null,
  moduleConfig = null,
} = {}) {
  return function Module() {
    return (
      <BaseModule
        name={name}
        counters={counters}
        moduleConfig={moduleConfig}
        customLogic={customLogic}
        customSidebar={customSidebar}
        customCounters={customCounters}
        customFooter={customFooter}
        customPanelLogic={customPanelLogic}
        customBoundaryLogic={customBoundaryLogic}
      />
    );
  };
}


