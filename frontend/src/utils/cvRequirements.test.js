import { describe, it, expect } from 'vitest';
import { newCard, toCards, toRequirementsText, validateRequirements, countFilled } from './cvRequirements';

describe('cvRequirements', () => {
  it('weight 3 y el sufijo (obligatorio) marcan obligatorio y se quitan del texto', () => {
    const cards = toCards([
      { text: 'Ingeniero civil', weight: 3 },
      { text: 'Inglés (obligatorio)', weight: 1 },
      { text: 'Excel', weight: 1 },
    ]);
    expect(cards.map((c) => [c.text, c.mandatory])).toEqual([
      ['Ingeniero civil', true],
      ['Inglés', true],
      ['Excel', false],
    ]);
  });

  it('serializa una línea por requisito, ignora vacíos y agrega el sufijo', () => {
    const text = toRequirementsText([newCard('A', true), newCard('   '), newCard('B  con   espacios', false)]);
    expect(text).toBe('A (obligatorio)\nB con espacios');
  });

  it('ida y vuelta conserva los pesos', () => {
    const text = toRequirementsText(toCards([{ text: 'A', weight: 3 }, { text: 'B', weight: 1 }]));
    expect(toCards(text.split('\n').map((t) => ({ text: t, weight: 1 }))).map((c) => c.mandatory)).toEqual([true, false]);
  });

  it('valida el máximo de 15 y el largo total', () => {
    expect(validateRequirements(Array.from({ length: 16 }, () => newCard('x')))).toBe('too_many');
    expect(validateRequirements(Array.from({ length: 15 }, () => newCard('x'.repeat(300))))).toBe('too_long');
    expect(validateRequirements([newCard('x')])).toBeNull();
    expect(countFilled([newCard(''), newCard('a')])).toBe(1);
  });
});
