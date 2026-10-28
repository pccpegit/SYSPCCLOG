import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssistantPanel from './AssistantPanel';
import * as hrApi from '../../api/hr';

vi.mock('../../api/hr');

beforeEach(() => vi.clearAllMocks());

describe('AssistantPanel', () => {
  it('se oculta sin API key y deja un aviso discreto de modo formulario', async () => {
    hrApi.getAssistantStatus.mockResolvedValue({ data: { enabled: false } });
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);

    expect(await screen.findByText(/modo formulario/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/describe el contrato/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /interpretar descripción/i })).not.toBeInTheDocument();
  });

  it('si la consulta de estado falla tampoco muestra el panel', async () => {
    hrApi.getAssistantStatus.mockRejectedValue(new Error('boom'));
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);
    expect(await screen.findByText(/modo formulario/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/describe el contrato/i)).not.toBeInTheDocument();
  });

  it('con API key interpreta la descripción, entrega el resultado y anuncia las preguntas', async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    const result = {
      data: { worker_full_name: 'Ana Pérez', position: 'Asistente' },
      missing: [{ field: 'worker_dni', label: 'DNI', question: '¿Cuál es el DNI del trabajador?' }],
      questions: ['¿Cuál es el DNI del trabajador?'],
      warnings: [],
      personal_match: null,
      used_ai: true,
    };
    hrApi.getAssistantStatus.mockResolvedValue({ data: { enabled: true } });
    hrApi.extractWithAssistant.mockResolvedValue({ data: result });

    render(<AssistantPanel documentType="CONTRACT" personalId={3} getKnownData={() => ({ position: 'X' })} onResult={onResult} />);

    await user.type(await screen.findByLabelText(/describe el contrato/i), 'Contrato para Ana Pérez');
    await user.click(screen.getByRole('button', { name: /interpretar descripción/i }));

    expect(await screen.findByText(/se completaron 2 campos/i)).toBeInTheDocument();
    expect(screen.getByText('¿Cuál es el DNI del trabajador?')).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith(result);
    expect(hrApi.extractWithAssistant).toHaveBeenCalledWith({
      document_type: 'CONTRACT',
      text: 'Contrato para Ana Pérez',
      personal_id: 3,
      known_data: { position: 'X' },
    });
  });

  it('muestra el error es-PE del backend (422) en una región de alerta', async () => {
    const user = userEvent.setup();
    hrApi.getAssistantStatus.mockResolvedValue({ data: { enabled: true } });
    hrApi.extractWithAssistant.mockRejectedValue({
      response: { status: 422, data: { code: 'assistant_unreadable', detail: null } },
    });
    render(<AssistantPanel documentType="CONTRACT" onResult={vi.fn()} />);

    await user.type(await screen.findByLabelText(/describe el contrato/i), 'asdf');
    await user.click(screen.getByRole('button', { name: /interpretar descripción/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo interpretar la descripción/i);
  });
});
