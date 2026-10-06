import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HRDialog from './HRDialog';

function Harness({ busy = false, onCloseSpy, withFields = true }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Abrir</button>
      <button type="button">Otro botón de fondo</button>
      <HRDialog
        open={open}
        title="Confirmar acción"
        description="Descripción del diálogo"
        busy={busy}
        onClose={() => { onCloseSpy?.(); setOpen(false); }}
        footer={withFields ? (
          <>
            <button type="button">Cancelar</button>
            <button type="button">Aceptar</button>
          </>
        ) : null}
      >
        {withFields && <input aria-label="Campo uno" />}
      </HRDialog>
    </div>
  );
}

describe('HRDialog', () => {
  it('expone role=dialog, aria-modal y nombre/descripcion accesibles', async () => {
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirmar acción' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Descripción del diálogo');
  });

  it('no renderiza nada cuando está cerrado', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('enfoca el primer control al abrir', async () => {
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
  });

  it('Tab desde el último control vuelve al primero (trampa)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    screen.getByRole('button', { name: 'Aceptar' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
  });

  it('Shift+Tab desde el primer control salta al último (trampa)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Aceptar' })).toHaveFocus();
  });

  it('el foco nunca sale del diálogo tras varios Tab', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement);
    }
  });

  it('Escape cierra y devuelve el foco al disparador', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('el botón Cerrar y el fondo cierran el diálogo', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const backdrop = container.querySelector('[aria-hidden="true"].absolute');
    await user.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('busy bloquea Escape, fondo y botón Cerrar', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { container } = render(<Harness busy onCloseSpy={spy} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await user.keyboard('{Escape}');
    await user.click(container.querySelector('[aria-hidden="true"].absolute'));
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('sin controles enfocables Tab no escapa del diálogo', async () => {
    const user = userEvent.setup();
    render(<Harness busy withFields={false} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    // Cerrar está deshabilitado: el panel recibe el foco.
    expect(screen.getByRole('dialog')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('dialog')).toHaveFocus();
  });
});
