import { useRef } from 'react';
import { panelDomId, tabDomId } from '../../utils/requestMaster';

/**
 * Pestañas accesibles (patrón WAI-ARIA tabs): una sola pestaña en el orden de tabulación, flechas /
 * Inicio / Fin para moverse. `tabs`: `[{ id, label, icon }]`; el panel lo pinta el padre con
 * `role="tabpanel"` y `aria-labelledby={tabDomId(id)}` (helpers en utils/requestMaster).
 */
export default function MasterTabs({ tabs, active, onChange, label }) {
  const refs = useRef({});

  function onKeyDown(e, index) {
    let next = null;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-gray-200 px-3 pt-2">
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[tab.id] = el; }}
            id={tabDomId(tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelDomId(tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={[
              'inline-flex min-h-11 items-center gap-2 px-4 py-2 text-sm font-bold font-display rounded-t-xl border-b-2 -mb-px',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600',
              selected
                ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-800',
            ].join(' ')}
          >
            {Icon && <Icon size={15} aria-hidden="true" />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
