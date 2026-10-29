import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  AlertCircle,
} from 'lucide-react';

export const ITEM_TYPE_LABELS = {
  EPP:        'EPP',
  MATERIAL:   'Material',
  TOOL:       'Herramienta',
  EQUIPMENT:  'Equipo',
  CONSUMABLE: 'Consumible',
};

export const ITEM_TYPES = [
  { value: '',           label: 'Todos los tipos' },
  { value: 'EPP',        label: 'EPP' },
  { value: 'MATERIAL',   label: 'Material' },
  { value: 'TOOL',       label: 'Herramienta' },
  { value: 'EQUIPMENT',  label: 'Equipo' },
  { value: 'CONSUMABLE', label: 'Consumible' },
];

export const ITEM_TYPE_COLORS = {
  EPP:        'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  MATERIAL:   'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30',
  TOOL:       'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
  EQUIPMENT:  'bg-violet-50 text-violet-700 ring-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30',
  CONSUMABLE: 'bg-teal-50 text-teal-700 ring-teal-100 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/30',
};

export const WAREHOUSE_LABELS = {
  CENTRAL: 'Central',
  SITE:    'Obra',
  OFFICE:  'Oficina',
};

export const WAREHOUSE_LABELS_FULL = {
  CENTRAL: 'Almacén Central',
  SITE:    'Almacén de Obra',
  OFFICE:  'Oficina',
};

export const WAREHOUSES = [
  { value: 'CENTRAL', label: 'Almacén Central' },
  { value: 'SITE',    label: 'Almacén de Obra' },
  { value: 'OFFICE',  label: 'Oficina' },
];

export const MOVEMENT_CONFIG = {
  ENTRY:      { label: 'Ingreso',  icon: ArrowDownToLine, bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-100 dark:ring-emerald-500/30', iconColor: 'text-emerald-600 dark:text-emerald-400', sign: '+', signColor: 'text-emerald-600 dark:text-emerald-400' },
  EXIT:       { label: 'Egreso',   icon: ArrowUpFromLine, bg: 'bg-red-50 dark:bg-red-500/10',         text: 'text-red-700 dark:text-red-300',         ring: 'ring-red-100 dark:ring-red-500/30',         iconColor: 'text-rose-600 dark:text-rose-400',       sign: '-', signColor: 'text-rose-600 dark:text-rose-400' },
  TRANSFER:   { label: 'Traslado', icon: ArrowLeftRight,  bg: 'bg-blue-50 dark:bg-blue-500/10',       text: 'text-blue-700 dark:text-blue-300',       ring: 'ring-blue-100 dark:ring-blue-500/30',       iconColor: 'text-blue-600 dark:text-blue-400',       sign: '',  signColor: 'text-blue-600 dark:text-blue-400' },
  ADJUSTMENT: { label: 'Ajuste',   icon: AlertCircle,     bg: 'bg-amber-50 dark:bg-amber-500/10',     text: 'text-amber-700 dark:text-amber-300',     ring: 'ring-amber-100 dark:ring-amber-500/30',     iconColor: 'text-amber-600 dark:text-amber-400',     sign: '',  signColor: 'text-amber-600 dark:text-amber-400' },
};

// SYSPCC-025 — vocabulario de su libro (Ingresos / Egresos) y orígenes de ingreso.
export const ENTRY_SOURCES = [
  { value: 'PURCHASE',     label: 'Compra' },
  { value: 'RETURN',       label: 'Devolución' },
  { value: 'TRANSFER_IN',  label: 'Transferencia entrante' },
  { value: 'INITIAL_LOAD', label: 'Carga inicial' },
  { value: 'ADJUSTMENT',   label: 'Ajuste' },
];

export const EXIT_MODES = [
  { value: 'EMPLOYEE',   label: 'Entrega a trabajador (EPP)' },
  { value: 'PROJECT',    label: 'Proyecto / Obra' },
  { value: 'DEPARTMENT', label: 'Departamento' },
  { value: 'ADJUSTMENT', label: 'Ajuste' },
];

export const FLOOR_OPTIONS = [
  { value: '1', label: '1er piso' },
  { value: '2', label: '2do piso' },
];

// Destino que usa su libro para las transferencias entre pisos.
export const INTERNAL_TRANSFER_DESTINATION = { 1: 'ALM - PRIMER PISO', 2: 'ALM - SEGUNDO PISO' };
