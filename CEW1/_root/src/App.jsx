import { useEffect, useRef, useState } from 'react';
import DCModule from './modules/DCModule.jsx';
import MC4Module from './modules/MC4Module.jsx';
import AIAssistant from './components/AIAssistant.jsx';
import { ProgressProvider, useProgress } from './context/ProgressContext.jsx';

const MODULES = {
  DC: { key: 'DC', label: 'DC CABLE PULLING PROGRESS TRACKING', Component: DCModule },
  MC4: { key: 'MC4', label: 'MC4 Installation', Component: MC4Module },
};

// Inner App component that uses the progress context
function AppContent() {
  const [activeKey, setActiveKey] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('module');
      return fromUrl && MODULES[fromUrl] ? fromUrl : 'DC';
    } catch {
      return 'DC';
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const { progressData } = useProgress();

  useEffect(() => {
    // Keep URL in sync with current module (shareable + supports opening in new tab)
    try {
      const url = new URL(window.location.href);
      const current = url.searchParams.get('module');
      if (current === activeKey) return;
      url.searchParams.set('module', activeKey);
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch {
      // ignore
    }
  }, [activeKey]);

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

      {/* AI Assistant - floating chat widget with screen context */}
      <AIAssistant 
        pageContext={{
          module: MODULES[activeKey]?.label || activeKey,
          ...progressData,
        }} 
      />

      {/* Hamburger menu (only 2 modules: DC + MC4) */}
      <div className="fixed left-3 sm:left-5 top-[calc(var(--cewHeaderH,92px)+8px)] z-[1200]" ref={menuRef}>
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
            <div className="absolute left-0 mt-2 w-72 overflow-hidden border-2 border-slate-700 bg-slate-900 shadow-[0_10px_26px_rgba(0,0,0,0.55)]">
              {Object.values(MODULES).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    setActiveKey(m.key);
                    setMenuOpen(false);
                  }}
                  className={`block w-full px-3 py-2.5 text-left text-[11px] font-medium tracking-wide ${
                    activeKey === m.key
                      ? 'bg-amber-500 text-black'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
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

// Main App wrapped with ProgressProvider
export default function App() {
  return (
    <ProgressProvider>
      <AppContent />
    </ProgressProvider>
  );
}
