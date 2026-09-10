import React, { useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useStore } from './store';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { CenterTabs } from './components/CenterTabs';
import { Inspector } from './components/Inspector';
import { BottomPanel } from './components/BottomPanel';
import { CommandPalette } from './components/CommandPalette';
import { Modals } from './components/Modals';
import { useHotkeys } from './hotkeys';

export function App() {
  const ready = useStore((s) => s.ready);
  const boot = useStore((s) => s.boot);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const inspectorOpen = useStore((s) => s.inspectorOpen);
  const bottomOpen = useStore((s) => s.bottomOpen);
  const toasts = useStore((s) => s.toasts);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const modal = useStore((s) => s.modal);
  useHotkeys();

  useEffect(() => { void boot().catch((e) => useStore.getState().toast(`Failed to load: ${e.message}`, 'error')); }, [boot]);

  if (!ready) return <div className="splash">Loading SchemaForge…</div>;

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <PanelGroup direction="horizontal" autoSaveId="sf-h">
          {sidebarOpen && (
            <>
              <Panel defaultSize={18} minSize={12} maxSize={35} order={1}><div className="panel side"><Sidebar /></div></Panel>
              <PanelResizeHandle className="resize-handle" />
            </>
          )}
          <Panel minSize={30} order={2}>
            <PanelGroup direction="vertical" autoSaveId="sf-v">
              <Panel minSize={20} order={1}><div className="panel"><CenterTabs /></div></Panel>
              {bottomOpen && (
                <>
                  <PanelResizeHandle className="resize-handle" />
                  <Panel defaultSize={30} minSize={10} maxSize={70} order={2}><div className="panel"><BottomPanel /></div></Panel>
                </>
              )}
            </PanelGroup>
          </Panel>
          {inspectorOpen && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel defaultSize={24} minSize={16} maxSize={45} order={3}><div className="panel side"><Inspector /></div></Panel>
            </>
          )}
        </PanelGroup>
      </div>
      {paletteOpen && <CommandPalette />}
      {modal && <Modals />}
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} onClick={() => useStore.getState().dismissToast(t.id)}>{t.text}</div>)}
      </div>
    </div>
  );
}
