import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import client, { attachCsrfToken, getCookie, refreshSession } from './client';

// SYSPCC-015 — CSRF enforcement (double-submit cookie pattern).
// Contract: the backend sets a JS-readable `csrftoken` cookie via
// GET /auth/csrf/. Every mutating request (POST/PUT/PATCH/DELETE) must echo
// it back as the `X-CSRFToken` header; GET/HEAD/OPTIONS are exempt.
//
// `attachCsrfToken` is the exact function registered as the axios request
// interceptor in client.js, exported standalone so it's testable without
// making a real network call (and so it's proven to run identically on the
// initial request and on the 401-triggered retry, since both funnel through
// the same interceptor).

function setCsrfCookie(value) {
  document.cookie = `csrftoken=${value}; path=/`;
}

describe('attachCsrfToken (request interceptor)', () => {
  it('añade X-CSRFToken en un POST cuando existe la cookie csrftoken', () => {
    setCsrfCookie('abc123');

    const config = attachCsrfToken({ method: 'post', headers: {} });

    expect(config.headers['X-CSRFToken']).toBe('abc123');
  });

  it.each(['put', 'patch', 'delete', 'POST', 'Delete'])(
    'también añade el header en método mutante %s',
    (method) => {
      setCsrfCookie('abc123');

      const config = attachCsrfToken({ method, headers: {} });

      expect(config.headers['X-CSRFToken']).toBe('abc123');
    },
  );

  it('NO añade el header en un GET', () => {
    setCsrfCookie('abc123');

    const config = attachCsrfToken({ method: 'get', headers: {} });

    expect(config.headers['X-CSRFToken']).toBeUndefined();
  });

  it.each(['head', 'options'])('NO añade el header en método seguro %s', (method) => {
    setCsrfCookie('abc123');

    const config = attachCsrfToken({ method, headers: {} });

    expect(config.headers['X-CSRFToken']).toBeUndefined();
  });

  it('no añade el header si la cookie csrftoken todavía no existe', () => {
    const config = attachCsrfToken({ method: 'post', headers: {} });

    expect(config.headers['X-CSRFToken']).toBeUndefined();
  });

  it('no pisa otros headers ya presentes en la petición', () => {
    setCsrfCookie('abc123');

    const config = attachCsrfToken({
      method: 'post',
      headers: { Authorization: 'Bearer xyz' },
    });

    expect(config.headers.Authorization).toBe('Bearer xyz');
    expect(config.headers['X-CSRFToken']).toBe('abc123');
  });
});

describe('getCookie', () => {
  it('lee y decodifica el valor de una cookie por nombre', () => {
    document.cookie = 'csrftoken=hello%20world; path=/';
    expect(getCookie('csrftoken')).toBe('hello world');
  });

  it('devuelve null si la cookie no existe', () => {
    expect(getCookie('no-existe')).toBeNull();
  });

  it('no confunde un nombre de cookie con el sufijo de otra', () => {
    // e.g. `foo_csrftoken=xyz` must not match a lookup for `csrftoken`
    document.cookie = 'foo_csrftoken=wrong; path=/';
    document.cookie = 'csrftoken=right; path=/';
    expect(getCookie('csrftoken')).toBe('right');
  });
});

// SYSPCC-034 — refreshSession(): helper único del refresh por cookie,
// compartido por el interceptor 401 y AuthContext.restoreSession.
describe('refreshSession (refresh compartido y deduplicado)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'csrftoken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('hace POST a auth/token/refresh/ con credenciales y X-CSRFToken', async () => {
    document.cookie = 'csrftoken=tok42; path=/';
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { detail: 'ok' } });

    await refreshSession();

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = post.mock.calls[0];
    expect(url).toMatch(/auth\/token\/refresh\/$/);
    expect(body).toEqual({});
    expect(cfg.withCredentials).toBe(true);
    expect(cfg.headers['X-CSRFToken']).toBe('tok42');
  });

  it('llamadas concurrentes comparten un solo POST', async () => {
    let resolvePost;
    const post = vi.spyOn(axios, 'post').mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );

    const a = refreshSession();
    const b = refreshSession();
    resolvePost({ data: {} });
    await Promise.all([a, b]);

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rechaza si el refresh falla y permite un nuevo intento después', async () => {
    const post = vi
      .spyOn(axios, 'post')
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: {} });

    await expect(refreshSession()).rejects.toMatchObject({ response: { status: 401 } });
    await expect(refreshSession()).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('interceptor 401 (usa refreshSession)', () => {
  const originalAdapter = client.defaults.adapter;
  afterEach(() => {
    client.defaults.adapter = originalAdapter;
    vi.restoreAllMocks();
  });

  const reply = (config, status, data = {}) => {
    const response = { data, status, statusText: '', headers: {}, config };
    if (status < 400) return Promise.resolve(response);
    const err = new Error(`HTTP ${status}`);
    err.config = config;
    err.response = response;
    return Promise.reject(err);
  };

  it('401 en una petición normal: refresca una vez y reintenta', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    let calls = 0;
    client.defaults.adapter = (config) => reply(config, ++calls === 1 ? 401 : 200, { ok: true });

    const res = await client.get('/requests/');

    expect(res.data).toEqual({ ok: true });
    expect(post).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it('401 concurrentes comparten un solo refresh', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    const seen = new Set();
    client.defaults.adapter = (config) => {
      const first = !seen.has(config.url);
      seen.add(config.url);
      return reply(config, first ? 401 : 200);
    };

    await Promise.all([client.get('/a/'), client.get('/b/'), client.get('/c/')]);

    expect(post).toHaveBeenCalledTimes(1);
  });

  it('si el refresh falla, rechaza sin reintentar la petición', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue({ response: { status: 401 } });
    let calls = 0;
    client.defaults.adapter = (config) => {
      calls += 1;
      return reply(config, 401);
    };

    await expect(client.get('/requests/')).rejects.toMatchObject({ response: { status: 401 } });
    expect(calls).toBe(1);
  });

  it('/users/me/ no dispara refresh en el interceptor', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    client.defaults.adapter = (config) => reply(config, 401);

    await expect(client.get('/users/me/')).rejects.toMatchObject({ response: { status: 401 } });
    expect(post).not.toHaveBeenCalled();
  });
});
