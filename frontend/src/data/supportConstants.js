// ============================================================
// supportConstants.js — UI display constants for the Support (Soporte TI) module
// These are local UI constants only — they do NOT come from the API.
// ============================================================

export const TICKET_STATUS = {
  OPEN:        'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED:    'RESOLVED',
  CLOSED:      'CLOSED',
};

export const TICKET_STATUS_CONFIG = {
  OPEN: {
    label: 'Abierto',
    color: 'bg-blue-100 text-blue-700',
    dot:   'bg-blue-500',
  },
  IN_PROGRESS: {
    label: 'En Proceso',
    color: 'bg-yellow-100 text-yellow-800',
    dot:   'bg-yellow-500',
  },
  RESOLVED: {
    label: 'Resuelto',
    color: 'bg-green-100 text-green-700',
    dot:   'bg-green-500',
  },
  CLOSED: {
    label: 'Cerrado',
    color: 'bg-gray-100 text-gray-600',
    dot:   'bg-gray-400',
  },
};

export const TICKET_PRIORITY_CONFIG = {
  LOW: {
    label: 'Baja',
    color: 'bg-gray-100 text-gray-600 border-gray-300',
    dot:   'bg-gray-400',
  },
  MEDIUM: {
    label: 'Media',
    color: 'bg-blue-100 text-blue-700 border-blue-300',
    dot:   'bg-blue-500',
  },
  HIGH: {
    label: 'Alta',
    color: 'bg-orange-100 text-orange-700 border-orange-300',
    dot:   'bg-orange-500',
  },
  CRITICAL: {
    label: 'Critica',
    color: 'bg-red-100 text-red-700 border-red-300',
    dot:   'bg-red-500',
  },
};

export const TICKET_CATEGORY_CONFIG = {
  HARDWARE: { label: 'Hardware',                icon: 'Monitor' },
  SOFTWARE: { label: 'Software',                icon: 'Code' },
  NETWORK:  { label: 'Red / Conectividad',      icon: 'Wifi' },
  ACCESS:   { label: 'Accesos / Permisos',      icon: 'Key' },
  EMAIL:    { label: 'Correo electronico',       icon: 'Mail' },
  PRINTER:  { label: 'Impresora / Escaner',     icon: 'Printer' },
  OTHER:    { label: 'Otro',                    icon: 'HelpCircle' },
};
