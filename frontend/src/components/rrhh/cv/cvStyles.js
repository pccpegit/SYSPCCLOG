// SYSPCC-023 — estilos compartidos del módulo de CVs.
// Una sola acción primaria (btnPrimary, bg-violet-600) por vista; el resto es
// secundario o enlace. Bordes de control #8a8f98 (>= 3:1 sobre blanco, WCAG 1.4.11).
// `dark:` solo en elementos de color con nombre (no hay tema oscuro global todavía).

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

export const btnPrimary =
  `inline-flex items-center justify-center gap-2 min-h-12 px-6 py-3 rounded-xl text-base font-semibold text-white bg-violet-600 hover:bg-violet-700 ${focusRing} w-full sm:w-auto aria-disabled:opacity-60 aria-disabled:cursor-not-allowed disabled:opacity-60 disabled:cursor-not-allowed`;

export const btnSecondary =
  `inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 rounded-xl border border-[#8a8f98] bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 ${focusRing} w-full sm:w-auto aria-disabled:opacity-60 aria-disabled:cursor-not-allowed disabled:opacity-60 disabled:cursor-not-allowed`;

// Solo dentro de diálogos de confirmación.
export const btnDanger =
  `inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 ${focusRing} disabled:opacity-60`;

export const btnLinkDanger =
  `inline-flex items-center gap-2 min-h-11 px-2 text-sm font-semibold text-red-700 underline dark:text-red-300 rounded ${focusRing}`;

export const btnLink =
  `inline-flex items-center gap-1.5 min-h-11 px-1 text-sm font-semibold text-violet-700 underline dark:text-violet-300 rounded ${focusRing}`;

export const card = 'bg-white rounded-2xl border border-gray-100 p-5 sm:p-6';

export const inputCls =
  'w-full rounded-xl border border-[#8a8f98] bg-white px-3 py-2.5 text-base text-gray-800 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 aria-[invalid=true]:border-red-600 aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-red-600';

export const errorTextCls = 'mt-1.5 flex items-start gap-1.5 text-sm font-medium text-red-700 dark:text-red-300';

export const h1Cls = 'text-xl sm:text-2xl font-extrabold text-gray-900 font-display focus:outline-none';
export const h2Cls = 'text-lg font-extrabold text-gray-900 font-display focus:outline-none';
export const h3Cls = 'text-base font-extrabold text-gray-900 font-display focus:outline-none';

// Avisos con icono + texto (nunca solo color).
export const NOTE = {
  amber:
    'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/30',
  info: 'bg-violet-50 text-violet-900 border-violet-200 dark:bg-violet-500/10 dark:text-violet-200 dark:border-violet-500/30',
  red: 'bg-red-50 text-red-800 border-red-300 dark:bg-red-500/10 dark:text-red-200 dark:border-red-500/30',
  green:
    'bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-200 dark:border-emerald-500/30',
  gray: 'bg-gray-50 text-gray-700 border-gray-300 dark:bg-gray-500/10 dark:text-gray-200 dark:border-gray-500/30',
};

export const noteBase = 'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm leading-relaxed';
