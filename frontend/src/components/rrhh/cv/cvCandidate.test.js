import { describe, it, expect } from 'vitest';
import { candidateLabel, candidateSubtitle, failureOf } from './cvCandidate';

describe('cvCandidate', () => {
  it('el nombre del candidato; mientras no hay ficha, el nombre del archivo; si no, un texto neutro', () => {
    expect(candidateLabel({ candidate_name: 'Ana Pérez', original_name: 'x.pdf' })).toBe('Ana Pérez');
    expect(candidateLabel({ candidate_name: '', original_name: 'x.pdf' })).toBe('x.pdf');
    expect(candidateLabel({})).toBeTruthy();
  });

  it('subtítulo con puesto y años; omite lo que falta; 0 años sigue siendo un dato', () => {
    expect(candidateSubtitle({ headline: 'Residente', experience_years: 7.5 })).toContain('Residente');
    expect(candidateSubtitle({ headline: 'Residente', experience_years: 7.5 })).toContain('7.5');
    expect(candidateSubtitle({ experience_years: 0 })).toContain('0');
    expect(candidateSubtitle({ headline: '', experience_years: null })).toBe('');
    expect(candidateSubtitle({ headline: 'Solo puesto' })).toBe('Solo puesto');
  });

  it('solo los CVs con error tienen falla; indica si se puede reintentar y prefiere el mensaje del servidor', () => {
    expect(failureOf({ status: 'DONE', error_code: 'ai_failed' })).toBeNull();
    expect(failureOf({ status: 'QUEUED' })).toBeNull();
    expect(failureOf({ status: 'FAILED', error_code: 'ai_failed', error_message: 'Mensaje fijo.' })).toEqual({ message: 'Mensaje fijo.', retryable: true });
    expect(failureOf({ status: 'FAILED', error_code: 'cv_unreadable' }).retryable).toBe(false);
    expect(failureOf({ status: 'FAILED', error_code: 'rara' }).retryable).toBe(true);
  });
});
