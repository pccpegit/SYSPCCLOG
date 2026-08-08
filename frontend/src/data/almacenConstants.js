import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  AlertCircle,
} from 'lucide-react';

export const ITEM_TYPE_LABELS = {
  MATERIAL:   'Material',
  TOOL:       'Herramienta',
  EQUIPMENT:  'Equipo',
  CONSUMABLE: 'Consumible',
};

export const ITEM_TYPES = [
  { value: '',           label: 'Todos los tipos' },
  { value: 'MATERIAL',   label: 'Material' },
  { value: 'TOOL',       label: 'Herramienta' },
  { value: 'EQUIPMENT',  label: 'Equipo' },
  { value: 'CONSUMABLE', label: 'Consumible' },
];

export const ITEM_TYPE_COLORS = {
  MATERIAL:   'bg-blue-50 text-blue-700 ring-blue-100',
  TOOL:       'bg-amber-50 text-amber-700 ring-amber-100',
  EQUIPMENT:  'bg-violet-50 text-violet-700 ring-violet-100',
  CONSUMABLE: 'bg-teal-50 text-teal-700 ring-teal-100',
};

export const WAREHOUSE_LABELS = {
  CENTRAL: 'Central',
  SITE:    'Obra',
  OFFICE:  'Oficina',
};

export const WAREHOUSE_LABELS_FULL = {
  CENTRAL: 'Almacen Central',
  SITE:    'Almacen de Obra',
  OFFICE:  'Oficina',
};

export const WAREHOUSES = [
  { value: 'CENTRAL', label: 'Almacen Central' },
  { value: 'SITE',    label: 'Almacen de Obra' },
  { value: 'OFFICE',  label: 'Oficina' },
];

export const MOVEMENT_CONFIG = {
  ENTRY:      { label: 'Entrada',  icon: ArrowDownToLine, bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-100', iconColor: 'text-emerald-600', sign: '+', signColor: 'text-emerald-600' },
  EXIT:       { label: 'Salida',   icon: ArrowUpFromLine, bg: 'bg-red-50',     text: 'text-red-700',     ring: 'ring-red-100',     iconColor: 'text-rose-600',    sign: '-', signColor: 'text-rose-600' },
  TRANSFER:   { label: 'Traslado', icon: ArrowLeftRight,  bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-100',    iconColor: 'text-blue-600',    sign: '',  signColor: 'text-blue-600' },
  ADJUSTMENT: { label: 'Ajuste',   icon: AlertCircle,     bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-100',   iconColor: 'text-amber-600',   sign: '',  signColor: 'text-amber-600' },
};
