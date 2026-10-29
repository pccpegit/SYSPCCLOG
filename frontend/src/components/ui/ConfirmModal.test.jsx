import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import ConfirmModal from './ConfirmModal';

// SYSPCC-026 — la confirmación explícita (p. ej. "stock sin cobertura completa")
// depende de que el diálogo sea operable con teclado: foco inicial en la opción
// segura, Tab atrapado, Escape y retorno del foco al botón que lo abrió.
function Harness({ onConfirm = () => {}, onCancelSpy = () => {}, withDetails = false, cancelText }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Abrir</button>
      {open && (
        <ConfirmModal
          isOpen
          title="¿Continuar?"
          message="Mensaje de confirmación."
          confirmText="Sí, continuar"
          cancelText={cancelText}
          onConfirm={() => { setOpen(false); onConfirm(); }}
          onCancel={() => { setOpen(false); onCancelSpy(); }}
        >
          {withDetails ? <ul><li>Ítem 2: stock parcial</li></ul> : null}
        </ConfirmModal>
      )}
    </>
  );
}

describe('ConfirmModal — accesibilidad', () => {
  it('tiene rol de diálogo modal con título y descripción', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    const dialog = screen.getByRole('dialog', { name: '¿Continuar?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Mensaje de confirmación.');
  });

  it('el foco entra en "Cancelar" (la opción segura) al abrir', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('Tab y Shift+Tab no salen del diálogo', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('dialog');

    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement);
    }
    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement);
    }
  });

  it('Escape cierra, avisa y devuelve el foco al botón que abrió el diálogo', async () => {
    const user = userEvent.setup();
    const onCancelSpy = vi.fn();
    render(<Harness onCancelSpy={onCancelSpy} />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onCancelSpy).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
  });

  it('confirmar ejecuta la acción una vez', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    await user.click(screen.getByRole('button', { name: 'Sí, continuar' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('se pinta en <body>, fuera del contenedor con transform de la página (si no, se centra en toda la página y no en la ventana)', async () => {
    const user = userEvent.setup();
    render(<div className="page-fade-in" data-testid="page"><Harness /></div>);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByTestId('page')).not.toContainElement(dialog);
  });

  it('muestra el contenido adicional (children) cuando se envía', async () => {
    const user = userEvent.setup();
    render(<Harness withDetails />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(screen.getByText('Ítem 2: stock parcial')).toBeInTheDocument();
  });
});

describe('ConfirmModal — descripción, ids y texto de cancelar', () => {
  it('el detalle (children) forma parte de la descripción: quien cae en "Cancelar" oye también la lista', async () => {
    const user = userEvent.setup();
    render(<Harness withDetails />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleDescription('Mensaje de confirmación. Ítem 2: stock parcial');
  });

  it('sin detalle la descripción es sólo el mensaje (no apunta a un elemento que no existe)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-describedby').split(' ')).toHaveLength(1);
    expect(dialog).toHaveAccessibleDescription('Mensaje de confirmación.');
  });

  it('cancelText cambia el texto del botón seguro (que sigue teniendo el foco)', async () => {
    const user = userEvent.setup();
    render(<Harness cancelText="Volver y revisar" />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver y revisar' })).toHaveFocus();
  });

  it('los ids son únicos por diálogo: dos abiertos a la vez no se pisan', () => {
    render(
      <>
        <ConfirmModal isOpen title="Uno" message="Primero" onConfirm={() => {}} onCancel={() => {}} />
        <ConfirmModal isOpen title="Dos" message="Segundo" onConfirm={() => {}} onCancel={() => {}}>
          <p>Detalle del segundo</p>
        </ConfirmModal>
      </>,
    );

    expect(screen.getByRole('dialog', { name: 'Uno' })).toHaveAccessibleDescription('Primero');
    expect(screen.getByRole('dialog', { name: 'Dos' })).toHaveAccessibleDescription('Segundo Detalle del segundo');
  });
});
