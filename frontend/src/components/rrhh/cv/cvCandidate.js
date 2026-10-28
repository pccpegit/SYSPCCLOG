// SYSPCC-023 — helpers de presentación de una fila de candidato.
import { COPY } from '../../../utils/cvCopy';
import { itemError, isRetryable } from '../../../utils/cvErrors';

export const candidateLabel = (item) => item.candidate_name || item.original_name || COPY.results.candidateFallback;

export function candidateSubtitle(item) {
  const parts = [];
  if (item.headline) parts.push(item.headline);
  if (item.experience_years != null) parts.push(COPY.results.years(item.experience_years));
  return parts.join(' · ');
}

export function failureOf(item) {
  if (item.status !== 'FAILED') return null;
  const info = itemError(item.error_code, item.error_message);
  return { message: info.message, retryable: isRetryable(item.error_code) };
}
