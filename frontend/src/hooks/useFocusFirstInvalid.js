import { useCallback, useRef } from 'react';

/**
 * Lleva el foco al primer control inválido de un formulario (SYSPCC-025, a11y).
 * Los controles de `Field` marcan `aria-invalid="true"` cuando tienen error, así
 * que basta con buscarlos en orden de documento. Se difiere un tick para que el
 * error ya esté pintado cuando el lector de pantalla lea el campo.
 *
 *   const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
 *   <form ref={formRef} ...>
 */
export default function useFocusFirstInvalid() {
  const formRef = useRef(null);
  const focusFirstInvalid = useCallback(() => {
    setTimeout(() => {
      formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
    }, 0);
  }, []);
  return { formRef, focusFirstInvalid };
}
