import { describe, it, expect } from 'vitest';
import { attachCsrfToken, getCookie } from './client';

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
