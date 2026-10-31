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

/**
 * Celda «N° de vale / guía» de un movimiento (SYSPCC-041). La guía automática (`internal_guide_number`)
 * es el identificador real y va SIEMPRE primero; el N° de vale físico es un texto libre (histórico o
 * escrito por un cliente) y solo se muestra como dato secundario, para que no pueda hacerse pasar por
 * una guía. «Sin vale» solo se alerta en egresos que no tienen ni guía ni vale.
 */
export function VoucherCell({ movement }) {
  const guide = movement.internal_guide_number;
  const voucher = movement.voucher_number;
  if (guide) {
    return (
      <span className="block">
        <span className="block font-mono text-xs font-semibold text-gray-800">
          <span className="sr-only">Guía </span>{guide}
        </span>
        {voucher && (
          <span className="block text-xs text-gray-500">
            Vale físico: <span className="font-mono">{voucher}</span>
          </span>
        )}
      </span>
    );
  }
  if (voucher) return <span className="font-mono text-xs text-gray-700">{voucher}</span>;
  if (movement.movement_type !== 'EXIT') return <span className="text-gray-400">—</span>;
  return <Chip tone="amber">Sin vale</Chip>;
}
