import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// Header toggle (SYSPCC-020, Decisión 6). Extracted from Header.jsx so it
// can be tested in isolation without mounting the whole header/sidebar/auth
// tree. The icon always represents the click's destination, not the
// current state: Sun (→ switches to light) while dark is showing, Moon
// (→ switches to dark) while light is showing.
export default function ThemeToggleButton() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const label = isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="p-2.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:scale-90 active:bg-gray-200 transition-all duration-150"
      title={label}
      aria-label={label}
      aria-pressed={isDark}
    >
      {isDark
        ? <Sun size={19} strokeWidth={1.8} aria-hidden="true" />
        : <Moon size={19} strokeWidth={1.8} aria-hidden="true" />}
    </button>
  );
}
