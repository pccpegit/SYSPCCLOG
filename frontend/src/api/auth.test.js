import { describe, it, expect, vi, beforeEach } from 'vitest';
import client from './client';
import { bootstrapCsrf } from './auth';

// SYSPCC-015 — CSRF bootstrap endpoint contract: GET /auth/csrf/ must be
// called to obtain the `csrftoken` cookie before any mutating request.
vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('bootstrapCsrf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('llama a GET /auth/csrf/', () => {
    client.get.mockResolvedValue({ data: {} });

    bootstrapCsrf();

    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith('/auth/csrf/');
  });

  it('no envía body ni usa un método mutante', () => {
    client.get.mockResolvedValue({ data: {} });

    bootstrapCsrf();

    expect(client.post).not.toHaveBeenCalled();
    expect(client.get).toHaveBeenCalledWith('/auth/csrf/');
  });

  it('propaga el error si la petición falla, para que el llamador pueda reintentar', async () => {
    const networkError = new Error('network down');
    client.get.mockRejectedValue(networkError);

    await expect(bootstrapCsrf()).rejects.toThrow('network down');
  });
});
