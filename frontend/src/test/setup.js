import '@testing-library/jest-dom/vitest';

// jsdom keeps cookies for the lifetime of the module — reset between tests
// so a `csrftoken` set in one test file can't leak into the next.
afterEach(() => {
  document.cookie.split(';').forEach((entry) => {
    const name = entry.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  });
});
