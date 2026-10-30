import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from './ToastContext';
import { useToast } from './useToast';

// SYSPCC-025 · react-frontend ronda 3 — textos de usuario del aviso emergente.

function Trigger() {
  const { showToast } = useToast();
  return <button type="button" onClick={() => showToast({ type: 'success', message: 'Todo bien.' })}>Avisar</button>;
}

describe('ToastContext', () => {
  it('el botón de cerrar se llama «Cerrar notificación» (con tilde) y quita el aviso', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><Trigger /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'Avisar' }));
    expect(await screen.findByText('Todo bien.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cerrar notificación' }));
    expect(screen.queryByText('Todo bien.')).not.toBeInTheDocument();
  });
});
