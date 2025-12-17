import { useEffect, useRef, useState } from 'react';
import DCModule from './modules/DCModule.jsx';
import LVModule from './modules/LVModule.jsx';
import MVFiberModule from './modules/MVFiberModule.jsx';
import FibreModule from './modules/FibreModule.jsx';
import MC4Module from './modules/MC4Module.jsx';
import MVTerminationModule from './modules/MVTerminationModule.jsx';
import LVTerminationTestingModule from './modules/LVTerminationTestingModule.jsx';
import DCCableTestingProgressModule from './modules/DCCableTestingProgressModule.jsx';

const MODULES = {
  DC: { key: 'DC', label: 'DC CABLE PULLING PROGRESS', Component: DCModule },
  LV: { key: 'LV', label: 'LV CABLE PULLING PROGRESS', Component: LVModule },
  MVF: { key: 'MVF', label: 'MV+FIBER PULLING PROGRESS', Component: MVFiberModule },
  FIB: { key: 'FIB', label: 'FIBRE PULLING PROGRESS', Component: FibreModule },
  MC4: { key: 'MC4', label: 'MC4 INSTALLATION', Component: MC4Module },
  MVT: { key: 'MVT', label: 'MV TERMINATION PROGRESS', Component: MVTerminationModule },
  LVTT: { key: 'LVTT', label: 'LV_TERMINATION_and_TESTING PROGRESS', Component: LVTerminationTestingModule },
  DCCT: { key: 'DCCT', label: 'DC_CABLE_TESTING_PROGRESS', Component: DCCableTestingProgressModule },
};

export default function App() {
  const [activeKey, setActiveKey] = useState('DC');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

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
                  className={`w-full px-3 py-3 text-left text-xs font-extrabold uppercase tracking-wide ${
                    idx === 0 ? 'border-b-2 border-slate-700' : ''
                  } ${activeKey === m.key ? 'bg-amber-500 text-black' : 'bg-slate-900 text-slate-200 hover:bg-slate-800'}`}
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


