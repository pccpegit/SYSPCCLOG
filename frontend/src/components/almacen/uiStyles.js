// SYSPCC-025 — estilos compartidos del módulo de almacén.
// Neutros (bg-white, text-gray-*, border-gray-*) los adapta el tema oscuro;
// los colores saturados llevan su variante `dark:` explícita.

export const TONES = {
  amber:   'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
  red:     'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  blue:    'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30',
  violet:  'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30',
  gray:    'bg-gray-100 text-gray-600 ring-gray-200',
};

export const inputCls = (hasError = false) =>
  `w-full min-h-11 px-3.5 py-2.5 text-sm rounded-xl border bg-gray-50 ${
    hasError
      ? 'border-red-300 dark:border-red-500/40 focus:ring-red-400 focus:border-red-400'
      : 'border-gray-200 focus:ring-emerald-500 focus:border-emerald-500'
  } focus:outline-none focus:ring-2 focus:bg-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed`;

export const cardCls = 'bg-white rounded-2xl border border-gray-100';

// emerald-700 sobre blanco: 5,48:1 (WCAG 1.4.3); emerald-600 daba 3,77:1.
export const btnPrimary =
  'inline-flex min-h-11 items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold font-display transition-all duration-150 shadow-lg shadow-emerald-700/20 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed disabled:opacity-50 disabled:cursor-not-allowed';

export const btnSecondary =
  'inline-flex min-h-11 items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 active:scale-[0.97] transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed disabled:opacity-50 disabled:cursor-not-allowed';

export const btnDanger =
  'inline-flex min-h-11 items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold font-display transition-all duration-150 shadow-lg shadow-rose-600/20 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed disabled:opacity-50 disabled:cursor-not-allowed';

export const thCls = 'px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap';
