import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useDocumentVisible from './useDocumentVisible';

const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

afterEach(() => setVisibility('visible'));

describe('useDocumentVisible', () => {
  it('sigue la visibilidad de la pestaña', () => {
    const { result } = renderHook(() => useDocumentVisible());
    expect(result.current).toBe(true);
    setVisibility('hidden');
    expect(result.current).toBe(false);
    setVisibility('visible');
    expect(result.current).toBe(true);
  });

  it('deja de escuchar al desmontar', () => {
    const { result, unmount } = renderHook(() => useDocumentVisible());
    unmount();
    setVisibility('hidden');
    expect(result.current).toBe(true);
  });
});
