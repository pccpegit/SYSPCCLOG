import { useState, useRef, useCallback } from 'react';

/**
 * Formats a raw numeric string (e.g. "1234567.89") with thousand separators.
 */
function formatDisplay(raw) {
  if (!raw) return '';
  const [intPart, decPart] = raw.split('.');
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart !== undefined ? `${formatted}.${decPart}` : formatted;
}

/**
 * Strips commas, keeps digits and at most one decimal point.
 */
function stripToRaw(display) {
  const raw = display.replace(/,/g, '');
  const parts = raw.split('.');
  if (parts.length <= 2) return raw;
  return parts[0] + '.' + parts.slice(1).join('');
}

/**
 * Count how many commas appear before position `pos` in a string.
 */
function commasBefore(str, pos) {
  let count = 0;
  for (let i = 0; i < pos && i < str.length; i++) {
    if (str[i] === ',') count++;
  }
  return count;
}

/**
 * Professional numeric input with automatic thousand separators.
 */
export default function NumberInput({ value, onChange, className, placeholder = '0.00', ...rest }) {
  const [display, setDisplay] = useState(() => formatDisplay(value || ''));
  const inputRef = useRef(null);

  // Sync display when external value changes (e.g. form reset)
  const prevValueRef = useRef(value);
  if (value !== prevValueRef.current) {
    prevValueRef.current = value;
    if (stripToRaw(display) !== (value || '')) {
      setDisplay(formatDisplay(value || ''));
    }
  }

  const handleChange = useCallback((e) => {
    const input = e.target;
    const cursorInNew = input.selectionStart;
    const oldDisplay = display;

    const raw = stripToRaw(e.target.value);
    if (raw && !/^\d*\.?\d*$/.test(raw)) return;

    const newDisplay = formatDisplay(raw);
    setDisplay(newDisplay);
    onChange(raw);

    // Figure out where the cursor should land:
    // 1. Find the "digit position" the cursor is at in the typed value
    //    (i.e. cursor position minus commas before it)
    const typedValue = e.target.value;
    const digitPos = cursorInNew - commasBefore(typedValue, cursorInNew);

    // 2. Walk through newDisplay to find the position after `digitPos` non-comma chars
    let target = 0;
    let digits = 0;
    while (target < newDisplay.length && digits < digitPos) {
      if (newDisplay[target] !== ',') digits++;
      target++;
    }

    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.setSelectionRange(target, target);
      }
    });
  }, [display, onChange]);

  const handleKeyDown = useCallback((e) => {
    const allowed = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (allowed.includes(e.key)) return;
    if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) return;
    if (/^\d$/.test(e.key)) return;
    if (e.key === '.' && !display.includes('.')) return;
    e.preventDefault();
  }, [display]);

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      className={className}
      placeholder={placeholder}
      autoComplete="off"
    />
  );
}
