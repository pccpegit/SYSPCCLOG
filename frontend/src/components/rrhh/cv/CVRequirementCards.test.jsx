import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CVRequirementCards from './CVRequirementCards';
import { newCard } from '../../../utils/cvRequirements';

// Parent that owns the state, like CVStepPosting does.
function Harness({ initial, max = 15, onCommit = () => {}, saveState = 'idle' }) {
  const [cards, setCards] = useState(initial);
  const [lastRemoved, setLastRemoved] = useState(null);
  return (
    <CVRequirementCards
      value={cards}
      max={max}
      saveState={saveState}
      lastRemoved={lastRemoved}
      onCommit={onCommit}
      onEdit={(key, patch) => setCards((c) => c.map((x) => (x.key === key ? { ...x, ...patch } : x)))}
      onAdd={() => setCards((c) => [...c, newCard()])}
      onRemove={(key) => {
        const index = cards.findIndex((c) => c.key === key);
        setLastRemoved({ card: cards[index], index });
        setCards((c) => c.filter((x) => x.key !== key));
      }}
      onUndo={() => {
        setCards((c) => {
          const next = [...c];
          next.splice(lastRemoved.index, 0, lastRemoved.card);
          return next;
        });
        setLastRemoved(null);
      }}
    />
  );
}

const three = () => [newCard('Uno', true), newCard('Dos'), newCard('Tres')];

describe('CVRequirementCards', () => {
  it('muestra una tarjeta por requisito con su contador "N de 15 requisitos"', () => {
    render(<Harness initial={three()} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    expect(screen.getByLabelText('Requisito 1')).toHaveValue('Uno');
    expect(screen.getByText('3 de 15 requisitos')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
  });

  it('agregar enfoca la nueva tarjeta', async () => {
    const user = userEvent.setup();
    render(<Harness initial={three()} />);
    await user.click(screen.getByRole('button', { name: /agregar requisito/i }));
    const boxes = screen.getAllByRole('textbox');
    expect(boxes).toHaveLength(4);
    expect(boxes[3]).toHaveFocus();
  });

  it('quitar es reversible sin confirmación: aparece "Deshacer" persistente y el foco pasa a la siguiente tarjeta', async () => {
    const user = userEvent.setup();
    render(<Harness initial={three()} />);
    await user.click(screen.getByRole('button', { name: 'Quitar requisito 1' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Quitaste un requisito.');
    expect(screen.getAllByRole('textbox')[0]).toHaveFocus();
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Dos');
    await user.click(screen.getByRole('button', { name: /deshacer/i }));
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Uno');
    expect(screen.queryByText('Quitaste un requisito.')).not.toBeInTheDocument();
  });

  it('al quitar la última tarjeta el foco va a "Agregar requisito"', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[newCard('Solo')]} />);
    await user.click(screen.getByRole('button', { name: 'Quitar requisito 1' }));
    expect(screen.getByRole('button', { name: /agregar requisito/i })).toHaveFocus();
  });

  it('en el máximo, agregar queda aria-disabled con texto visible y no agrega', async () => {
    const user = userEvent.setup();
    render(<Harness initial={three()} max={3} />);
    const add = screen.getByRole('button', { name: /agregar requisito/i });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Llegaste al máximo de 15.')).toBeInTheDocument();
    await user.click(add);
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
  });

  it('el contador de caracteres aparece solo al pasar de 200', async () => {
    render(<Harness initial={[newCard('x'.repeat(201))]} />);
    expect(screen.getByText('201 de 250')).toBeInTheDocument();
  });

  it('marcar obligatorio guarda al instante (onCommit) y mostrar el indicador de guardado', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={three()} onCommit={onCommit} saveState="saved" />);
    await user.click(screen.getAllByRole('checkbox')[1]);
    expect(onCommit).toHaveBeenCalled();
    expect(screen.getByText('Guardado')).toBeInTheDocument();
  });

  it('en solo lectura lista el texto sin controles de edición', () => {
    render(<CVRequirementCards value={three()} readOnly />);
    const list = screen.getByRole('list', { name: 'Requisitos' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('el error de guardado ofrece reintentar', async () => {
    const onRetrySave = vi.fn();
    const user = userEvent.setup();
    render(
      <CVRequirementCards value={three()} saveState="error" onRetrySave={onRetrySave} onAdd={() => {}} onEdit={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByText('No se pudo guardar.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetrySave).toHaveBeenCalled();
  });

  it('el contenedor role="status" existe siempre (vacío) y el texto entra después', async () => {
    const user = userEvent.setup();
    render(<Harness initial={three()} />);
    const status = screen.getAllByRole('status')[0];
    expect(status).toBeEmptyDOMElement();
    await user.click(screen.getByRole('button', { name: 'Quitar requisito 2' }));
    expect(screen.getAllByRole('status')[0]).toBe(status); // el mismo nodo: la región viva no se vuelve a montar
    expect(status).toHaveTextContent('Quitaste un requisito.');
  });

  it('"Deshacer" devuelve el foco a la tarjeta restaurada', async () => {
    const user = userEvent.setup();
    render(<Harness initial={three()} />);
    await user.click(screen.getByRole('button', { name: 'Quitar requisito 2' }));
    await user.click(screen.getByRole('button', { name: /deshacer/i }));
    const boxes = screen.getAllByRole('textbox');
    expect(boxes).toHaveLength(3);
    expect(boxes[1]).toHaveValue('Dos');
    expect(boxes[1]).toHaveFocus();
  });

  it('cada casilla "Obligatorio" indica a qué requisito pertenece (descripción accesible)', () => {
    render(<Harness initial={three()} />);
    const boxes = screen.getAllByRole('checkbox', { name: 'Obligatorio' });
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toHaveAccessibleDescription('Requisito 1');
    expect(boxes[2]).toHaveAccessibleDescription('Requisito 3');
  });
});
