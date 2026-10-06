import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssistantPanel from './AssistantPanel';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');

beforeEach(() => {
  vi.clearAllMocks();
  hrApi.getAssistantStatus.mockResolvedValue({ data: { enabled: true } });
});

async function ask(user, text = 'Contrato para Ana') {
  await user.type(await screen.findByLabelText(/describe el contrato/i), text);
  await user.click(screen.getByRole('button', { name: /interpretar descripción/i }));
}

describe('AssistantPanel — errores es-PE', () => {
  it.each([
    ['422 assistant_unreadable', 422, 'assistant_unreadable', /no se pudo interpretar la descripción/i],
    ['429 assistant_rate_limited', 429, 'assistant_rate_limited', /límite de consultas al asistente/i],
    ['502 assistant_failed', 502, 'assistant_failed', /el asistente no respondió/i],
    ['503 assistant_unavailable', 503, 'assistant_unavailable', /el asistente no está disponible/i],
  ])('%s', async (_n, status, code, re) => {
    const user = userEvent.setup();
    hrApi.extractWithAssistant.mockRejectedValue({ response: { status, data: { code, detail: null } } });
    const onResult = vi.fn();
    render(<AssistantPanel documentType="CONTRACT" onResult={onResult} />);
    await ask(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(re);
    expect(alert).not.toHaveTextContent('raw');
    expect(onResult).not.toHaveBeenCalled();
    // La región del error es aria-live para lectores de pantalla.
    expect(alert.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('sin código usa mensaje por status (429/5xx) y por red caída', async () => {
    const user = userEvent.setup();
    hrApi.extractWithAssistant.mockRejectedValueOnce({ response: { status: 502, data: {} } });
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);
    await ask(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/error del servidor/i);

    hrApi.extractWithAssistant.mockRejectedValueOnce(new Error('Network Error'));
    await user.click(screen.getByRole('button', { name: /interpretar descripción/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no hay conexión/i));
  });

  it('un error posterior borra el resultado previo y un éxito posterior borra el error', async () => {
    const user = userEvent.setup();
    hrApi.extractWithAssistant.mockResolvedValueOnce({
      data: { data: { position: 'Asistente' }, missing: [], questions: [], warnings: [] },
    });
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);
    await ask(user);
    expect(await screen.findByText(/se completó 1 campo del formulario/i)).toBeInTheDocument();

    hrApi.extractWithAssistant.mockRejectedValueOnce({ response: { status: 503, data: { code: 'assistant_unavailable' } } });
    await user.click(screen.getByRole('button', { name: /interpretar descripción/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/se completó 1 campo/i)).not.toBeInTheDocument();

    hrApi.extractWithAssistant.mockResolvedValueOnce({
      data: { data: { position: 'A', work_location: 'B' }, missing: [], questions: [], warnings: [] },
    });
    await user.click(screen.getByRole('button', { name: /interpretar descripción/i }));
    expect(await screen.findByText(/se completaron 2 campos/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('AssistantPanel — resultado y accesibilidad', () => {
  it('las preguntas de faltantes y advertencias se anuncian dentro de una región aria-live', async () => {
    const user = userEvent.setup();
    hrApi.extractWithAssistant.mockResolvedValue({
      data: {
        data: { worker_full_name: 'Ana Pérez' },
        missing: [{ field: 'worker_dni', question: '¿Cuál es el DNI?' }],
        questions: ['¿Cuál es el DNI?', '¿Cuál es el domicilio?'],
        warnings: ['El sueldo parece bajo.'],
      },
    });
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);
    await ask(user);

    const q = await screen.findByText('¿Cuál es el DNI?');
    const live = q.closest('[aria-live]');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toContainElement(screen.getByText('¿Cuál es el domicilio?'));
    expect(live).toContainElement(screen.getByText('El sueldo parece bajo.'));
    expect(screen.getByText(/faltan datos/i)).toBeInTheDocument();
  });

  it('concordancia singular: "Se completó 1 campo del formulario"', async () => {
    const user = userEvent.setup();
    hrApi.extractWithAssistant.mockResolvedValue({
      data: { data: { position: 'Asistente' }, missing: [], questions: [], warnings: [] },
    });
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);
    await ask(user);
    expect(await screen.findByText(/se completó 1 campo del formulario/i)).toBeInTheDocument();
  });

  it('resultado vacío avisa que no se completó ningún campo', async () => {
    const user = userEvent.setup();
    hrApi.extractWithAssistant.mockResolvedValue({ data: { data: {}, missing: [], questions: [], warnings: [] } });
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);
    await ask(user);
    expect(await screen.findByText(/no se pudo completar ningún campo/i)).toBeInTheDocument();
  });

  it('el botón se deshabilita con texto vacío o en blanco y no llama a la API', async () => {
    const user = userEvent.setup();
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);
    const btn = await screen.findByRole('button', { name: /interpretar descripción/i });
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText(/describe el contrato/i), '   ');
    expect(btn).toBeDisabled();
    expect(hrApi.extractWithAssistant).not.toHaveBeenCalled();
  });

  it('en vuelo muestra "Interpretando…", bloquea el botón y el texto, y no reenvía', async () => {
    const user = userEvent.setup();
    hrApi.extractWithAssistant.mockReturnValue(new Promise(() => {}));
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);
    await ask(user);
    const btn = await screen.findByRole('button', { name: /interpretando/i });
    expect(btn).toBeDisabled();
    expect(screen.getByLabelText(/describe el contrato/i)).toBeDisabled();
    expect(hrApi.extractWithAssistant).toHaveBeenCalledTimes(1);
  });

  it('el texto se recorta a 2000 caracteres y muestra el contador', async () => {
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);
    const box = await screen.findByLabelText(/describe el contrato/i);
    expect(box).toHaveAttribute('maxlength', '2000');
    expect(screen.getByText('0/2000')).toBeInTheDocument();
    await userEvent.setup().type(box, 'hola');
    expect(screen.getByText('4/2000')).toBeInTheDocument();
  });

  it('no envía personal_id ni known_data cuando no hay', async () => {
    const user = userEvent.setup();
    hrApi.extractWithAssistant.mockResolvedValue({ data: { data: {}, missing: [], questions: [], warnings: [] } });
    render(<AssistantPanel documentType="CONTRACT" getKnownData={() => ({})} onResult={vi.fn()} />);
    await ask(user, '  pedido  ');
    await waitFor(() => expect(hrApi.extractWithAssistant).toHaveBeenCalled());
    expect(hrApi.extractWithAssistant).toHaveBeenCalledWith({ document_type: 'CONTRACT', text: 'pedido' });
  });

  it('mientras consulta el estado no renderiza nada', () => {
    hrApi.getAssistantStatus.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
