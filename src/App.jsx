import { useEffect, useRef, useState } from 'react';
import DCModule from './modules/DCModule.jsx';
import LVModule from './modules/LVModule.jsx';
import MVFiberModule from './modules/MVFiberModule.jsx';
import MVFiberTrenchProgressTrackingModule from './modules/MVFiberTrenchProgressTrackingModule.jsx';
import FibreModule from './modules/FibreModule.jsx';
import MC4Module from './modules/MC4Module.jsx';
import MVTerminationModule from './modules/MVTerminationModule.jsx';
import LVTerminationTestingModule from './modules/LVTerminationTestingModule.jsx';
import DCCableTestingProgressModule from './modules/DCCableTestingProgressModule.jsx';
import ModuleInstallationProgressTrackingModule from './modules/ModuleInstallationProgressTrackingModule.jsx';
import TableInstallationProgressModule from './modules/TableInstallationProgressModule.jsx';
import LVBoxInvBoxModule from './modules/LVBoxInvBoxModule.jsx';
import PunchListModule from './modules/PunchListModule.jsx';

const MODULES = {
  DC: { key: 'DC', label: 'DC Cable Pulling Progress', Component: DCModule },
  LV: { key: 'LV', label: 'LV Cable Pulling Progress', Component: LVModule },
  MVF: { key: 'MVF', label: 'MV+Fiber Pulling Progress', Component: MVFiberModule },
  MVFT: { key: 'MVFT', label: 'MV+Fibre Trench Progress', Component: MVFiberTrenchProgressTrackingModule },
  FIB: { key: 'FIB', label: 'Fibre Pulling Progress', Component: FibreModule },
  MC4: { key: 'MC4', label: 'MC4 Installation', Component: MC4Module },
  MVT: { key: 'MVT', label: 'MV Termination Progress', Component: MVTerminationModule },
  LVTT: { key: 'LVTT', label: 'LV Termination & Testing', Component: LVTerminationTestingModule },
  DCCT: { key: 'DCCT', label: 'DC Cable Testing Progress', Component: DCCableTestingProgressModule },
  MIPT: { key: 'MIPT', label: 'Module Installation Progress', Component: ModuleInstallationProgressTrackingModule },
  TIP: { key: 'TIP', label: 'Table Installation Progress', Component: TableInstallationProgressModule },
  LVIB: { key: 'LVIB', label: 'LV Box & Inv Box Installation', Component: LVBoxInvBoxModule },
  PL: { key: 'PL', label: 'Punch List', Component: PunchListModule },
};

export default function App() {
  const [activeKey, setActiveKey] = useState('DC');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const menuOpenRef = useRef(false);

  // Keep ref in sync and expose globally for BaseModule to check
  useEffect(() => {
    menuOpenRef.current = menuOpen;
    window.__cewHamburgerMenuOpen = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const ActiveComponent = (MODULES[activeKey] || MODULES.DC).Component;

  return (
    <>
      <ActiveComponent />

      {/* Mode button (left). Keep it aligned with the Note button across all modules. */}
      <div className="fixed left-3 sm:left-5 top-[20%] z-[1200]" ref={menuRef}>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label="Mode"
            className="inline-flex h-10 w-10 items-center justify-center border-2 border-slate-700 bg-slate-900 text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute left-0 mt-2 w-72 border-2 border-slate-700 bg-slate-900 shadow-[0_10px_26px_rgba(0,0,0,0.55)]">
              {Object.values(MODULES).map((m, idx) => (
              <button 
                  key={m.key}
                  type="button"
                onClick={() => {
                    setActiveKey(m.key);
                    setMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 text-left text-[11px] font-medium tracking-wide ${
                    idx === 0 ? 'border-b border-slate-700/50' : ''
                  } ${activeKey === m.key ? 'bg-amber-500 text-black' : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                >
                  {m.label}
              </button>
                      ))}
                    </div>
                  )}
                </div>
            </div>
    </>
  );
}


