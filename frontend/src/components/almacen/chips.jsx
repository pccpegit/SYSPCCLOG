import { AlertTriangle, CheckCircle, MapPin, MapPinOff, PackageX } from 'lucide-react';
import { locationInfo, stockStatus } from '../../utils/almacen';
import { Chip } from './ui';

/** Estado de stock: Con stock / Bajo mínimo / Sin stock (icono + texto). */
export function StockStatusChip({ total, minStock }) {
  const status = stockStatus(total, minStock);
  if (status === 'none') return <Chip tone="red" icon={PackageX}>Sin stock</Chip>;
  if (status === 'low') return <Chip tone="amber" icon={AlertTriangle}>Bajo mínimo</Chip>;
  return <Chip tone="emerald" icon={CheckCircle}>Con stock</Chip>;
}

/** Ubicación exacta (`F3-2`) o "Pendiente de ubicar" con el piso si se conoce. */
export function LocationChip({ item }) {
  const loc = locationInfo(item);
  if (loc.exact) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-gray-700">
        <MapPin size={12} className="text-gray-400" aria-hidden="true" />
        {loc.code}
      </span>
    );
  }
  return (
    <Chip tone="amber" icon={MapPinOff}>
      Pendiente de ubicar{loc.floor ? ` · ${loc.floor}` : ''}
    </Chip>
  );
}
