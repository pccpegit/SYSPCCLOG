import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import useFileDrop from './useFileDrop';

function Zone({ onFiles, disabled }) {
  const { dragging, dropProps } = useFileDrop({ onFiles, disabled });
  return (
    <div data-testid="zone" {...dropProps}>
      <span data-testid="inner">dentro</span>
      <output>{dragging ? 'Suelta para agregar' : 'Arrastra aquí'}</output>
    </div>
  );
}

const withFiles = (files = []) => ({ dataTransfer: { types: ['Files'], items: [], files } });
const file = (name) => new File(['x'], name, { type: 'application/pdf' });

describe('useFileDrop', () => {
  it('muestra el estado de arrastre solo con archivos y lo quita al salir de la zona (aunque pase por hijos)', () => {
    render(<Zone onFiles={() => {}} />);
    const zone = screen.getByTestId('zone');
    fireEvent.dragEnter(zone, withFiles());
    expect(screen.getByText('Suelta para agregar')).toBeInTheDocument();
    fireEvent.dragEnter(screen.getByTestId('inner'), withFiles()); // entra a un hijo
    fireEvent.dragLeave(zone); // sale del padre: sigue dentro del hijo
    expect(screen.getByText('Suelta para agregar')).toBeInTheDocument();
    fireEvent.dragLeave(screen.getByTestId('inner'));
    expect(screen.getByText('Arrastra aquí')).toBeInTheDocument();
  });

  it('ignora arrastres que no son archivos (texto, enlaces)', () => {
    render(<Zone onFiles={() => {}} />);
    fireEvent.dragEnter(screen.getByTestId('zone'), { dataTransfer: { types: ['text/plain'] } });
    expect(screen.getByText('Arrastra aquí')).toBeInTheDocument();
  });

  it('soltar entrega los archivos, limpia el estado y evita que el navegador abra el archivo', async () => {
    const onFiles = vi.fn();
    render(<Zone onFiles={onFiles} />);
    const zone = screen.getByTestId('zone');
    const a = file('a.pdf');
    fireEvent.dragEnter(zone, withFiles());
    const notPrevented = fireEvent.drop(zone, withFiles([a]));
    expect(notPrevented).toBe(false); // preventDefault fue llamado
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([a]));
    expect(screen.getByText('Arrastra aquí')).toBeInTheDocument();
  });

  it('soltar sin archivos (p. ej. una carpeta vacía) no llama a onFiles', async () => {
    const onFiles = vi.fn();
    render(<Zone onFiles={onFiles} />);
    fireEvent.drop(screen.getByTestId('zone'), withFiles([]));
    await new Promise((r) => setTimeout(r, 10));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('deshabilitado: no escucha nada ni cambia de estado', () => {
    const onFiles = vi.fn();
    render(<Zone onFiles={onFiles} disabled />);
    fireEvent.dragEnter(screen.getByTestId('zone'), withFiles());
    fireEvent.drop(screen.getByTestId('zone'), withFiles([file('a.pdf')]));
    expect(screen.getByText('Arrastra aquí')).toBeInTheDocument();
    expect(onFiles).not.toHaveBeenCalled();
  });
});
