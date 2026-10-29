import { useRef } from 'react';
import HRDialog from '../rrhh/HRDialog';
import { btnDanger, btnSecondary } from './uiStyles';

/**
 * Confirmación antes de vaciar un formulario con datos cargados (SYSPCC-025).
 * El foco inicial cae en «Seguir editando» (la opción segura), no en «Cerrar».
 */
export default function ClearFormDialog({ open, onKeep, onClear }) {
  const keepRef = useRef(null);
  return (
    <HRDialog
      open={open}
      onClose={onKeep}
      initialFocusRef={keepRef}
      title="¿Limpiar el formulario?"
      description="Se borrarán los datos que ya ingresó en esta pantalla. Esta acción no se puede deshacer."
      footer={(
        <>
          <button ref={keepRef} type="button" onClick={onKeep} className={btnSecondary}>Seguir editando</button>
          <button type="button" onClick={onClear} className={btnDanger}>Limpiar formulario</button>
        </>
      )}
    />
  );
}
