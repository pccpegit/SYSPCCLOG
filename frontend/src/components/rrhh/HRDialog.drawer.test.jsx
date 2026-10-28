import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HRDialog from './HRDialog';

function Harness({ onClose = vi.fn() }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir ficha</button>
      <HRDialog
        open={open}
        variant="drawer"
        title="Ana Pérez"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        footer={<button>Descargar</button>}
      >
        <button>Anterior</button>
        <button>Siguiente</button>
      </HRDialog>
    </>
  );
}

describe('HRDialog variant="drawer"', () => {
  it('abre como diálogo modal lateral con el título enfocado', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir ficha' }));
    const dialog = screen.getByRole('dialog', { name: 'Ana Pérez' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.className).toMatch(/sm:max-w-xl/);
    expect(screen.getByRole('heading', { name: 'Ana Pérez' })).toHaveFocus();
  });

  it('atrapa el Tab, cierra con Esc y devuelve el foco a quien lo abrió', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Abrir ficha' });
    await user.click(opener);
    await user.tab(); // desde el título sigue el contenido
    expect(screen.getByRole('button', { name: 'Anterior' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
    await user.tab({ shift: true }); // el foco no escapa del panel: da la vuelta
    expect(screen.getByRole('button', { name: 'Descargar' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('el pie es pegajoso en pantallas altas y fluye con el contenido en las bajas', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir ficha' }));
    const footerBtn = screen.getByRole('button', { name: 'Descargar' });
    const scrollArea = screen.getByRole('button', { name: 'Anterior' }).parentElement.parentElement;
    expect(scrollArea.className).toMatch(/overflow-y-auto/);
    expect(scrollArea.contains(footerBtn)).toBe(true);
    expect(footerBtn.parentElement.className).toMatch(/sticky/);
    expect(footerBtn.parentElement.className).toMatch(/max-height:500px/);
  });

  it('bloquea el scroll de la página mientras está abierto y lo restaura al cerrar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(document.body.style.overflow).toBe('');
    await user.click(screen.getByRole('button', { name: 'Abrir ficha' }));
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('el botón de cerrar mide al menos 44 px y tiene contraste suficiente', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir ficha' }));
    const close = screen.getByRole('button', { name: 'Cerrar' });
    expect(close.className).toMatch(/min-h-11/);
    expect(close.className).toMatch(/min-w-11/);
    expect(close.className).toMatch(/text-gray-600/);
    expect(close.className).not.toMatch(/text-gray-400/);
  });
});
