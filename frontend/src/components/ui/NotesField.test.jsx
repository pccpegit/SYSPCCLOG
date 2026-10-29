import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotesField from './NotesField';

// SYSPCC-026 — NotesField was extracted from LogisticsActionPage; its behaviour must not change.
describe('NotesField', () => {
  it('tiene una etiqueta asociada al área de texto', () => {
    render(<NotesField value="" onChange={() => {}} />);

    expect(screen.getByRole('textbox', { name: 'Notas / Comentarios' })).toBeInTheDocument();
  });

  it('muestra el valor recibido y cuenta sus caracteres', () => {
    render(<NotesField value="Cotizar con dos proveedores" onChange={() => {}} />);

    expect(screen.getByRole('textbox')).toHaveValue('Cotizar con dos proveedores');
    expect(screen.getByText('27 / 500 caracteres')).toBeInTheDocument();
  });

  it('avisa al padre con el texto completo en cada cambio', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NotesField value="" onChange={onChange} />);

    await user.type(screen.getByRole('textbox'), 'ok');

    expect(onChange).toHaveBeenNthCalledWith(1, 'o');
    expect(onChange).toHaveBeenNthCalledWith(2, 'k');
  });

  it('dos campos en la misma página no comparten id', () => {
    render(<><NotesField value="" onChange={() => {}} /><NotesField value="" onChange={() => {}} /></>);

    const [one, two] = screen.getAllByRole('textbox');
    expect(one.id).not.toBe(two.id);
    expect(document.querySelectorAll(`label[for="${one.id}"]`)).toHaveLength(1);
  });
});
