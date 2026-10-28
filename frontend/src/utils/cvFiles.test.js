import { describe, it, expect } from 'vitest';
import { classifyFiles, collectDroppedFiles, fileKey, isIgnoredFile } from './cvFiles';

const file = (name, size = 100, lastModified = 1) => {
  const f = new File(['x'], name, { lastModified });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('cvFiles.classifyFiles', () => {
  it('ignora archivos del sistema sin tratarlos como error', () => {
    expect(['.DS_Store', 'Thumbs.db', '~$cv.docx', '.oculto.pdf', 'desktop.ini'].every(isIgnoredFile)).toBe(true);
    const { ok, problems, ignored } = classifyFiles([file('.DS_Store'), file('Thumbs.db'), file('~$a.docx'), file('a.pdf')]);
    expect(ok).toHaveLength(1);
    expect(problems).toHaveLength(0);
    expect(ignored).toBe(3);
  });

  it('rechaza formato, vacío y tamaño con un motivo en español', () => {
    const { ok, problems } = classifyFiles(
      [file('a.exe'), file('b.pdf', 0), file('c.pdf', 11 * 1024 * 1024), file('d.PDF', 10)],
      { maxBytes: 10 * 1024 * 1024 },
    );
    expect(ok.map((o) => o.file.name)).toEqual(['d.PDF']);
    expect(problems.map((p) => p.code)).toEqual(['unsupported_type', 'file_empty', 'file_too_large']);
    expect(problems[0].detail).toMatch(/formato no admitido/i);
    expect(problems[2].detail).toBe('Pesa más de 10 MB.');
  });

  it('descarta duplicados por nombre+tamaño+fecha, también contra lo ya elegido', () => {
    const a = file('a.pdf', 10, 5);
    const first = classifyFiles([a, file('a.pdf', 10, 5)]);
    expect(first.ok).toHaveLength(1);
    expect(first.problems[0].code).toBe('duplicate_selection');
    const second = classifyFiles([file('a.pdf', 10, 5)], { existingKeys: new Set([fileKey(a)]) });
    expect(second.problems[0].code).toBe('duplicate_selection');
  });
});

describe('cvFiles.collectDroppedFiles', () => {
  const fileEntry = (f) => ({ isFile: true, isDirectory: false, file: (cb) => cb(f) });
  const dirEntry = (children) => ({
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let done = false;
      return { readEntries: (cb) => { if (done) cb([]); else { done = true; cb(children); } } };
    },
  });
  const item = (entry) => ({ kind: 'file', webkitGetAsEntry: () => entry });

  it('recorre carpetas de forma recursiva', async () => {
    const a = file('a.pdf');
    const b = file('b.pdf');
    const dt = { items: [item(dirEntry([fileEntry(a), dirEntry([fileEntry(b)])]))], files: [] };
    const out = await collectDroppedFiles(dt);
    expect(out.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
  });

  it('sin webkitGetAsEntry usa dataTransfer.files', async () => {
    const a = file('a.pdf');
    expect(await collectDroppedFiles({ items: [], files: [a] })).toEqual([a]);
  });
});
