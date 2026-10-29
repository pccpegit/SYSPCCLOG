import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeImport } from '../../../test/almacenFixtures';
import ConfirmStep from './ConfirmStep';

const noProjects = { project_labels: [] };

function setup(overrides = {}, props = {}) {
  const onConfirm = vi.fn();
  const onBack = vi.fn();
  const onRestart = vi.fn();
  const imp = makeImport({
    requires: { accept_warnings: true, accept_skipped_rows: true, ...noProjects, ...(overrides.requires ?? {}) },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'requires')),
  });
  render(
    <ConfirmStep
      imp={imp} projectMap={{}} destinationLinks={{}} confirming={false} errorMessage="" stale={false}
      onBack={onBack} onConfirm={onConfirm} onRestart={onRestart} {...props}
    />,
  );
  return { onConfirm, onBack, onRestart, user: userEvent.setup() };
}

const importButton = () => screen.getByRole('button', { name: /^importar$|importando/i });

describe('ConfirmStep — casillas según lo que exige el servidor', () => {
  it('sin advertencias ni filas omitidas no pide nada y confirma de inmediato', async () => {
    const { user, onConfirm } = setup({ requires: { accept_warnings: false, accept_skipped_rows: false } });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(importButton()).toHaveAttribute('aria-disabled', 'false');
    await user.click(importButton());
    expect(onConfirm).toHaveBeenCalledWith({ acceptWarnings: false, acceptSkipped: false, projectMap: {} });
  });

  it('si solo hay advertencias, solo pide aceptar las advertencias y el botón queda desactivado hasta marcarla', async () => {
    const { user, onConfirm } = setup({ requires: { accept_warnings: true, accept_skipped_rows: false } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(importButton()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Acepte que se importarán filas con advertencias.')).toBeInTheDocument();

    await user.click(importButton());
    expect(onConfirm).not.toHaveBeenCalled();                       // aria-disabled: el clic no hace nada

    await user.click(screen.getByRole('checkbox', { name: /entiendo que se importarán filas con advertencias/i }));
    expect(importButton()).toHaveAttribute('aria-disabled', 'false');
    await user.click(importButton());
    expect(onConfirm).toHaveBeenCalledWith({ acceptWarnings: true, acceptSkipped: false, projectMap: {} });
  });

  it('si solo hay filas con errores, solo pide aceptar que se omitan', async () => {
    const { user, onConfirm } = setup({ requires: { accept_warnings: false, accept_skipped_rows: true } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await user.click(screen.getByRole('checkbox', { name: /se omitirán 37 filas con errores/i }));
    await user.click(importButton());
    expect(onConfirm).toHaveBeenCalledWith({ acceptWarnings: false, acceptSkipped: true, projectMap: {} });
  });

  it('con ambas exigencias hacen falta las dos casillas y la lista de pendientes se va vaciando', async () => {
    const { user } = setup();
    const pending = () => screen.getByRole('list', { name: /pendientes para importar/i });
    expect(pending().querySelectorAll('li')).toHaveLength(2);

    await user.click(screen.getByRole('checkbox', { name: /filas con advertencias/i }));
    expect(pending().querySelectorAll('li')).toHaveLength(1);
    expect(importButton()).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByRole('checkbox', { name: /filas con errores/i }));
    expect(screen.queryByRole('list', { name: /pendientes para importar/i })).not.toBeInTheDocument();
    expect(importButton()).toHaveAttribute('aria-disabled', 'false');
  });

  it('desmarcar una casilla vuelve a bloquear la confirmación', async () => {
    const { user, onConfirm } = setup();
    const warnings = screen.getByRole('checkbox', { name: /filas con advertencias/i });
    await user.click(warnings);
    await user.click(screen.getByRole('checkbox', { name: /filas con errores/i }));
    await user.click(warnings);
    await user.click(importButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('usa el singular cuando hay una sola advertencia o una sola fila omitida', () => {
    setup({ summary: { counts: { warning: 1 }, skipped_rows: 1, entries: {}, exits: {}, catalog: {} } });
    expect(screen.getByText(/\(1 advertencia\)/)).toBeInTheDocument();
    expect(screen.getByText(/se omitirán 1 fila con errores/i)).toBeInTheDocument();
  });
});

describe('ConfirmStep — bloqueos', () => {
  it('con problemas bloqueantes el servidor no deja confirmar y se explica', async () => {
    const { user, onConfirm } = setup(
      { can_confirm: false, requires: { accept_warnings: false, accept_skipped_rows: false } },
    );
    expect(screen.getByText('El libro tiene problemas bloqueantes.')).toBeInTheDocument();
    await user.click(importButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('sin decidir el proyecto del libro no deja confirmar', async () => {
    const { user, onConfirm } = setup(
      { requires: { accept_warnings: false, accept_skipped_rows: false, project_labels: ['ON PLANT'] } },
    );
    expect(screen.getByText('Falta elegir el proyecto del libro (paso 2).')).toBeInTheDocument();
    await user.click(importButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('con el proyecto decidido (incluido «no asignar») envía el mapa resuelto', async () => {
    const { user, onConfirm } = setup(
      { requires: { accept_warnings: false, accept_skipped_rows: false, project_labels: ['ON PLANT'] } },
      { projectMap: { 'ON PLANT': null } },
    );
    await user.click(importButton());
    expect(onConfirm).toHaveBeenCalledWith({ acceptWarnings: false, acceptSkipped: false, projectMap: { 'ON PLANT': null } });
  });

  it('con un único proyecto sugerido por el servidor lo usa si el usuario no cambió nada', async () => {
    const { user, onConfirm } = setup({
      requires: { accept_warnings: false, accept_skipped_rows: false, project_labels: ['ON PLANT'] },
      projects: [{ label: 'ON PLANT', items: 3, matches: [{ id: 9, code: 'OP', name: 'On Plant' }], suggested_id: 9 }],
    });
    await user.click(importButton());
    expect(onConfirm).toHaveBeenCalledWith({ acceptWarnings: false, acceptSkipped: false, projectMap: { 'ON PLANT': 9 } });
  });

  it('con la previsualización vencida solo ofrece volver a subir el archivo', async () => {
    const { user, onConfirm, onRestart } = setup(
      { requires: { accept_warnings: false, accept_skipped_rows: false } },
      { stale: true, errorMessage: 'La previsualización venció. Vuelva a subir el archivo.' },
    );
    expect(screen.getByRole('alert')).toHaveTextContent('La previsualización venció');
    await user.click(importButton());
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /volver a subir el archivo/i }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmStep — mientras importa', () => {
  it('muestra «Importando…» y desactiva «Volver» y el botón principal para los lectores de pantalla', () => {
    setup(
      { requires: { accept_warnings: false, accept_skipped_rows: false } },
      { confirming: true },
    );
    expect(screen.getByRole('button', { name: /importando/i })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: /volver a la revisión/i })).toBeDisabled();
  });

  it('cuenta los destinos que se vincularán a Personal con singular y plural', () => {
    const { rerender } = (() => {
      const r = render(
        <ConfirmStep
          imp={makeImport({ requires: { accept_warnings: false, accept_skipped_rows: false, project_labels: [] } })}
          projectMap={{}} destinationLinks={{ a: 1 }} confirming={false} errorMessage="" stale={false}
          onBack={() => {}} onConfirm={() => {}} onRestart={() => {}}
        />,
      );
      return r;
    })();
    expect(screen.getByText(/1 destino se vinculará a Personal/)).toBeInTheDocument();
    rerender(
      <ConfirmStep
        imp={makeImport({ requires: { accept_warnings: false, accept_skipped_rows: false, project_labels: [] } })}
        projectMap={{}} destinationLinks={{ a: 1, b: 2 }} confirming={false} errorMessage="" stale={false}
        onBack={() => {}} onConfirm={() => {}} onRestart={() => {}}
      />,
    );
    expect(screen.getByText(/2 destinos se vincularán a Personal/)).toBeInTheDocument();
  });

  it('«Volver a la revisión» regresa al paso anterior', async () => {
    const { user, onBack } = setup();
    await user.click(screen.getByRole('button', { name: /volver a la revisión/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
