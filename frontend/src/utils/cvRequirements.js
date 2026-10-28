// SYSPCC-023 — conversión tarjetas de requisitos <-> `requirements_text`.
// El backend usa una línea por requisito y el sufijo " (obligatorio)" para
// peso 3 (los obligatorios pesan más en el puntaje).

export const MAX_REQUIREMENTS = 15;
export const MAX_REQUIREMENT_CHARS = 250;
export const MAX_REQUIREMENTS_TEXT = 4000;
export const MANDATORY_SUFFIX = ' (obligatorio)';

const SUFFIX_RE = /\s*\(obligatorio\)\s*$/i;

let counter = 0;
export const newCardKey = () => {
  counter += 1;
  return `req-${counter}`;
};

export const newCard = (text = '', mandatory = false) => ({ key: newCardKey(), text, mandatory });

/** Backend requirements ([{ text, weight }]) -> cards. weight 3 = obligatorio. */
export function toCards(requirements = []) {
  return requirements.map((r) => {
    const raw = String(r.text ?? '');
    const hasSuffix = SUFFIX_RE.test(raw);
    return newCard(raw.replace(SUFFIX_RE, '').trim(), Number(r.weight) === 3 || hasSuffix);
  });
}

/** Cards -> multi-line text (empty cards are ignored). */
export function toRequirementsText(cards = []) {
  return cards
    .map((c) => ({ text: String(c.text ?? '').replace(/\s+/g, ' ').trim(), mandatory: c.mandatory }))
    .filter((c) => c.text)
    .map((c) => (c.mandatory ? `${c.text}${MANDATORY_SUFFIX}` : c.text))
    .join('\n');
}

export const countFilled = (cards = []) => cards.filter((c) => String(c.text ?? '').trim()).length;

/** Returns an error code or null. Client-side mirror of the backend rules. */
export function validateRequirements(cards = []) {
  if (countFilled(cards) > MAX_REQUIREMENTS) return 'too_many';
  if (toRequirementsText(cards).length > MAX_REQUIREMENTS_TEXT) return 'too_long';
  return null;
}
