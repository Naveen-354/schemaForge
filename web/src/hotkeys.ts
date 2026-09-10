import { useEffect } from 'react';
import { useStore } from './store';

/** Global keyboard shortcuts. Editor-specific keys (Ctrl+Enter) are bound inside the SQL editor. */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const st = useStore.getState();
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); st.toggle('paletteOpen'); return; }
      if (mod && e.key.toLowerCase() === 'p' && !e.shiftKey) { e.preventDefault(); st.toggle('paletteOpen', true); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); st.newSqlTab(); return; }
      if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); st.toggle('bottomOpen'); return; }
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); st.toggle('sidebarOpen'); return; }
      if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); st.toggle('inspectorOpen'); return; }
      if (mod && e.key.toLowerCase() === 'w' ) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault(); if (st.activeTabId !== 'dashboard') st.closeTab(st.activeTabId); return;
      }
      if (e.key === 'Escape') { if (st.paletteOpen) st.toggle('paletteOpen', false); if (st.modal) st.setModal(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
