import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  User,
  Building2,
  Calendar,
  MapPin,
  Truck,
  ShoppingCart,
  FileSearch,
  Package,
  ClipboardCheck,
  ArrowRight,
  Info,
  Clock,
} from 'lucide-react';
import { ROLES, STATUS } from '../../data/constants';
import { useAuth } from '../../context/AuthContext';
import { getRequest, getRequests, performAction, updateRequestItems } from '../../api/requests';
import { checkStock } from '../../api/warehouse';
import StatusBadge from '../../components/ui/StatusBadge';
import PriorityBadge from '../../components/ui/PriorityBadge';
import ApprovalChain from '../../components/requests/ApprovalChain';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { useToast } from '../../context/ToastContext';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('es-PE', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function formatCurrency(val) {
  if (!val && val !== 0) return '—';
  return `S/ ${Number(val).toLocaleString('es-PE')}`;
}

function formatQty(val) {
  const n = Number(val);
  if (isNaN(n)) return val;
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 dark:border-teal-400" />
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <Icon size={14} className="text-gray-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <span className="text-xs text-gray-400">{label}: </span>
        <span className="text-sm text-gray-800 font-medium">{value || '—'}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress stepper — shows logistics pipeline position
// ─────────────────────────────────────────────────────────────────────────────

const LOGISTICS_STEPS = [
  {
    key:      'stock',
    label:    'Verificación de Stock',
    statuses: [STATUS.VALIDATED, STATUS.STOCK_CHECK, STATUS.IN_STOCK],
    icon:     FileSearch,
  },
  {
    key:      'purchase',
    label:    'Solicitud de Compra',
    statuses: [STATUS.REQUIRES_PURCHASE],
    icon:     ShoppingCart,
  },
  {
    key:      'quoting',
    label:    'Cotizaciones',
    statuses: [STATUS.QUOTING, STATUS.QUOTE_COMPARISON],
    icon:     ClipboardCheck,
  },
  {
    key:      'quote_selected',
    label:    'Selección y Orden de Compra',
    statuses: [STATUS.QUOTE_SELECTED, STATUS.COST_OVERRUN_REVIEW, STATUS.QUOTE_COST_APPROVED, STATUS.COST_OVERRUN_APPROVED],
    icon:     Package,
  },
  {
    key:      'po',
    label:    'Orden de Compra',
    statuses: [STATUS.PO_GENERATED, STATUS.CLAIM_IN_REVIEW],
    icon:     Truck,
  },
];

function getStepIndex(status) {
  return LOGISTICS_STEPS.findIndex((s) => s.statuses.includes(status));
}

function LogisticsProgressBar({ currentStatus }) {
  const activeIdx = getStepIndex(currentStatus);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
        Etapa Logística
      </p>
      <div className="flex items-center gap-0">
        {LOGISTICS_STEPS.map((step, idx) => {
          const StepIcon  = step.icon;
          const isDone    = idx < activeIdx;
          const isActive  = idx === activeIdx;
          const isPending = idx > activeIdx;

          return (
            <div key={step.key} className="flex items-center flex-1 min-w-0">
              {/* Step circle */}
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                    isDone
                      ? 'bg-teal-500 border-teal-500'
                      : isActive
                        ? 'bg-teal-600 dark:bg-teal-400 border-teal-600 dark:border-teal-400 ring-4 ring-teal-100 dark:ring-teal-500/30'
                        : 'bg-white border-gray-200'
                  }`}
                >
                  <StepIcon
                    size={16}
                    className={
                      isDone || isActive ? 'text-white' : 'text-gray-300'
                    }
                  />
                </div>
                <span
                  className={`mt-1.5 text-xs font-medium text-center leading-tight max-w-[70px] ${
                    isActive
                      ? 'text-teal-700 dark:text-teal-300'
                      : isDone
                        ? 'text-teal-500'
                        : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line — omit after last step */}
              {idx < LOGISTICS_STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-1 mt-[-1.25rem] ${
                    isDone ? 'bg-teal-400' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Items table — stock check variant
// ─────────────────────────────────────────────────────────────────────────────

function ItemsTable({ items, showStock, stockData = [] }) {
  // Match stock data to items by index (same order as descriptions sent)
  const getStock = (idx) => stockData[idx] || null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-800">
          Ítems del Requerimiento ({items.length})
        </h2>
        {showStock && (
          <p className="text-xs text-gray-400 mt-0.5">
            Stock consultado en tiempo real desde el sistema de almacén.
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 w-8">#</th>
              <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Descripción</th>
              <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500">Cant. Req.</th>
              <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500">Und.</th>
              {showStock && (
                <>
                  <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500">
                    Stk. Obra
                  </th>
                  <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500">
                    Stk. Central
                  </th>
                  <th className="py-2.5 px-4 text-center text-xs font-semibold text-gray-500">
                    Disponible
                  </th>
                  <th className="py-2.5 px-4 text-right text-xs font-semibold text-gray-500">
                    x Atender
                  </th>
                </>
              )}
              {!showStock && (
                <th className="py-2.5 px-4 text-left text-xs font-semibold text-gray-500 hidden md:table-cell">
                  Especificaciones
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const stock = getStock(idx);
              const stkObra = stock ? stock.stock_obra : (item.stock_almacen_obra ?? 0);
              const stkCentral = stock ? stock.stock_central : (item.stock_almacen_central ?? 0);
              const hasStock = stock ? stock.has_stock : (stkObra > 0 || stkCentral > 0);
              const qty = parseFloat(item.quantity) || 0;
              const xAtender = Math.max(0, qty - stkObra - stkCentral);

              return (
                <tr
                  key={item.line_number ?? item.lineNumber ?? idx}
                  className={`border-b border-gray-50 ${idx % 2 !== 0 ? 'bg-gray-50/40' : ''}`}
                >
                  <td className="py-3 px-4 text-gray-400 font-mono text-xs">
                    {item.line_number ?? item.lineNumber ?? idx + 1}
                  </td>
                  <td className="py-3 px-4 text-gray-800 font-medium leading-snug">
                    <div>{item.description}</div>
                    {stock?.matched_product && (
                      <span className="text-xs text-gray-400 font-mono">{stock.matched_product}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-700 font-semibold">
                    {formatQty(item.quantity)}
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">
                      {item.unit}
                    </span>
                  </td>
                  {showStock && (
                    <>
                      <td className="py-3 px-4 text-right">
                        <span className={`text-sm font-semibold ${
                          stkObra > 0 ? 'text-teal-600 dark:text-teal-400' : 'text-gray-400'
                        }`}>
                          {formatQty(stkObra)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`text-sm font-semibold ${
                          stkCentral > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'
                        }`}>
                          {formatQty(stkCentral)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {hasStock ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold bg-green-100 text-green-700 px-2 py-1 rounded-full dark:bg-green-500/10 dark:text-green-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Sí
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 px-2 py-1 rounded-full dark:bg-red-500/10 dark:text-red-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            No
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`text-sm font-semibold ${
                          xAtender > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'
                        }`}>
                          {xAtender > 0 ? formatQty(xAtender) : '—'}
                        </span>
                      </td>
                    </>
                  )}
                  {!showStock && (
                    <td className="py-3 px-4 text-gray-500 text-xs hidden md:table-cell leading-snug">
                      {item.specifications}
                    </td>
                  )}
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={showStock ? 7 : 5}
                  className="py-8 text-center text-gray-400 italic text-sm"
                >
                  Sin ítems registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Action panels per status
// ─────────────────────────────────────────────────────────────────────────────

function NotesField({ value, onChange }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <label className="block text-sm font-semibold text-gray-800 mb-2">
        Notas / Comentarios
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="Observaciones, condiciones, referencias de cotización..."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 hover:border-gray-400 transition-colors resize-none"
      />
      <p className="mt-1 text-xs text-gray-400">{value.length} / 500 caracteres</p>
    </div>
  );
}

// VALIDATED — stock check decision per item
function StockCheckPanel({ items, stockData, submitting, notes, onNotes, onAction }) {
  const [itemSources, setItemSources] = useState({});

  // Auto-assign based on stock data
  useEffect(() => {
    if (stockData.length > 0 && Object.keys(itemSources).length === 0) {
      const auto = {};
      items.forEach((item, idx) => {
        const stock = stockData[idx];
        auto[idx] = stock?.has_stock ? 'stock' : 'purchase';
      });
      setItemSources(auto);
    }
  }, [stockData, items]);

  const allAssigned = items.length > 0 && items.every((_, idx) => itemSources[idx]);
  const hasAnyPurchase = Object.values(itemSources).some((v) => v === 'purchase');
  const allStock = Object.values(itemSources).every((v) => v === 'stock');

  const handleConfirm = () => {
    const summary = items.map((item, idx) => {
      const source = itemSources[idx];
      const stock = stockData[idx];
      return `${item.description}: ${source === 'stock' ? 'STOCK' : 'COMPRA'} (Central: ${stock?.stock_central ?? 0}, Obra: ${stock?.stock_obra ?? 0})`;
    }).join('\n');
    const itemDecisions = items.map((item, idx) => ({
      item_id: item.id,
      supply_source: itemSources[idx] === 'stock' ? 'STOCK' : 'PURCHASE',
    }));
    onAction(!hasAnyPurchase, summary, itemDecisions);
  };

  return (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex gap-3 dark:bg-teal-500/10 dark:border-teal-500/30">
        <Info size={16} className="text-teal-600 shrink-0 mt-0.5 dark:text-teal-400" />
        <div>
          <p className="text-sm font-semibold text-teal-800 dark:text-teal-300">Verificación de Stock por Ítem</p>
          <p className="text-xs text-teal-700 mt-0.5 leading-relaxed dark:text-teal-300">
            Marque cada ítem como "Atender de Stock" o "Requiere Compra" según la disponibilidad.
          </p>
        </div>
      </div>

      {/* Per-item stock decision */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Decisión por Ítem</h2>
          <p className="text-xs text-gray-400 mt-0.5">Seleccione la fuente de atención para cada ítem</p>
        </div>
        <div className="divide-y divide-gray-100">
          {items.map((item, idx) => {
            const stock = stockData[idx];
            const source = itemSources[idx];
            const stkCentral = stock?.stock_central ?? 0;
            const stkObra = stock?.stock_obra ?? 0;
            const totalStock = stkCentral + stkObra;
            const qty = parseFloat(item.quantity) || 0;
            const sufficient = totalStock >= qty;

            return (
              <div
                key={idx}
                className={`px-6 py-4 transition-all ${
                  source === 'stock' ? 'bg-teal-50/50 dark:bg-teal-500/10' : source === 'purchase' ? 'bg-orange-50/50 dark:bg-orange-500/10' : ''
                }`}
              >
                {/* Item header */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{idx + 1}</span>
                      <p className="text-sm font-semibold text-gray-800">{item.description}</p>
                    </div>
                    {stock?.matched_product && (
                      <p className="text-xs text-gray-400 font-mono mt-0.5 ml-7">{stock.matched_product}</p>
                    )}
                  </div>
                  {/* Status indicator */}
                  {totalStock > 0 ? (
                    <span className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                      sufficient ? 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-300'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${sufficient ? 'bg-green-500' : 'bg-yellow-500'}`} />
                      {sufficient ? 'Stock suficiente' : 'Stock parcial'}
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      Sin stock
                    </span>
                  )}
                </div>

                {/* Stock details grid */}
                <div className="ml-7 grid grid-cols-4 gap-3 mb-3">
                  <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 text-center">
                    <p className="text-xs text-gray-400">Solicitado</p>
                    <p className="text-sm font-bold text-gray-800">{formatQty(item.quantity)}</p>
                    <p className="text-xs text-gray-400">{item.unit}</p>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 text-center">
                    <p className="text-xs text-gray-400">Almacén Central</p>
                    <p className={`text-sm font-bold ${stkCentral > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300'}`}>{formatQty(stkCentral)}</p>
                    <p className="text-xs text-gray-400">{item.unit}</p>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 text-center">
                    <p className="text-xs text-gray-400">Almacén Obra</p>
                    <p className={`text-sm font-bold ${stkObra > 0 ? 'text-teal-600 dark:text-teal-400' : 'text-gray-300'}`}>{formatQty(stkObra)}</p>
                    <p className="text-xs text-gray-400">{item.unit}</p>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 text-center ${
                    qty - totalStock > 0 ? 'bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30' : 'bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/30'
                  }`}>
                    <p className="text-xs text-gray-400">Faltante</p>
                    <p className={`text-sm font-bold ${qty - totalStock > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
                      {formatQty(Math.max(0, qty - totalStock))}
                    </p>
                    <p className="text-xs text-gray-400">{item.unit}</p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="ml-7 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setItemSources((prev) => ({ ...prev, [idx]: 'stock' }))}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all border-2 ${
                      source === 'stock'
                        ? 'bg-teal-600 text-white border-teal-600 shadow-md'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-teal-300 hover:text-teal-700 dark:hover:border-teal-500/30 dark:hover:text-teal-300'
                    }`}
                  >
                    <CheckCircle2 size={16} />
                    Atender de Stock
                  </button>
                  <button
                    type="button"
                    onClick={() => setItemSources((prev) => ({ ...prev, [idx]: 'purchase' }))}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all border-2 ${
                      source === 'purchase'
                        ? 'bg-orange-500 text-white border-orange-500 shadow-md'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-orange-300 hover:text-orange-700 dark:hover:border-orange-500/30 dark:hover:text-orange-300'
                    }`}
                  >
                    <ShoppingCart size={16} />
                    Requiere Compra
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary */}
      {allAssigned && (
        <div className={`rounded-xl border p-4 ${hasAnyPurchase ? 'bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30' : 'bg-teal-50 border-teal-200 dark:bg-teal-500/10 dark:border-teal-500/30'}`}>
          <p className={`text-sm font-semibold ${hasAnyPurchase ? 'text-orange-800 dark:text-orange-300' : 'text-teal-800 dark:text-teal-300'}`}>
            {allStock
              ? 'Todos los ítems se pueden atender de stock.'
              : `${Object.values(itemSources).filter((v) => v === 'purchase').length} ítem(s) requieren compra, ${Object.values(itemSources).filter((v) => v === 'stock').length} se atienden de stock.`
            }
          </p>
        </div>
      )}

      <NotesField value={notes} onChange={onNotes} />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting || !allAssigned}
          className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 text-white text-base font-bold rounded-xl transition-all duration-200 disabled:opacity-50 shadow-md ${
            !allAssigned
              ? 'bg-gray-300 cursor-not-allowed'
              : hasAnyPurchase
              ? 'bg-orange-500 hover:bg-orange-600 hover:shadow-lg'
              : 'bg-teal-600 hover:bg-teal-700 hover:shadow-lg'
          }`}
        >
          {submitting ? 'Procesando...' : !allAssigned ? 'Marque todos los ítems arriba' : hasAnyPurchase ? 'Confirmar — Enviar a Cotización' : 'Confirmar — Todo de Stock'}
        </button>

        <p className="text-xs text-gray-400 text-center pt-1">
          Esta decisión quedará registrada en el historial del requerimiento.
        </p>
      </div>
    </div>
  );
}

// REQUIRES_PURCHASE — send to quoting
function RequestQuotesPanel({ items, submitting, notes, onNotes, onAction }) {
  const purchaseItems = items.filter((i) => i.supply_source === 'PURCHASE');
  const stockItems = items.filter((i) => i.supply_source === 'STOCK');
  const unclassified = items.filter((i) => !i.supply_source || (i.supply_source !== 'PURCHASE' && i.supply_source !== 'STOCK'));

  return (
    <div className="space-y-4">
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex gap-3 dark:bg-orange-500/10 dark:border-orange-500/30">
        <Info size={16} className="text-orange-600 shrink-0 mt-0.5 dark:text-orange-400" />
        <div>
          <p className="text-sm font-semibold text-orange-800 dark:text-orange-300">Requiere Compra</p>
          <p className="text-xs text-orange-700 mt-0.5 leading-relaxed dark:text-orange-300">
            Solicite cotizaciones a proveedores para los ítems marcados como compra.
          </p>
        </div>
      </div>

      {/* Items breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {purchaseItems.length > 0 && (
          <>
            <div className="px-6 py-3 bg-orange-50 border-b border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30">
              <h3 className="text-sm font-semibold text-orange-800 flex items-center gap-2 dark:text-orange-300">
                <ShoppingCart size={16} />
                Ítems para Compra ({purchaseItems.length})
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {purchaseItems.map((item) => (
                <div key={item.id} className="px-6 py-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.description}</p>
                    <p className="text-xs text-gray-400">Línea {item.line_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-orange-600 dark:text-orange-400">{formatQty(item.quantity)} {item.unit}</p>
                    <span className="text-xs font-semibold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full dark:bg-orange-500/10 dark:text-orange-300">Compra</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {stockItems.length > 0 && (
          <>
            <div className="px-6 py-3 bg-teal-50 border-b border-teal-200 border-t border-t-gray-200 dark:bg-teal-500/10 dark:border-teal-500/30">
              <h3 className="text-sm font-semibold text-teal-800 flex items-center gap-2 dark:text-teal-300">
                <CheckCircle2 size={16} />
                Ítems de Stock ({stockItems.length})
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {stockItems.map((item) => (
                <div key={item.id} className="px-6 py-3 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.description}</p>
                    <p className="text-xs text-gray-400">Línea {item.line_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-teal-600 dark:text-teal-400">{formatQty(item.quantity)} {item.unit}</p>
                    <span className="text-xs font-semibold bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full dark:bg-teal-500/10 dark:text-teal-300">Stock</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <NotesField value={notes} onChange={onNotes} />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
        <button
          type="button"
          onClick={onAction}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <ClipboardCheck size={20} />
          {submitting ? 'Procesando...' : `Solicitar Cotizaciones (${purchaseItems.length} ítems)`}
        </button>

        <p className="text-xs text-gray-400 text-center pt-1">
          El requerimiento pasará al estado "Cotizando".
        </p>
      </div>
    </div>
  );
}

// QUOTING — register, compare and select quotations
function SelectQuotePanel({ requestId, items, submitting, notes, onNotes, onAction }) {
  const [suppliers, setSuppliers] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ ruc: '', business_name: '', trade_name: '', contact_name: '', contact_email: '', contact_phone: '', category: '' });
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState('');
  const [deliveryDays, setDeliveryDays] = useState('');
  const [paymentConditions, setPaymentConditions] = useState('');
  const [itemPrices, setItemPrices] = useState({});

  const purchaseItems = items.filter((i) => i.supply_source === 'PURCHASE');
  const quotableItems = purchaseItems.length > 0 ? purchaseItems : items;

  useEffect(() => {
    import('../../api/suppliers').then(({ getSuppliers }) => {
      getSuppliers({ page_size: 50 }).then(({ data }) => {
        setSuppliers(data.results ?? data ?? []);
      }).catch(() => {});
    });
  }, []);

  const addQuotation = async () => {
    const supplier = suppliers.find((s) => s.id === Number(selectedSupplier));
    if (!supplier) return;
    const qItems = quotableItems.map((item) => ({
      item_id: item.id,
      request_item: item.id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: parseFloat(itemPrices[item.id]) || 0,
      total: (parseFloat(itemPrices[item.id]) || 0) * (parseFloat(item.quantity) || 0),
    }));
    const total = qItems.reduce((s, i) => s + i.total, 0);

    // Save to backend
    try {
      const { createQuotation } = await import('../../api/suppliers');
      const { data: saved } = await createQuotation({
        request: requestId,
        supplier: supplier.id,
        total_amount: total.toFixed(2),
        delivery_days: parseInt(deliveryDays) || null,
        payment_terms: paymentConditions,
        items: qItems.map((qi) => ({
          request_item: qi.request_item,
          unit_price: qi.unit_price.toFixed(2),
          quantity: qi.quantity,
          total_price: qi.total.toFixed(2),
        })),
      });

      setQuotations((prev) => [...prev, {
        id: saved.id || Date.now(),
        supplier_id: supplier.id,
        supplier_name: supplier.trade_name || supplier.business_name,
        supplier_ruc: supplier.ruc,
        items: qItems,
        delivery_days: parseInt(deliveryDays) || 0,
        payment_conditions: paymentConditions,
        total,
      }]);
    } catch (err) {
      console.error('Error saving quotation:', err);
      const detail = err?.response?.data;
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail ?? 'Error al guardar cotización');
      alert(`Error al guardar cotización: ${msg}`);
      return;
    }

    setShowForm(false);
    setSelectedSupplier('');
    setDeliveryDays('');
    setPaymentConditions('');
    setItemPrices({});
  };

  const removeQuotation = (id) => {
    setQuotations((prev) => prev.filter((q) => q.id !== id));
  };

  const cheapestTotal = quotations.length > 0 ? Math.min(...quotations.map((q) => q.total)) : null;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3 dark:bg-blue-500/10 dark:border-blue-500/30">
        <Info size={16} className="text-blue-600 shrink-0 mt-0.5 dark:text-blue-400" />
        <div>
          <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">Gestión de Cotizaciones</p>
          <p className="text-xs text-blue-700 mt-0.5 leading-relaxed dark:text-blue-300">
            Registre las cotizaciones de los proveedores, compare precios y seleccione la mejor opción.
          </p>
        </div>
      </div>

      {/* Add quotation button */}
      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-dashed border-blue-300 text-blue-600 text-sm font-semibold rounded-xl hover:bg-blue-50 hover:border-blue-400 transition-all dark:border-blue-500/30 dark:text-blue-400 dark:hover:bg-blue-500/10 dark:hover:border-blue-500/30"
        >
          <ClipboardCheck size={18} />
          Agregar Cotización de Proveedor
        </button>
      )}

      {/* Quotation form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden dark:border-blue-500/30">
          <div className="px-6 py-4 bg-blue-50 border-b border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/30">
            <h3 className="text-sm font-semibold text-blue-800 dark:text-blue-300">Nueva Cotización</h3>
          </div>
          <div className="p-6 space-y-4">
            {/* Supplier select or new */}
            {!showNewSupplier ? (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Proveedor</label>
                <div className="flex gap-2">
                  <select
                    value={selectedSupplier}
                    onChange={(e) => setSelectedSupplier(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="">-- Seleccione proveedor --</option>
                    {suppliers.filter((s) => !quotations.some((q) => q.supplier_id === s.id)).map((s) => (
                      <option key={s.id} value={s.id}>{s.trade_name || s.business_name} ({s.ruc})</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowNewSupplier(true)}
                    className="shrink-0 px-3 py-2 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 transition-all"
                  >
                    + Nuevo
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 space-y-3 dark:bg-teal-500/10 dark:border-teal-500/30">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-teal-800 dark:text-teal-300">Nuevo Proveedor</h4>
                  <button onClick={() => setShowNewSupplier(false)} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">RUC *</label>
                    <input type="text" maxLength={11} placeholder="20XXXXXXXXX" value={newSupplier.ruc}
                      onChange={(e) => setNewSupplier((p) => ({ ...p, ruc: e.target.value.replace(/\D/g, '') }))}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Rubro</label>
                    <input type="text" placeholder="Ej: Materiales" value={newSupplier.category}
                      onChange={(e) => setNewSupplier((p) => ({ ...p, category: e.target.value }))}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-0.5">Razón Social *</label>
                    <input type="text" placeholder="Nombre legal de la empresa" value={newSupplier.business_name}
                      onChange={(e) => setNewSupplier((p) => ({ ...p, business_name: e.target.value }))}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-0.5">Nombre Comercial</label>
                    <input type="text" placeholder="Opcional" value={newSupplier.trade_name}
                      onChange={(e) => setNewSupplier((p) => ({ ...p, trade_name: e.target.value }))}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Contacto</label>
                    <input type="text" placeholder="Nombre" value={newSupplier.contact_name}
                      onChange={(e) => setNewSupplier((p) => ({ ...p, contact_name: e.target.value }))}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Teléfono</label>
                    <input type="text" placeholder="01-XXX-XXXX" value={newSupplier.contact_phone}
                      onChange={(e) => setNewSupplier((p) => ({ ...p, contact_phone: e.target.value }))}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-0.5">Email</label>
                    <input type="email" placeholder="ventas@empresa.com" value={newSupplier.contact_email}
                      onChange={(e) => setNewSupplier((p) => ({ ...p, contact_email: e.target.value }))}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:outline-none" />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!newSupplier.ruc || !newSupplier.business_name || newSupplier.ruc.length !== 11 || savingSupplier}
                  onClick={async () => {
                    setSavingSupplier(true);
                    try {
                      const { createSupplier } = await import('../../api/suppliers');
                      const { data: created } = await createSupplier(newSupplier);
                      setSuppliers((prev) => [...prev, created]);
                      setSelectedSupplier(String(created.id));
                      setShowNewSupplier(false);
                      setNewSupplier({ ruc: '', business_name: '', trade_name: '', contact_name: '', contact_email: '', contact_phone: '', category: '' });
                    } catch (err) {
                      alert(err.response?.data?.ruc?.[0] || 'Error al crear proveedor');
                    } finally {
                      setSavingSupplier(false);
                    }
                  }}
                  className="w-full px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingSupplier ? 'Guardando...' : 'Guardar Proveedor'}
                </button>
              </div>
            )}

            {/* Item prices */}
            {selectedSupplier && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Precios por Ítem</label>
                <div className="space-y-2">
                  {quotableItems.map((item) => {
                    const rawPrice = itemPrices[item.id] || '';
                    const numPrice = parseFloat(rawPrice) || 0;
                    const qty = parseFloat(item.quantity) || 0;
                    const lineTotal = numPrice * qty;
                    return (
                      <div key={item.id} className="bg-gray-50 rounded-lg p-4">
                        <p className="text-sm text-gray-800 font-semibold mb-1">{item.description}</p>
                        <div className="grid grid-cols-12 gap-2 items-end">
                          {/* Precio Unitario - 4 cols */}
                          <div className="col-span-4">
                            <label className="block text-xs text-gray-400 mb-1">Precio Unit.</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium">S/</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={rawPrice}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^0-9.]/g, '');
                                  setItemPrices((prev) => ({ ...prev, [item.id]: val }));
                                }}
                                onBlur={(e) => {
                                  const num = parseFloat(e.target.value);
                                  if (!isNaN(num)) {
                                    setItemPrices((prev) => ({ ...prev, [item.id]: num.toFixed(2) }));
                                  }
                                }}
                                className="w-full pl-8 pr-2 py-2 border border-gray-300 rounded-lg text-sm text-right font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              />
                            </div>
                          </div>
                          {/* × */}
                          <div className="col-span-1 flex items-center justify-center pb-1">
                            <span className="text-gray-300 font-bold">×</span>
                          </div>
                          {/* Cantidad - 2 cols */}
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-400 mb-1">Cant.</label>
                            <p className="text-sm font-bold text-gray-700 bg-white border border-gray-200 rounded-lg py-2 text-center">{formatQty(qty)} <span className="text-xs text-gray-400 font-normal">{item.unit}</span></p>
                          </div>
                          {/* = */}
                          <div className="col-span-1 flex items-center justify-center pb-1">
                            <span className="text-gray-300 font-bold">=</span>
                          </div>
                          {/* Total - 4 cols */}
                          <div className="col-span-4">
                            <label className="block text-xs text-gray-400 mb-1">Total</label>
                            <p className={`text-sm font-bold py-2 px-3 rounded-lg text-right ${lineTotal > 0 ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30' : 'bg-gray-100 text-gray-400 border border-gray-200'}`}>
                              {lineTotal > 0 ? `S/ ${lineTotal.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'S/ 0.00'}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {/* Grand total */}
                  {Object.keys(itemPrices).length > 0 && (
                    <div className="flex justify-end pt-2 border-t border-gray-200">
                      <div className="text-right">
                        <p className="text-xs text-gray-400">Total Cotización</p>
                        <p className="text-xl font-bold text-gray-800">
                          S/ {quotableItems.reduce((sum, item) => {
                            const price = parseFloat(itemPrices[item.id]) || 0;
                            const qty = parseFloat(item.quantity) || 0;
                            return sum + (price * qty);
                          }, 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Delivery and conditions */}
            {selectedSupplier && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Plazo de Entrega (días)</label>
                  <input
                    type="number"
                    min="1"
                    value={deliveryDays}
                    onChange={(e) => setDeliveryDays(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Condiciones de Pago</label>
                  <input
                    type="text"
                    placeholder="Ej: 30 días factura"
                    value={paymentConditions}
                    onChange={(e) => setPaymentConditions(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Form actions */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setSelectedSupplier(''); setItemPrices({}); }}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-200 transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={addQuotation}
                disabled={!selectedSupplier || Object.keys(itemPrices).length === 0}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Agregar Cotización
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Registered quotations */}
      {quotations.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Cotizaciones Registradas ({quotations.length})</h3>
          {quotations.map((q) => (
            <div key={q.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${q.total === cheapestTotal && quotations.length > 1 ? 'border-green-300 ring-2 ring-green-100 dark:border-green-500/30 dark:ring-green-500/30' : 'border-gray-200'}`}>
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{q.supplier_name}</p>
                  <p className="text-xs text-gray-400">RUC: {q.supplier_ruc}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-800">{formatCurrency(q.total)}</p>
                    <p className="text-xs text-gray-400">{q.delivery_days} días · {q.payment_conditions || '—'}</p>
                  </div>
                  {q.total === cheapestTotal && quotations.length > 1 && (
                    <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-1 rounded-full dark:bg-green-500/10 dark:text-green-300">Mejor precio</span>
                  )}
                  <button onClick={() => removeQuotation(q.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
              <div className="divide-y divide-gray-50">
                {q.items.map((qi) => (
                  <div key={qi.item_id} className="px-5 py-2 flex justify-between items-center text-sm">
                    <span className="text-gray-600">{qi.description}</span>
                    <span className="text-gray-800 font-medium">{formatQty(qi.quantity)} × {formatCurrency(qi.unit_price)} = <span className="font-semibold">{formatCurrency(qi.total)}</span></span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Comparison table */}
      {quotations.length >= 2 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-indigo-50 border-b border-indigo-200 dark:bg-indigo-500/10 dark:border-indigo-500/30">
            <h3 className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">Cuadro Comparativo</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-3 px-4 text-left text-xs font-semibold text-gray-500">Ítem</th>
                  {quotations.map((q) => (
                    <th key={q.id} className="py-3 px-4 text-right text-xs font-semibold text-gray-500">{q.supplier_name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quotableItems.map((item) => {
                  const prices = quotations.map((q) => q.items.find((qi) => qi.item_id === item.id)?.unit_price ?? 0);
                  const minPrice = Math.min(...prices.filter((p) => p > 0));
                  return (
                    <tr key={item.id} className="border-b border-gray-50">
                      <td className="py-2.5 px-4 text-gray-700 font-medium">
                        {item.description}
                        <span className="text-xs text-gray-400 ml-1">({formatQty(item.quantity)} {item.unit})</span>
                      </td>
                      {quotations.map((q) => {
                        const qi = q.items.find((qi) => qi.item_id === item.id);
                        const price = qi?.unit_price ?? 0;
                        const isCheapest = price > 0 && price === minPrice;
                        return (
                          <td key={q.id} className={`py-2.5 px-4 text-right font-medium ${isCheapest ? 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-500/10' : 'text-gray-700'}`}>
                            {formatCurrency(price)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {/* Delivery row */}
                <tr className="border-b border-gray-100 bg-gray-50">
                  <td className="py-2.5 px-4 text-xs font-semibold text-gray-500">Plazo de Entrega</td>
                  {quotations.map((q) => {
                    const minDays = Math.min(...quotations.map((qq) => qq.delivery_days).filter((d) => d > 0));
                    return (
                      <td key={q.id} className={`py-2.5 px-4 text-right text-sm font-semibold ${q.delivery_days === minDays ? 'text-green-700 dark:text-green-300' : 'text-gray-700'}`}>
                        {q.delivery_days} días
                      </td>
                    );
                  })}
                </tr>
                {/* Total row */}
                <tr className="bg-gray-50 border-t-2 border-gray-200">
                  <td className="py-3 px-4 text-sm font-bold text-gray-800">TOTAL</td>
                  {quotations.map((q) => (
                    <td key={q.id} className={`py-3 px-4 text-right text-base font-bold ${q.total === cheapestTotal ? 'text-green-700 dark:text-green-300' : 'text-gray-800'}`}>
                      {formatCurrency(q.total)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selection */}
      {quotations.length >= 2 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Seleccionar Proveedor</h3>
          {quotations.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => onAction(q)}
              disabled={submitting}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-sm font-semibold transition-all border-2 ${
                q.total === cheapestTotal
                  ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100 hover:shadow-md dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300 dark:hover:bg-green-500/15'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300'
              } disabled:opacity-50`}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 size={18} />
                <span>{q.supplier_name}</span>
                {q.total === cheapestTotal && <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full dark:bg-green-500/10 dark:text-green-300">Mejor precio</span>}
              </div>
              <span className="font-bold">{formatCurrency(q.total)} · {q.delivery_days}d</span>
            </button>
          ))}
        </div>
      )}

      {quotations.length < 2 && quotations.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg dark:bg-amber-500/10 dark:border-amber-500/30">
          <p className="text-xs text-amber-700 font-medium dark:text-amber-300">
            Agregue al menos 2 cotizaciones para comparar y seleccionar proveedor.
          </p>
        </div>
      )}

      <NotesField value={notes} onChange={onNotes} />
    </div>
  );
}

// RECEIVING — conformity check with claim form
function ConformityCheckPanel({ items, isReplacement, submitting, notes, onNotes, onConforme, onNoConforme }) {
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [claimReason, setClaimReason] = useState('');
  const [itemIssues, setItemIssues] = useState({});

  function buildClaimText() {
    const lines = [];
    if (claimReason) lines.push(`Motivo: ${claimReason}`);
    const issueEntries = Object.entries(itemIssues).filter(([, v]) => v.trim());
    if (issueEntries.length > 0) {
      lines.push('Detalle por ítem:');
      issueEntries.forEach(([id, issue]) => {
        const item = items.find((i) => String(i.id) === id);
        lines.push(`  - ${item?.description ?? `Ítem ${id}`}: ${issue}`);
      });
    }
    return lines.join('\n') || 'Materiales no conformes. Reclamo al proveedor — se solicita cambio.';
  }

  const hasClaimDetail = claimReason.trim() || Object.values(itemIssues).some((v) => v.trim());

  if (showClaimForm) {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 flex gap-3 dark:bg-red-500/10 dark:border-red-500/30">
          <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5 dark:text-red-400" />
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">Registrar Inconformidades</p>
            <p className="text-xs text-red-700 mt-0.5 leading-relaxed dark:text-red-300">
              Detalle las inconformidades encontradas. Esta información se guardará en el historial
              del requerimiento y será enviada al proveedor como reclamo formal.
            </p>
          </div>
        </div>

        {/* General reason */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
          <label className="block text-sm font-semibold text-gray-700">Motivo General del Rechazo</label>
          <select
            value={claimReason}
            onChange={(e) => setClaimReason(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">— Seleccione motivo —</option>
            <option value="Cantidad incorrecta">Cantidad incorrecta</option>
            <option value="Material dañado">Material dañado</option>
            <option value="Especificaciones no coinciden">Especificaciones no coinciden</option>
            <option value="Material incompleto">Material incompleto</option>
            <option value="Material equivocado">Material equivocado</option>
            <option value="Calidad deficiente">Calidad deficiente</option>
            <option value="Otro">Otro</option>
          </select>
        </div>

        {/* Per-item issues */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-red-50 border-b border-red-100 dark:bg-red-500/10 dark:border-red-500/30">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">Detalle por Ítem</p>
            <p className="text-xs text-red-600 mt-0.5 dark:text-red-400">Indique qué problema tiene cada ítem (opcional).</p>
          </div>
          <div className="divide-y divide-gray-50">
            {items.map((item) => (
              <div key={item.id} className="px-5 py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.description}</p>
                    <p className="text-xs text-gray-400">{formatQty(item.quantity)} {item.unit}</p>
                  </div>
                  {itemIssues[item.id]?.trim() && (
                    <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium shrink-0 ml-3 dark:bg-red-500/10 dark:text-red-300">Con observación</span>
                  )}
                </div>
                <input
                  type="text"
                  value={itemIssues[item.id] || ''}
                  onChange={(e) => setItemIssues((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  placeholder="Ej: Recibido dañado, cantidad incompleta, no corresponde..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-gray-50"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Additional notes */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
          <label className="block text-sm font-semibold text-gray-700">Observaciones Adicionales</label>
          <textarea
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            rows={3}
            placeholder="Información adicional para el reclamo al proveedor..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
          <button
            type="button"
            onClick={() => onNoConforme(buildClaimText() + (notes.trim() ? `\nNotas: ${notes.trim()}` : ''))}
            disabled={submitting || !hasClaimDetail}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
          >
            <XCircle size={20} />
            {submitting ? 'Enviando...' : 'Confirmar No Conformidad y Generar Reclamo'}
          </button>
          {!hasClaimDetail && (
            <p className="text-xs text-red-500 text-center">Seleccione un motivo o detalle al menos un ítem para continuar.</p>
          )}
          <button
            type="button"
            onClick={() => setShowClaimForm(false)}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-all"
          >
            <ArrowLeft size={16} />
            Volver a Verificación
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className={`${isReplacement ? 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30' : 'bg-blue-50 border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/30'} border rounded-xl p-4 flex gap-3`}>
        <ClipboardCheck size={16} className={`${isReplacement ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'} shrink-0 mt-0.5`} />
        <div>
          <p className={`text-sm font-semibold ${isReplacement ? 'text-amber-800 dark:text-amber-300' : 'text-blue-800 dark:text-blue-300'}`}>
            {isReplacement ? 'Reposición Recibida — Verificar Nuevamente' : 'Paso 15 — ¿Está todo conforme?'}
          </p>
          <p className={`text-xs ${isReplacement ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'} mt-0.5 leading-relaxed`}>
            {isReplacement
              ? 'El proveedor envió materiales de reemplazo. Verifique que esta vez cumplan con lo solicitado en la OC.'
              : 'Verifique que los materiales recibidos cumplan con las especificaciones de la Orden de Compra.'}
          </p>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-700">Ítems a Verificar ({items.length})</p>
        </div>
        <div className="divide-y divide-gray-50">
          {items.map((item) => (
            <div key={item.id} className="px-5 py-3 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800">{item.description}</p>
                <p className="text-xs text-gray-400">{formatQty(item.quantity)} {item.unit}</p>
              </div>
              <span className={`text-xs ${isReplacement ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'} px-2 py-0.5 rounded-full font-medium shrink-0 ml-3`}>
                {isReplacement ? 'Reposición' : 'Verificar'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Observations */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
        <label className="block text-sm font-semibold text-gray-700">Observaciones de Conformidad</label>
        <textarea
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          rows={3}
          placeholder="Detalle el estado de los materiales: condiciones, cantidades, especificaciones..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
        />
      </div>

      {/* Decision */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">¿Está todo conforme?</h3>

        <button
          type="button"
          onClick={onConforme}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-green-600 text-white text-base font-bold rounded-xl hover:bg-green-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <CheckCircle2 size={20} />
          {submitting ? 'Guardando...' : 'Sí, Todo Conforme — Despachar a Obra'}
        </button>

        <button
          type="button"
          onClick={() => setShowClaimForm(true)}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <XCircle size={20} />
          No Conforme — Registrar Inconformidades
        </button>
      </div>
    </div>
  );
}

// QUOTE_SELECTED — generate PO
function GeneratePOPanel({ status, submitting, notes, onNotes, onAction }) {
  const fromCostOverrun = status === 'COST_OVERRUN_APPROVED';
  const fromQuoteCost   = status === 'QUOTE_COST_APPROVED';
  const alreadyApproved = fromCostOverrun || fromQuoteCost;

  const bannerTitle = fromCostOverrun
    ? 'Sobrecosto Aprobado por Gerencia General'
    : fromQuoteCost
    ? 'Cotización Aprobada por Control de Proyecto'
    : 'Cotización Seleccionada';

  const bannerDesc = fromCostOverrun
    ? 'La Gerencia General autorizó el sobrecosto. Proceda a generar la Orden de Compra.'
    : fromQuoteCost
    ? 'Control de Proyecto verificó que la cotización está dentro del presupuesto. Proceda a generar la Orden de Compra.'
    : 'Verifique el monto de la cotización contra el presupuesto aprobado y genere la Orden de Compra.';

  const bannerColor = fromCostOverrun
    ? 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30'
    : 'bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/30';
  const bannerIcon = fromCostOverrun ? 'text-amber-600 dark:text-amber-400' : alreadyApproved ? 'text-green-600 dark:text-green-400' : 'text-indigo-600 dark:text-indigo-400';
  const bannerTextColor = fromCostOverrun ? 'text-amber-800 dark:text-amber-300' : alreadyApproved ? 'text-green-800 dark:text-green-300' : 'text-indigo-800 dark:text-indigo-300';
  const bannerDescColor = fromCostOverrun ? 'text-amber-700 dark:text-amber-300' : alreadyApproved ? 'text-green-700 dark:text-green-300' : 'text-indigo-700 dark:text-indigo-300';

  return (
    <div className="space-y-4">
      <div className={`${alreadyApproved ? bannerColor : 'bg-indigo-50 border-indigo-200 dark:bg-indigo-500/10 dark:border-indigo-500/30'} border rounded-xl p-4 flex gap-3`}>
        {fromCostOverrun ? (
          <AlertCircle size={16} className={`${bannerIcon} shrink-0 mt-0.5`} />
        ) : (
          <CheckCircle2 size={16} className={`${bannerIcon} shrink-0 mt-0.5`} />
        )}
        <div>
          <p className={`text-sm font-semibold ${bannerTextColor}`}>{bannerTitle}</p>
          <p className={`text-xs ${bannerDescColor} mt-0.5 leading-relaxed`}>{bannerDesc}</p>
        </div>
      </div>

      <NotesField value={notes} onChange={onNotes} />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Generar Orden de Compra</h2>

        <button
          type="button"
          onClick={() => onAction(true)}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-green-600 text-white text-base font-bold rounded-xl hover:bg-green-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
        >
          <Package size={20} />
          {submitting ? 'Procesando...' : 'Generar Orden de Compra'}
        </button>

        <p className="text-xs text-gray-400 text-center pt-1">
          Esta acción quedará registrada en el historial del requerimiento.
        </p>
      </div>
    </div>
  );
}

// IN_STOCK — informational, no action
function InStockPanel({ navigate }) {
  return (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-300 rounded-xl p-6 flex flex-col items-center text-center gap-3 dark:bg-teal-500/10 dark:border-teal-500/30">
        <CheckCircle2 size={40} className="text-teal-500" />
        <p className="text-base font-bold text-teal-800 dark:text-teal-300">Stock Disponible</p>
        <p className="text-sm text-teal-700 max-w-xs leading-relaxed dark:text-teal-300">
          El pedido ha sido derivado al Almacén para su atención y despacho a obra.
        </p>
        <button
          type="button"
          onClick={() => navigate('/rq/logistics')}
          className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 transition-colors"
        >
          Volver al Panel Logístico
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// PO_GENERATED — informational, no action
function POGeneratedPanel({ navigate }) {
  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-300 rounded-xl p-6 flex flex-col items-center text-center gap-3 dark:bg-indigo-500/10 dark:border-indigo-500/30">
        <Package size={40} className="text-indigo-500" />
        <p className="text-base font-bold text-indigo-800 dark:text-indigo-300">Orden de Compra Generada</p>
        <p className="text-sm text-indigo-700 max-w-xs leading-relaxed dark:text-indigo-300">
          La orden de compra ha sido registrada. El flujo continua con la recepción en almacén.
        </p>
        <button
          type="button"
          onClick={() => navigate('/rq/logistics')}
          className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
        >
          Volver al Panel Logístico
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

const ACTIONABLE_STATUSES = new Set([
  STATUS.VALIDATED,
  STATUS.STOCK_CHECK,
  STATUS.REQUIRES_PURCHASE,
  STATUS.QUOTING,
  STATUS.QUOTE_SELECTED,
]);

export default function LogisticsActionPage() {
  const { id }          = useParams();
  const navigate        = useNavigate();
  const { primaryRole } = useAuth();
  const { showToast }   = useToast();

  const [req,              setReq]              = useState(null);
  const [stockData,        setStockData]        = useState([]);
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [approvals,        setApprovals]        = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [notFound,     setNotFound]     = useState(false);
  const [notes,        setNotes]        = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  function requestConfirm({ title, message, confirmText, confirmColor, icon, onConfirm }) {
    setConfirmModal({ title, message, confirmText, confirmColor, icon, onConfirm });
  }

  // Derive acting role — prefer user's primary role; fall back to LOGISTICS_COORDINATOR
  const actingRole =
    primaryRole === ROLES.LOGISTICS_SUPERVISOR
      ? ROLES.LOGISTICS_SUPERVISOR
      : ROLES.LOGISTICS_COORDINATOR;

  useEffect(() => {
    const fetchReq = async () => {
      try {
        let requestData = null;

        if (/^\d+$/.test(id)) {
          const { data } = await getRequest(id);
          requestData = data;
        } else {
          const { data } = await getRequests({ rq_number: id, page_size: 1 });
          const results  = data.results ?? [];
          if (results.length > 0) {
            const { data: full } = await getRequest(results[0].id);
            requestData = full;
          }
        }

        if (!requestData) {
          setNotFound(true);
        } else {
          setReq(requestData);
          // Fetch real stock data from warehouse
          const items = requestData.items ?? [];
          if (items.length > 0) {
            try {
              const descriptions = items.map((i) => i.description);
              const projectId = requestData.project ?? requestData.project_id;
              const { data: stockResults } = await checkStock(projectId, descriptions);
              setStockData(stockResults);
            } catch {
              // Stock check failed — non-fatal, show items without stock
            }
          }
          // Fetch selected quotation and approvals if applicable
          try {
            const [{ getQuotations }, { getApprovals }] = await Promise.all([
              import('../../api/suppliers'),
              import('../../api/requests'),
            ]);
            const [quotsRes, approvalsRes] = await Promise.allSettled([
              getQuotations(requestData.id),
              getApprovals(requestData.id),
            ]);
            if (quotsRes.status === 'fulfilled') {
              const quotList = quotsRes.value.data.results ?? quotsRes.value.data ?? [];
              const selected = quotList.find((q) => q.is_selected);
              if (selected) setSelectedQuotation(selected);
            }
            if (approvalsRes.status === 'fulfilled') {
              setApprovals(approvalsRes.value.data.results ?? approvalsRes.value.data ?? []);
            }
          } catch {
            // Non-fatal
          }
        }
      } catch (err) {
        console.error('Error fetching request:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchReq();
  }, [id]);

  // ── Action dispatchers ──────────────────────────────────────────────────

  async function doAction(actionData, successMessage) {
    setSubmitting(true);
    setError(null);
    try {
      await performAction(req.id, {
        ...actionData,
        acting_role: actingRole,
        comments:    notes.trim() || actionData.comments || '',
      });
      showToast({ type: 'success', message: successMessage });
      setTimeout(() => navigate('/rq/logistics'), 250);
    } catch (err) {
      console.error('Error performing action:', err);
      const detail =
        err?.response?.data?.detail ??
        err?.response?.data ??
        'Error al procesar la acción.';
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
      setError(msg);
      showToast({ type: 'error', message: msg });
      setSubmitting(false);
    }
  }

  function handleStockCheck(allFromStock, summary, itemDecisions) {
    const hasAnyPurchase = !allFromStock;
    requestConfirm({
      title:        hasAnyPurchase ? 'Confirmar — Ítems Requieren Compra' : 'Confirmar — Todo de Stock',
      message:      hasAnyPurchase
        ? 'Algunos ítems no tienen stock disponible. El requerimiento pasará a cotización para los ítems que requieren compra.'
        : '¿Confirma que hay stock disponible en almacén para todos los ítems? El pedido será derivado al Almacén.',
      confirmText:  hasAnyPurchase ? 'Sí, Enviar a Cotización' : 'Sí, Todo de Stock',
      confirmColor: hasAnyPurchase ? 'bg-orange-500 hover:bg-orange-600' : 'bg-teal-600 hover:bg-teal-700',
      icon:         hasAnyPurchase ? ShoppingCart : CheckCircle2,
      onConfirm:    async () => {
        // Save supply_source for each item
        if (itemDecisions?.length > 0) {
          try {
            await updateRequestItems(req.id, itemDecisions);
          } catch (err) {
            console.error('Error saving item decisions:', err);
          }
        }
        doAction(
          {
            action:     'STOCK_CHECKED',
            extra_data: { has_stock: allFromStock },
            comments:   `Verificación de stock:\n${summary}`,
          },
          hasAnyPurchase
            ? 'Registrado. Puede proceder a solicitar cotizaciones para los ítems sin stock.'
            : 'Stock confirmado. El pedido ha sido derivado al Almacén.'
        );
      },
    });
  }

  function handleQuoteRequested() {
    requestConfirm({
      title:        'Confirmar Solicitud de Cotizaciones',
      message:      '¿Está seguro de solicitar cotizaciones a proveedores? El requerimiento pasará al estado "Cotizando".',
      confirmText:  'Sí, Solicitar',
      confirmColor: 'bg-blue-600 hover:bg-blue-700',
      icon:         ClipboardCheck,
      onConfirm:    () => doAction(
        {
          action:   'QUOTE_REQUESTED',
          comments: 'Cotizaciones solicitadas a proveedores.',
        },
        'Solicitud de cotizaciones registrada. El requerimiento pasa a estado Cotizando.'
      ),
    });
  }

  async function handleQuoteSelected(selectedQuotation) {
    requestConfirm({
      title:        'Confirmar Selección de Proveedor',
      message:      `¿Confirma seleccionar a ${selectedQuotation.supplier_name} por ${formatCurrency(selectedQuotation.total)} con entrega en ${selectedQuotation.delivery_days} días?`,
      confirmText:  'Sí, Seleccionar',
      confirmColor: 'bg-indigo-600 hover:bg-indigo-700',
      icon:         CheckCircle2,
      onConfirm:    async () => {
        setSubmitting(true);
        try {
          // Mark quotation as selected in backend first
          const { selectQuotation } = await import('../../api/suppliers');
          await selectQuotation(selectedQuotation.id);

          // Step 1: QUOTE_COMPARED (comparison done)
          if (req.status === STATUS.QUOTING) {
            await performAction(req.id, {
              action:     'QUOTE_COMPARED',
              acting_role: actingRole,
              comments:   'Cuadro comparativo de cotizaciones elaborado.',
            });
          }
          // Step 2: QUOTE_SELECTED (select provider)
          await performAction(req.id, {
            action:     'QUOTE_SELECTED',
            acting_role: actingRole,
            comments:   `Proveedor seleccionado: ${selectedQuotation.supplier_name} (RUC: ${selectedQuotation.supplier_ruc})\nTotal: ${formatCurrency(selectedQuotation.total)}\nPlazo: ${selectedQuotation.delivery_days} días\nCondiciones: ${selectedQuotation.payment_conditions || '—'}`,
          });
          showToast({ type: 'success', message: 'Proveedor seleccionado. La cotización pasará a verificación presupuestal.' });
          setTimeout(() => navigate('/rq/logistics'), 250);
        } catch (err) {
          const detail = err?.response?.data?.detail ?? 'Error al procesar la acción.';
          const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
          showToast({ type: 'error', message: msg });
        } finally {
          setSubmitting(false);
        }
      },
    });
  }

  function handlePOGenerated() {
    requestConfirm({
      title:        'Confirmar Generación de Orden de Compra',
      message:      '¿Está seguro de generar la Orden de Compra? Esta acción queda registrada en el historial del requerimiento.',
      confirmText:  'Sí, Generar Orden',
      confirmColor: 'bg-green-600 hover:bg-green-700',
      icon:         Package,
      onConfirm:    () => doAction(
        {
          action:     'PO_GENERATED',
          comments:   'Orden de compra generada.',
        },
        'Orden de Compra generada correctamente.'
      ),
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) return <LoadingSpinner />;

  if (notFound || !req) {
    return (
      <div className="flex flex-col items-center justify-center min-h-96 text-center">
        <AlertCircle size={48} className="text-red-300 mb-4" />
        <h2 className="text-xl font-bold text-gray-800">Requerimiento no encontrado</h2>
        <button
          onClick={() => navigate('/rq/logistics')}
          className="mt-4 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Volver al Panel Logístico
        </button>
      </div>
    );
  }

  const rqNumber  = req.rq_number ?? req.rqNumber;
  const items     = req.items ?? [];
  const reqStatus = req.status;

  // Show stock columns only when doing the stock check step
  const showStock = [STATUS.VALIDATED, STATUS.STOCK_CHECK].includes(reqStatus);

  // Determine which action panel to render
  function renderActionPanel() {
    switch (reqStatus) {
      case STATUS.VALIDATED:
      case STATUS.STOCK_CHECK:
        return (
          <StockCheckPanel
            items={items}
            stockData={stockData}
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            onAction={handleStockCheck}
          />
        );
      case STATUS.REQUIRES_PURCHASE:
        return (
          <RequestQuotesPanel
            items={items}
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            onAction={handleQuoteRequested}
          />
        );
      case STATUS.QUOTING:
      case STATUS.QUOTE_COMPARISON:
        return (
          <SelectQuotePanel
            requestId={req.id}
            items={items}
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            onAction={handleQuoteSelected}
          />
        );
      case STATUS.QUOTE_SELECTED:
        return (
          <div className="space-y-4">
            {/* Selected quotation details */}
            <div className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden dark:border-indigo-500/30">
              <div className="px-6 py-4 bg-indigo-50 border-b border-indigo-200 dark:bg-indigo-500/10 dark:border-indigo-500/30">
                <h3 className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">Cotización Seleccionada</h3>
              </div>
              {selectedQuotation ? (
                <div className="p-6 space-y-4">
                  {/* Supplier info */}
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-lg font-bold text-gray-800">{selectedQuotation.supplier_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">RUC: {selectedQuotation.supplier_ruc ?? '—'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">{formatCurrency(selectedQuotation.total_amount)}</p>
                      <div className="flex items-center gap-3 justify-end mt-1">
                        {selectedQuotation.delivery_days && (
                          <span className="text-xs text-gray-500">Entrega: <strong>{selectedQuotation.delivery_days} días</strong></span>
                        )}
                        {selectedQuotation.payment_terms && (
                          <span className="text-xs text-gray-500">Pago: <strong>{selectedQuotation.payment_terms}</strong></span>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Quotation items */}
                  {selectedQuotation.items?.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500">Ítem</th>
                            <th className="py-2 px-4 text-right text-xs font-semibold text-gray-500">Cant.</th>
                            <th className="py-2 px-4 text-right text-xs font-semibold text-gray-500">P. Unit.</th>
                            <th className="py-2 px-4 text-right text-xs font-semibold text-gray-500">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedQuotation.items.map((qi, idx) => (
                            <tr key={idx} className="border-b border-gray-50">
                              <td className="py-2 px-4 text-gray-700">{qi.description ?? qi.request_item_description ?? `Ítem ${idx + 1}`}</td>
                              <td className="py-2 px-4 text-right text-gray-600">{formatQty(qi.quantity)}</td>
                              <td className="py-2 px-4 text-right text-gray-600">{formatCurrency(qi.unit_price)}</td>
                              <td className="py-2 px-4 text-right font-semibold text-gray-800">{formatCurrency(qi.total_price)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td colSpan={4} className="p-0">
                              <div className="mx-4 my-3 bg-gradient-to-r from-indigo-50 to-indigo-100 border border-indigo-200 rounded-xl px-5 py-3 flex items-center justify-between dark:from-indigo-500/10 dark:to-indigo-500/10 dark:border-indigo-500/30">
                                <span className="text-sm font-bold text-indigo-800 uppercase tracking-wide dark:text-indigo-300">Total Cotización</span>
                                <span className="text-xl font-extrabold text-indigo-700 dark:text-indigo-300">{formatCurrency(selectedQuotation.total_amount)}</span>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-center text-gray-400 text-sm italic">
                  No se encontró cotización seleccionada para este requerimiento.
                </div>
              )}
            </div>

            {/* Status info */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3 dark:bg-blue-500/10 dark:border-blue-500/30">
              <Info size={16} className="text-blue-600 shrink-0 mt-0.5 dark:text-blue-400" />
              <div>
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">Pendiente de Verificación Presupuestal</p>
                <p className="text-xs text-blue-700 mt-0.5 dark:text-blue-300">
                  La cotización fue enviada a <strong>Control de Proyecto</strong> para verificar si está dentro del presupuesto.
                  Cuando Control apruebe, podrás generar la Orden de Compra.
                </p>
              </div>
            </div>

            <button
              onClick={() => navigate('/rq/logistics')}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 hover:shadow-lg transition-all shadow-md"
            >
              <ArrowLeft size={18} />
              Volver a Logística
            </button>
          </div>
        );
      case STATUS.QUOTE_COST_APPROVED:
      case STATUS.COST_OVERRUN_APPROVED:
        return (
          <GeneratePOPanel
            status={req.status}
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            onAction={handlePOGenerated}
          />
        );
      case STATUS.PO_GENERATED:
        return (
          <div className="space-y-4">
            {/* Info banner */}
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex gap-3 dark:bg-teal-500/10 dark:border-teal-500/30">
              <Package size={16} className="text-teal-600 shrink-0 mt-0.5 dark:text-teal-400" />
              <div>
                <p className="text-sm font-semibold text-teal-800 dark:text-teal-300">Orden de Compra Generada</p>
                <p className="text-xs text-teal-700 mt-0.5 leading-relaxed dark:text-teal-300">
                  La OC fue enviada al proveedor. Cuando los materiales lleguen, registre la recepción.
                </p>
              </div>
            </div>

            {/* Selected quotation summary */}
            {selectedQuotation && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Proveedor</p>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-base font-bold text-gray-800">{selectedQuotation.supplier_name}</p>
                    <p className="text-xs text-gray-400">RUC: {selectedQuotation.supplier_ruc ?? '—'}</p>
                  </div>
                  <p className="text-lg font-bold text-teal-700 dark:text-teal-300">{formatCurrency(selectedQuotation.total_amount)}</p>
                </div>
                {(selectedQuotation.delivery_days || selectedQuotation.payment_terms) && (
                  <div className="flex gap-3 mt-2">
                    {selectedQuotation.delivery_days && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">Entrega: {selectedQuotation.delivery_days} días</span>
                    )}
                    {selectedQuotation.payment_terms && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">Pago: {selectedQuotation.payment_terms}</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Items checklist */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-700">Ítems a Recibir ({items.length})</p>
              </div>
              <div className="divide-y divide-gray-50">
                {items.map((item) => (
                  <div key={item.id} className="px-5 py-3 flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800">{item.description}</p>
                      <p className="text-xs text-gray-400">{formatQty(item.quantity)} {item.unit}</p>
                    </div>
                    <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium shrink-0 ml-3 dark:bg-teal-500/10 dark:text-teal-300">Pendiente</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Reception form */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700">Registro de Recepción</h3>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Observaciones</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Estado de los materiales, condiciones de entrega, faltantes..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                />
              </div>

              <button
                type="button"
                onClick={() => requestConfirm({
                  title:        'Confirmar Recepción de Materiales',
                  message:      '¿Confirma que los materiales han sido recibidos del proveedor? Se registrará la recepción y pasará a verificación de conformidad.',
                  confirmText:  'Sí, Registrar Recepción',
                  confirmColor: 'bg-teal-600 hover:bg-teal-700',
                  icon:         Package,
                  onConfirm:    () => doAction(
                    { action: 'RECEIVED', comments: notes.trim() || 'Materiales recibidos del proveedor.' },
                    'Recepción registrada. Proceda a verificar conformidad.'
                  ),
                })}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-teal-600 text-white text-base font-bold rounded-xl hover:bg-teal-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
              >
                <Package size={20} />
                {submitting ? 'Registrando...' : 'Registrar Recepción de Materiales'}
              </button>
            </div>
          </div>
        );
      case STATUS.RECEIVING:
      case 'SUPPLIER_REPLACEMENT_RECEIVED':
        return (
          <ConformityCheckPanel
            items={items}
            isReplacement={req.status === 'SUPPLIER_REPLACEMENT_RECEIVED'}
            submitting={submitting}
            notes={notes}
            onNotes={setNotes}
            onConforme={() => requestConfirm({
              title:        'Confirmar Conformidad',
              message:      '¿Confirma que los materiales recibidos son conformes con la Orden de Compra? Se procederá a la entrega al Almacén de Obra.',
              confirmText:  'Sí, Todo Conforme',
              confirmColor: 'bg-green-600 hover:bg-green-700',
              icon:         CheckCircle2,
              onConfirm:    () => doAction(
                { action: 'QUALITY_APPROVED', comments: notes.trim() || (req.status === 'SUPPLIER_REPLACEMENT_RECEIVED' ? 'Reposición conforme. Materiales aceptados.' : 'Materiales conformes con la OC.') },
                'Conformidad aprobada. Proceda a despachar a obra.'
              ),
            })}
            onNoConforme={(claimText) => requestConfirm({
              title:        'Generar Reclamo al Proveedor',
              message:      '¿Confirma que los materiales NO cumplen con lo solicitado? Se generará un reclamo formal al proveedor y se solicitará el cambio.',
              confirmText:  'Sí, Generar Reclamo y Solicitar Cambio',
              confirmColor: 'bg-red-600 hover:bg-red-700',
              icon:         XCircle,
              onConfirm:    () => doAction(
                { action: 'QUALITY_REJECTED', comments: claimText },
                'Reclamo registrado. Se gestionará el cambio con el proveedor.'
              ),
            })}
          />
        );
      case STATUS.QUALITY_APPROVED:
        return (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex gap-3 dark:bg-green-500/10 dark:border-green-500/30">
              <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5 dark:text-green-400" />
              <div>
                <p className="text-sm font-semibold text-green-800 dark:text-green-300">Paso 16 — Entrega a Obra</p>
                <p className="text-xs text-green-700 mt-0.5 leading-relaxed dark:text-green-300">
                  Los materiales fueron verificados y están conformes. Despache al Almacén de Obra.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
              <label className="block text-sm font-semibold text-gray-700">Observaciones de Despacho</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Observaciones del despacho, condiciones de transporte..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <button
                type="button"
                onClick={() => requestConfirm({
                  title:        'Confirmar Despacho a Obra',
                  message:      '¿Confirma el despacho de los materiales al Almacén de Obra? El control pasará al equipo de almacén.',
                  confirmText:  'Sí, Despachar a Obra',
                  confirmColor: 'bg-blue-600 hover:bg-blue-700',
                  icon:         Truck,
                  onConfirm:    () => doAction(
                    { action: 'DISPATCHED', comments: notes.trim() || 'Materiales despachados a Almacén de Obra.' },
                    'Despacho registrado. Almacén de Obra tomará control de los materiales.'
                  ),
                })}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-blue-600 text-white text-base font-bold rounded-xl hover:bg-blue-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
              >
                <Truck size={20} />
                {submitting ? 'Guardando...' : 'Despachar a Almacén de Obra'}
              </button>
            </div>
          </div>
        );
      case STATUS.QUALITY_REJECTED:
        return (
          <div className="space-y-4">
            {/* Alert banner */}
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 flex gap-3 dark:bg-red-500/10 dark:border-red-500/30">
              <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5 dark:text-red-400" />
              <div>
                <p className="text-sm font-semibold text-red-800 dark:text-red-300">Materiales No Conformes</p>
                <p className="text-xs text-red-700 mt-0.5 leading-relaxed dark:text-red-300">
                  Los materiales no cumplen con lo solicitado. Envíe un reclamo formal al proveedor solicitando el cambio.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
              <label className="block text-sm font-semibold text-gray-700">Detalle del Reclamo</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Describa qué ítems fallaron, el motivo del rechazo, qué se espera del proveedor..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <button
                type="button"
                onClick={() => requestConfirm({
                  title:        'Enviar Reclamo al Proveedor',
                  message:      '¿Está seguro de enviar un reclamo formal al proveedor y solicitar el cambio de materiales? Se registrará el rechazo y se iniciará el proceso de reposición.',
                  confirmText:  'Sí, Enviar Reclamo y Solicitar Cambio',
                  confirmColor: 'bg-red-600 hover:bg-red-700',
                  icon:         XCircle,
                  onConfirm:    () => doAction(
                    { action: 'SUPPLIER_CLAIM_SENT', comments: notes.trim() || 'Reclamo formal enviado al proveedor. Se solicita cambio de materiales.' },
                    'Reclamo enviado al proveedor. Esperando reposición.'
                  ),
                })}
                disabled={submitting || !notes.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
              >
                <AlertCircle size={20} />
                {submitting ? 'Enviando...' : 'Enviar Reclamo y Solicitar Cambio'}
              </button>
              {!notes.trim() && (
                <p className="text-xs text-red-500 text-center mt-2">Debe detallar el motivo del reclamo antes de enviar.</p>
              )}
            </div>
          </div>
        );
      case 'SUPPLIER_CLAIM_SENT':
      case 'SUPPLIER_CLAIM_PENDING':
        return (
          <div className="space-y-4">
            {/* Status banner */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 dark:bg-amber-500/10 dark:border-amber-500/30">
              <Clock size={16} className="text-amber-600 shrink-0 mt-0.5 dark:text-amber-400" />
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Reclamo Enviado — Esperando Reposición del Proveedor</p>
                <p className="text-xs text-amber-700 mt-0.5 leading-relaxed dark:text-amber-300">
                  Se envió un reclamo formal al proveedor solicitando el cambio de materiales.
                  Cuando el proveedor entregue la reposición, regístrela para verificar conformidad nuevamente.
                </p>
              </div>
            </div>

            {/* Supplier info */}
            {selectedQuotation && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Proveedor con Reclamo</p>
                <p className="text-base font-bold text-gray-800">{selectedQuotation.supplier_name}</p>
                <p className="text-xs text-gray-400">RUC: {selectedQuotation.supplier_ruc ?? '—'}</p>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
              <label className="block text-sm font-semibold text-gray-700">Notas de Seguimiento</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Respuesta del proveedor, fecha estimada de reposición, acuerdos..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
              <button
                type="button"
                onClick={() => requestConfirm({
                  title:        'Registrar Reposición del Proveedor',
                  message:      '¿Confirma que el proveedor ha entregado los materiales de reemplazo? Se procederá a verificar conformidad nuevamente.',
                  confirmText:  'Sí, Reposición Recibida',
                  confirmColor: 'bg-teal-600 hover:bg-teal-700',
                  icon:         Package,
                  onConfirm:    () => doAction(
                    { action: 'SUPPLIER_REPLACEMENT_RECEIVED', comments: notes.trim() || 'Reposición recibida del proveedor.' },
                    'Reposición registrada. Verifique conformidad nuevamente.'
                  ),
                })}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-teal-600 text-white text-base font-bold rounded-xl hover:bg-teal-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
              >
                <Package size={20} />
                {submitting ? 'Registrando...' : 'Proveedor Entregó Reposición — Recibir'}
              </button>

              <button
                type="button"
                onClick={() => requestConfirm({
                  title:        'Actualizar Seguimiento',
                  message:      '¿Desea registrar una actualización del seguimiento del reclamo?',
                  confirmText:  'Sí, Actualizar',
                  confirmColor: 'bg-amber-500 hover:bg-amber-600',
                  onConfirm:    () => doAction(
                    { action: 'SUPPLIER_CLAIM_UPDATED', comments: notes.trim() || 'Seguimiento del reclamo actualizado.' },
                    'Seguimiento actualizado.'
                  ),
                })}
                disabled={submitting || !notes.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-amber-300 text-amber-700 text-sm font-bold rounded-xl hover:bg-amber-50 transition-all disabled:opacity-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10"
              >
                {submitting ? 'Guardando...' : 'Actualizar Seguimiento del Reclamo'}
              </button>
            </div>
          </div>
        );
      case STATUS.USER_CONFORMITY:
        return (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex gap-3 dark:bg-green-500/10 dark:border-green-500/30">
              <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5 dark:text-green-400" />
              <div>
                <p className="text-sm font-semibold text-green-800 dark:text-green-300">Paso 19 — Actualizar Status del RQ</p>
                <p className="text-xs text-green-700 mt-0.5 leading-relaxed dark:text-green-300">
                  El solicitante confirmó la recepción conforme de los materiales. Proceda a cerrar el requerimiento.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
              <label className="block text-sm font-semibold text-gray-700">Observaciones de Cierre</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Observaciones finales, resumen del proceso..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <button
                type="button"
                onClick={() => requestConfirm({
                  title:        'Cerrar Requerimiento',
                  message:      '¿Confirma el cierre del requerimiento? El solicitante ya confirmó conformidad. Esta acción es definitiva.',
                  confirmText:  'Sí, Cerrar RQ',
                  confirmColor: 'bg-green-600 hover:bg-green-700',
                  icon:         CheckCircle2,
                  onConfirm:    () => doAction(
                    { action: 'CLOSED', comments: notes.trim() || 'Requerimiento cerrado exitosamente. Conformidad del solicitante confirmada.' },
                    'Requerimiento cerrado exitosamente.'
                  ),
                })}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-green-600 text-white text-base font-bold rounded-xl hover:bg-green-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
              >
                <CheckCircle2 size={20} />
                {submitting ? 'Cerrando...' : 'Cerrar Requerimiento'}
              </button>
            </div>
          </div>
        );
      case STATUS.CLAIM_IN_REVIEW:
        return (
          <div className="space-y-4">
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 flex gap-3 dark:bg-red-500/10 dark:border-red-500/30">
              <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5 dark:text-red-400" />
              <div>
                <p className="text-sm font-semibold text-red-800 dark:text-red-300">Reclamo del Solicitante — Paso 18.2</p>
                <p className="text-xs text-red-700 mt-0.5 leading-relaxed dark:text-red-300">
                  El solicitante reportó inconformidades con los materiales entregados.
                  Gestione el reclamo al proveedor y solicite el cambio.
                </p>
              </div>
            </div>

            {/* Show the user's claim from approvals */}
            {approvals.filter(a => a.action === 'USER_CLAIMED').length > 0 && (
              <div className="bg-white rounded-xl border border-red-200 shadow-sm p-5 dark:border-red-500/30">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2 dark:text-red-400">Detalle del Reclamo del Solicitante</p>
                {approvals.filter(a => a.action === 'USER_CLAIMED').map((a, idx) => (
                  <div key={idx} className="bg-red-50 rounded-lg p-4 mt-2 first:mt-0 dark:bg-red-500/10">
                    <p className="text-sm text-gray-800 whitespace-pre-line">{a.comments}</p>
                    <p className="text-xs text-gray-400 mt-2">
                      {a.performed_by_name} — {a.performed_at ? new Date(a.performed_at).toLocaleString('es-PE') : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
              <label className="block text-sm font-semibold text-gray-700">Observaciones para el Reclamo al Proveedor</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Detalle del reclamo a enviar al proveedor, acciones a tomar..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <button
                type="button"
                onClick={() => requestConfirm({
                  title:        'Enviar Reclamo al Proveedor',
                  message:      '¿Confirma el envío del reclamo al proveedor y la solicitud de cambio? El proveedor deberá enviar materiales de reemplazo.',
                  confirmText:  'Sí, Enviar Reclamo al Proveedor',
                  confirmColor: 'bg-red-600 hover:bg-red-700',
                  icon:         AlertCircle,
                  onConfirm:    () => doAction(
                    { action: 'SUPPLIER_CLAIM_SENT', comments: notes.trim() || 'Reclamo formal enviado al proveedor por inconformidad del solicitante. Se solicita cambio.' },
                    'Reclamo enviado al proveedor. Esperando reposición.'
                  ),
                })}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 bg-red-600 text-white text-base font-bold rounded-xl hover:bg-red-700 hover:shadow-lg transition-all duration-200 disabled:opacity-50 shadow-md"
              >
                <AlertCircle size={20} />
                {submitting ? 'Enviando...' : 'Enviar Reclamo al Proveedor y Solicitar Cambio'}
              </button>
            </div>
          </div>
        );
      case STATUS.IN_STOCK:
        return <InStockPanel navigate={navigate} />;
      default:
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-500">
              No hay acciones disponibles para el estado actual de este requerimiento.
            </p>
            <button
              onClick={() => navigate('/rq/logistics')}
              className="mt-4 text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              Volver al Panel Logístico
            </button>
          </div>
        );
    }
  }

  return (
    <>
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Back */}
      <button
        onClick={() => navigate('/rq/logistics')}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft size={16} />
        Panel Logístico
      </button>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-300 rounded-xl dark:bg-red-500/10 dark:border-red-500/30">
          <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">Error al procesar la acción</p>
            <p className="text-sm text-red-600 mt-0.5 dark:text-red-400">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <XCircle size={18} />
          </button>
        </div>
      )}

      {/* Page title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 flex items-center gap-2">
            <Truck size={26} className="text-teal-600 dark:text-teal-400" />
            Gestión Logística
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="font-mono font-semibold text-teal-700 dark:text-teal-300">{rqNumber}</span>
            {' '}— {req.description}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PriorityBadge priority={req.priority} />
          <StatusBadge status={reqStatus} />
        </div>
      </div>

      {/* Progress bar */}
      <LogisticsProgressBar currentStatus={reqStatus} />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* LEFT: RQ details */}
        <div className="lg:col-span-3 space-y-5">
          {/* Info card */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">
              Información del Requerimiento
            </h2>
            <InfoRow
              icon={Building2}
              label="Proyecto"
              value={(req.project_code ?? req.projectCode) ? `${req.project_code ?? req.projectCode} — ${req.project_name ?? req.projectName}` : req.flow === 'ADMINISTRATIVE' ? 'Oficina Central' : '—'}
            />
            <InfoRow
              icon={User}
              label="Solicitante"
              value={req.requested_by_name ?? req.requestedByName}
            />
            <InfoRow
              icon={Calendar}
              label="Fecha Requerida"
              value={formatDate(req.fecha_necesidad ?? req.required_date ?? req.requiredDate)}
            />
            {(req.work_location ?? req.workLocation) && (
              <InfoRow
                icon={MapPin}
                label="Ubicación"
                value={req.work_location ?? req.workLocation}
              />
            )}
            {(req.estimated_cost ?? req.estimatedCost) && (
              <InfoRow
                icon={Package}
                label="Costo Estimado"
                value={formatCurrency(req.estimated_cost ?? req.estimatedCost)}
              />
            )}
            {req.justification && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Justificación
                </p>
                <p className="text-sm text-gray-700 leading-relaxed">{req.justification}</p>
              </div>
            )}
          </div>

          {/* Items table */}
          <ItemsTable items={items} showStock={showStock} stockData={stockData} />

        </div>

        {/* RIGHT: Action panel */}
        <div className="lg:col-span-2">
          {renderActionPanel()}
        </div>
      </div>

      {/* Historial section - full width */}
      {approvals.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Historial del Requerimiento</h2>
          <ApprovalChain approvals={approvals} />
        </div>
      )}
    </div>

    {/* Confirm modal */}
    {confirmModal && (
      <ConfirmModal
        isOpen
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        confirmColor={confirmModal.confirmColor}
        icon={confirmModal.icon}
        onConfirm={() => { setConfirmModal(null); confirmModal.onConfirm(); }}
        onCancel={() => setConfirmModal(null)}
      />
    )}
    </>
  );
}
