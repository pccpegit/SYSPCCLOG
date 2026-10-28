import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TemporaryPasswordModal from './TemporaryPasswordModal';

describe('TemporaryPasswordModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // jsdom exposes `navigator.clipboard` as a getter-only property, and
  // `userEvent.setup()` installs its own clipboard stub as a side effect —
  // so this must be (re)defined AFTER `userEvent.setup()` runs, not in a
  // shared `beforeEach`, or userEvent's stub silently wins.
  function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    return writeText;
  }

  it('muestra la contraseña temporal y el nombre de usuario', () => {
    render(
      <TemporaryPasswordModal username="jdoe" temporaryPassword="xK9-mQ2pAbcd" onClose={vi.fn()} />,
    );

    expect(screen.getByText('xK9-mQ2pAbcd')).toBeInTheDocument();
    expect(screen.getByText(/jdoe/)).toBeInTheDocument();
  });

  it('el botón Copiar copia al portapapeles y lo anuncia en la región de estado', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(
      <TemporaryPasswordModal username="jdoe" temporaryPassword="xK9-mQ2pAbcd" onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: /copiar/i }));

    expect(writeText).toHaveBeenCalledWith('xK9-mQ2pAbcd');
    expect(await screen.findByRole('status')).toHaveTextContent('Contraseña copiada al portapapeles.');
  });

  it('anuncia el fallo si el portapapeles no está disponible', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    writeText.mockRejectedValueOnce(new Error('denegado'));
    render(
      <TemporaryPasswordModal username="jdoe" temporaryPassword="xK9-mQ2pAbcd" onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: /copiar/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/no se pudo copiar/i);
  });

  it('el botón de cierre explícito llama a onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TemporaryPasswordModal username="jdoe" temporaryPassword="xK9-mQ2pAbcd" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /ya la copié, cerrar/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('la tecla Escape llama a onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TemporaryPasswordModal username="jdoe" temporaryPassword="xK9-mQ2pAbcd" onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('devuelve el foco al elemento que abrió el modal cuando se desmonta', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Abrir';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <TemporaryPasswordModal username="jdoe" temporaryPassword="xK9-mQ2pAbcd" onClose={vi.fn()} />,
    );
    // Focus moves into the modal (the Copiar button) on mount.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /copiar/i }));

    unmount();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
