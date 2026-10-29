import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, RefreshCw, ShoppingCart } from 'lucide-react';
import CatalogCombobox from './CatalogCombobox';
import CoverageBadge from './CoverageBadge';
import NotesField from '../ui/NotesField';
import { ITEM_SOURCES, proposeItemSource } from '../../data/requestCapture';
import { formatQty } from '../../utils/quantity';
import {
  buildCoverageWarnings,
  buildItemDecisions,
  describeCoverageSentence,
  effectiveSupply,
  isLinkPending,
  suggestSupply,
} from '../../utils/stockCheck';

// ─────────────────────────────────────────────────────────────────────────────
// StockCheckPanel — SYSPCC-026 (VALIDATED / STOCK_CHECK, logistics)
//
// Per line: requested vs what the CENTRAL pool really has (net of what is owed
// to other RQs), the catalog product the line is linked to (confirm / change /
// mark off-catalog), its family ("Fuente") and where it will be served from.
//
// Everything about stock is ADVISORY: the decision (`has_stock`) stays with
// logistics and the workflow does exactly what it did before. Choosing
// "Atender de Stock" for a line the pool does not fully cover only asks for an
// explicit confirmation in the modal opened by `onAction`.
//
// The catalog link of a line is saved the moment it is picked (so the
// availability on screen is real); the origin / family travel with the final
// confirmation, which the parent aborts if saving them fails.
//
// A link the REQUESTER proposed shows "Por confirmar" until logistics confirms it
// (the server tells with `link_confirmed: false`). It is only a notice: the
// confirmation button is never disabled for it.
//
// Keyboard focus: the logistics clerk goes line by line, so when the control that had the
// focus goes away (a "Confirmar…" button that is no longer needed) the focus is moved to the
// button that replaces it on the SAME line (`focusRequest` + `focusTargets`); and the search
// box is made read-only, never disabled, while it saves (a disabled control loses the focus),
// and gets the focus and the typed text back if the save fails.
// ─────────────────────────────────────────────────────────────────────────────

/** What the line is linked to: from the availability row when there is one, else from the RQ line. */
function describeLink(item, row) {
  if (row) {
    return { kind: row.link_status, product: row.inventory_item };
  }
  if (item.inventory_item) {
    return {
      kind: 'LINKED',
      product: {
        id: item.inventory_item,
        product_code: item.inventory_item_code,
        description: item.inventory_item_description,
        unit: item.inventory_item_unit,
      },
    };
  }
  return { kind: item.is_off_catalog ? 'OFF_CATALOG' : 'UNLINKED', product: null };
}

function Stat({ label, value, unit, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-white border-gray-200',
    warn:    'bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30',
    ok:      'bg-green-50 border-green-200 dark:bg-green-500/10 dark:border-green-500/30',
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${tones[tone]}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-bold text-gray-800">{value}</p>
      {unit && <p className="text-xs text-gray-500">{unit}</p>}
    </div>
  );
}

/**
 * @param {object}   props
 * @param {Array}    props.items   RQ lines (id, line_number, description, quantity, unit, inventory_item*, is_off_catalog, item_source)
 * @param {{status: 'loading'|'ready'|'error', byItem: object}} props.availability
 * @param {() => void} props.onRetryAvailability
 * @param {(item: object, patch: object) => Promise<{ok: boolean, message?: string}>} props.onLinkChange
 *        saves `{inventory_item}` or `{is_off_catalog: true}` for one line (update-items)
 * @param {boolean}  props.submitting
 * @param {string}   props.notes
 * @param {(text: string) => void} props.onNotes
 * @param {(allFromStock: boolean, summary: string, decisions: Array, warnings: Array) => void} props.onAction
 */
export default function StockCheckPanel({
  items,
  availability,
  onRetryAvailability,
  onLinkChange,
  submitting,
  notes,
  onNotes,
  onAction,
}) {
  const baseId = useId();
  const [choices, setChoices] = useState({});          // explicit origin per line id: 'stock' | 'purchase'
  const [itemSources, setItemSources] = useState({});  // explicit family per line id
  const [proposedSources, setProposedSources] = useState({}); // line ids whose family was proposed from the product
  const [editingId, setEditingId] = useState(null);    // line whose product is being changed
  const [linking, setLinking] = useState({});          // { [id]: { saving, error } }
  const [focusRequest, setFocusRequest] = useState(null); // { itemId }: a new object per request, so it can repeat
  const focusTargets = useRef({});                     // itemId -> the "Cambiar…" / "Vincular…" button mounted now
  const [linkMessage, setLinkMessage] = useState('');
  const [confirmedHere, setConfirmedHere] = useState({}); // line ids whose proposed link was confirmed on this screen

  const byItem = availability.byItem;
  const availabilityLoading = availability.status === 'loading';
  const anySaving = Object.values(linking).some((s) => s.saving);
  const pendingLinks = items.filter((item) => !confirmedHere[item.id] && isLinkPending(item, byItem[item.id]));

  // Moves the focus once the commit that swapped the buttons is on screen. An `autoFocus` prop
  // would not do: it only fires when the button MOUNTS, and the sibling that stays mounted when
  // "Confirmar producto" disappears never mounts again.
  useEffect(() => {
    if (focusRequest) focusTargets.current[focusRequest.itemId]?.focus();
  }, [focusRequest]);

  const origins = items.map((item) => effectiveSupply(item.id, choices, byItem));
  const allAssigned = items.length > 0 && origins.every(Boolean);
  const hasAnyPurchase = origins.some((o) => o === 'purchase');
  const purchaseCount = origins.filter((o) => o === 'purchase').length;
  const stockCount = origins.filter((o) => o === 'stock').length;

  const warnings = availabilityLoading
    ? []
    : buildCoverageWarnings(items, choices, byItem);
  const warningText = warnings.length > 0
    ? `Atención: ${warnings.length} ${warnings.length === 1 ? 'ítem marcado' : 'ítems marcados'} para atender de stock no ${warnings.length === 1 ? 'está cubierto' : 'están cubiertos'} por completo.`
    : '';

  // Ref for the button that takes the focus after a line is resolved (one per line at a time).
  const focusTargetRef = (itemId) => (el) => {
    if (!el) return undefined;
    focusTargets.current[itemId] = el;
    return () => {
      if (focusTargets.current[itemId] === el) delete focusTargets.current[itemId];
    };
  };

  // `confirming`: logistics accepts the link the requester proposed (same value, sent again).
  // Resolves to whether it was saved (the search box uses it to give the typed text back).
  async function saveLink(item, patch, product, { confirming = false } = {}) {
    setLinking((prev) => ({ ...prev, [item.id]: { saving: true, error: null } }));
    setLinkMessage('');
    const outcome = await onLinkChange(item, patch);
    setLinking((prev) => ({
      ...prev,
      [item.id]: { saving: false, error: outcome.ok ? null : (outcome.message ?? 'No se pudo guardar el vínculo.') },
    }));
    if (outcome.ok) {
      setEditingId(null);
      setFocusRequest({ itemId: item.id });
      setConfirmedHere((prev) => ({ ...prev, [item.id]: true }));
      setLinkMessage(
        patch.is_off_catalog
          ? (confirming ? 'Ítem confirmado como fuera de catálogo.' : 'Ítem marcado como fuera de catálogo.')
          : `${confirming ? 'Producto confirmado' : 'Producto vinculado'}: ${product?.product_code ?? ''}.`,
      );
      // Propose the family from the product category when nothing is set yet.
      const proposal = product ? proposeItemSource(product.category) : '';
      if (proposal && !itemSources[item.id] && !item.item_source) {
        setItemSources((prev) => ({ ...prev, [item.id]: proposal }));
        setProposedSources((prev) => ({ ...prev, [item.id]: true }));
      }
    }
    return outcome.ok;
  }

  function handleConfirm() {
    if (submitting || anySaving || availabilityLoading || !allAssigned) return;
    const decisions = buildItemDecisions(items, choices, byItem, itemSources);
    // Goes into the approval comment, so it is read in the RQ history: official labels (the same
    // ones as the toggle buttons) and whole words.
    const summary = items.map((item, idx) => {
      const row = byItem[item.id];
      const stock = row?.available_net != null
        ? `disponible neto: ${formatQty(row.available_net)}`
        : 'sin datos de stock';
      return `${item.description}: ${origins[idx] === 'stock' ? 'Atender de stock' : 'Requiere compra'} (${stock})`;
    }).join('\n');
    onAction(!hasAnyPurchase, summary, decisions, warnings);
  }

  // While the availability is on its way the coverage warnings cannot be computed, so
  // confirming now would skip the notice the design asks for. The wait is bounded: the query
  // has a timeout (STOCK_AVAILABILITY_TIMEOUT_MS), and when it fails or times out the state
  // changes to 'error' and the button opens (the warning then says the stock could not be
  // verified). A query that hangs can therefore never leave logistics unable to send the check.
  const confirmBlocked = submitting || anySaving || availabilityLoading || !allAssigned;
  const confirmHelp = anySaving
    ? 'Espere a que termine de guardarse el vínculo.'
    : !allAssigned
      ? 'Indique de dónde se atiende cada ítem.'
      : availabilityLoading ? 'Espere a que termine la consulta de disponibilidad.' : '';

  return (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex gap-3 dark:bg-teal-500/10 dark:border-teal-500/30">
        <Info size={16} aria-hidden="true" className="text-teal-600 shrink-0 mt-0.5 dark:text-teal-400" />
        <div>
          <p className="text-sm font-semibold text-teal-800 dark:text-teal-300">Verificación de Stock por Ítem</p>
          <p className="text-xs text-teal-700 mt-0.5 leading-relaxed dark:text-teal-300">
            Confirme el producto de cada ítem y marque si se atiende de stock o requiere compra. La
            disponibilidad es una referencia: la decisión es suya.
          </p>
        </div>
      </div>

      {availability.status === 'error' && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 dark:bg-red-500/10 dark:border-red-500/30">
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">No se pudo consultar la disponibilidad</p>
            <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
              Puede continuar, pero sin cifras de stock. Intente consultarla de nuevo.
            </p>
          </div>
          <button
            type="button"
            onClick={onRetryAvailability}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            <RefreshCw size={12} aria-hidden="true" />
            Reintentar
          </button>
        </div>
      )}

      {/* Always mounted so the announcements are reliable */}
      <div role="status" aria-live="polite" className="sr-only">{linkMessage}</div>
      <div role="status" aria-live="polite" className="sr-only">{warningText}</div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Decisión por Ítem</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Confirme el producto y el origen de atención de cada ítem.
          </p>
        </div>

        {items.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm italic text-gray-500">Sin ítems registrados.</p>
        ) : (
          <ul className="divide-y divide-gray-100" aria-busy={availabilityLoading}>
            {items.map((item, idx) => {
              const n = idx + 1;
              const row = byItem[item.id];
              const link = describeLink(item, row);
              const origin = origins[idx];
              const explicit = choices[item.id] !== undefined;
              const suggestedOnly = !explicit && suggestSupply(row) !== null;
              const state = linking[item.id] ?? { saving: false, error: null };
              const editing = editingId === item.id;
              const showSearch = editing || link.kind === 'UNLINKED';
              const family = itemSources[item.id] ?? item.item_source ?? '';
              const gap = row?.shortfall;
              const pending = !confirmedHere[item.id] && isLinkPending(item, row);
              const errorId = `${baseId}-${item.id}-link-error`;
              const gapTone = row && row.coverage && row.coverage !== 'FULL' ? 'warn' : row?.coverage === 'FULL' ? 'ok' : 'neutral';

              return (
                <li
                  key={item.id}
                  className={`px-6 py-4 transition-all ${
                    origin === 'stock' ? 'bg-teal-50/50 dark:bg-teal-500/10' : origin === 'purchase' ? 'bg-orange-50/50 dark:bg-orange-500/10' : ''
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="mt-0.5 shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600">{n}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{item.description}</p>
                        <p className="text-xs text-gray-500">Solicitado: {formatQty(item.quantity)} {item.unit}</p>
                      </div>
                    </div>
                    <CoverageBadge
                      className="shrink-0"
                      coverage={row?.coverage ?? null}
                      linkStatus={link.kind}
                      loading={availabilityLoading}
                    />
                  </div>

                  {/* Catalog link */}
                  <div className="ml-7 mb-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Producto del catálogo</p>

                    {link.kind === 'LINKED' && !editing && (
                      <div>
                        <p className="font-mono text-xs font-bold text-gray-800">{link.product?.product_code ?? '—'}</p>
                        <p className="text-xs text-gray-700">{link.product?.description}</p>
                        {pending && (
                          <p className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                            <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                            Por confirmar: este producto lo propuso el solicitante.
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {pending && (
                            <button
                              type="button"
                              aria-disabled={state.saving || undefined}
                              onClick={() => {
                                if (!state.saving) {
                                  saveLink(item, { inventory_item: link.product?.id ?? item.inventory_item }, link.product, { confirming: true });
                                }
                              }}
                              aria-label={`Confirmar el producto vinculado del ítem ${n}`}
                              className="rounded-lg border border-teal-700 bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-800"
                            >
                              Confirmar producto
                            </button>
                          )}
                          <button
                            type="button"
                            ref={focusTargetRef(item.id)}
                            aria-disabled={state.saving || undefined}
                            onClick={() => { if (!state.saving) setEditingId(item.id); }}
                            aria-label={`Cambiar el producto vinculado del ítem ${n}`}
                            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Cambiar producto
                          </button>
                          <button
                            type="button"
                            aria-disabled={state.saving || undefined}
                            onClick={() => { if (!state.saving) saveLink(item, { is_off_catalog: true }); }}
                            aria-label={`Marcar el ítem ${n} como fuera de catálogo`}
                            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Fuera de catálogo
                          </button>
                        </div>
                      </div>
                    )}

                    {link.kind === 'OFF_CATALOG' && !editing && (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-700">
                          Fuera de catálogo: este ítem no pasa por el almacén.
                        </p>
                        {pending && (
                          <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                            <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                            Por confirmar: el solicitante lo marcó fuera de catálogo.
                          </p>
                        )}
                        {pending && (
                          <button
                            type="button"
                            aria-disabled={state.saving || undefined}
                            onClick={() => { if (!state.saving) saveLink(item, { is_off_catalog: true }, null, { confirming: true }); }}
                            aria-label={`Confirmar el ítem ${n} como fuera de catálogo`}
                            className="mr-2 rounded-lg border border-teal-700 bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-800"
                          >
                            Confirmar fuera de catálogo
                          </button>
                        )}
                        <button
                          type="button"
                          ref={focusTargetRef(item.id)}
                          aria-disabled={state.saving || undefined}
                          onClick={() => { if (!state.saving) setEditingId(item.id); }}
                          aria-label={`Vincular el ítem ${n} a un producto del catálogo`}
                          className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          Vincular a un producto
                        </button>
                      </div>
                    )}

                    {showSearch && (
                      <div className="space-y-2">
                        {link.kind === 'UNLINKED' && !editing && (
                          <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                            <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                            Sin vincular: busque el producto del catálogo o márquelo como fuera de catálogo.
                          </p>
                        )}
                        <CatalogCombobox
                          id={`${baseId}-${item.id}-search`}
                          label={`Buscar el producto del catálogo para el ítem ${n}`}
                          autoFocus={editing}
                          busy={state.saving}
                          invalid={Boolean(state.error)}
                          describedBy={state.error ? errorId : undefined}
                          onSelect={(product) => saveLink(item, { inventory_item: product.id }, product)}
                        />
                        <div className="flex flex-wrap gap-2">
                          {link.kind !== 'OFF_CATALOG' && (
                            <button
                              type="button"
                              aria-disabled={state.saving || undefined}
                              onClick={() => { if (!state.saving) saveLink(item, { is_off_catalog: true }); }}
                              aria-label={`Marcar el ítem ${n} como fuera de catálogo`}
                              className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              Fuera de catálogo
                            </button>
                          )}
                          {editing && (
                            <button
                              type="button"
                              onClick={() => { setEditingId(null); setFocusRequest({ itemId: item.id }); }}
                              aria-label={`Cancelar el cambio de producto del ítem ${n}`}
                              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100"
                            >
                              Cancelar
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {state.saving && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                        <Loader2 size={12} aria-hidden="true" className="animate-spin" />
                        Guardando el vínculo…
                      </p>
                    )}
                    {state.error && (
                      <p id={errorId} role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                        <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                        {state.error}
                      </p>
                    )}
                  </div>

                  {/* Stock figures (CENTRAL pool, net of other RQs) */}
                  <div className="ml-7 mb-3">
                    {row ? (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <Stat label="Solicitado" value={formatQty(row.requested)} unit={row.unit} />
                          <Stat
                            label="Disponible neto (almacén central)"
                            value={row.available_net == null ? '—' : formatQty(row.available_net)}
                            unit={row.available_net == null ? '' : row.unit}
                          />
                          <Stat
                            label="Comprometido en otros RQ"
                            value={row.committed_other_requests == null ? '—' : formatQty(row.committed_other_requests)}
                            unit={row.committed_other_requests == null ? '' : row.unit}
                          />
                          <Stat
                            label="Faltante"
                            value={gap == null ? '—' : formatQty(gap)}
                            unit={gap == null ? '' : row.unit}
                            tone={gapTone}
                          />
                        </div>
                        <p className="mt-2 text-xs text-gray-600">
                          {describeCoverageSentence(row.coverage)
                            ?? (row.link_status === 'OFF_CATALOG'
                              ? 'Fuera de catálogo: no hay stock que comparar.'
                              : 'Vincule el producto para ver su disponibilidad.')}
                          {row.available_central != null && row.available_net != null && row.available_central !== row.available_net
                            ? ` Hay ${formatQty(row.available_central)} ${row.unit} en el almacén central; el resto está comprometido con otros RQ.`
                            : ''}
                        </p>
                      </>
                    ) : availabilityLoading ? (
                      <p className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Loader2 size={12} aria-hidden="true" className="animate-spin" />
                        Consultando la disponibilidad…
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500">Sin datos de disponibilidad para este ítem.</p>
                    )}
                  </div>

                  {/* Family + origin */}
                  <div className="ml-7 grid gap-3">
                    <div>
                      <label htmlFor={`${baseId}-${item.id}-family`} className="mb-1 block text-xs font-semibold text-gray-600">
                        Fuente del ítem
                      </label>
                      <select
                        id={`${baseId}-${item.id}-family`}
                        value={family}
                        onChange={(e) => {
                          setItemSources((prev) => ({ ...prev, [item.id]: e.target.value }));
                          setProposedSources((prev) => ({ ...prev, [item.id]: false }));
                        }}
                        className="w-full rounded-lg border border-gray-300 bg-transparent px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                      >
                        <option value="">-- Sin fuente --</option>
                        {ITEM_SOURCES.map((src) => (
                          <option key={src.value} value={src.value}>{src.label}</option>
                        ))}
                      </select>
                      {proposedSources[item.id] && (
                        <p className="mt-0.5 text-[11px] text-gray-500">Propuesta según el producto.</p>
                      )}
                    </div>

                    <div role="group" aria-label={`Origen de atención del ítem ${n}`} className="flex gap-2">
                      <button
                        type="button"
                        aria-pressed={origin === 'stock'}
                        onClick={() => setChoices((prev) => ({ ...prev, [item.id]: 'stock' }))}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all border-2 ${
                          origin === 'stock'
                            ? 'bg-teal-700 text-white border-teal-700 shadow-md'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-teal-300 hover:text-teal-700 dark:hover:border-teal-500/30 dark:hover:text-teal-300'
                        }`}
                      >
                        <CheckCircle2 size={16} aria-hidden="true" />
                        <span>
                          Atender de Stock
                          {origin === 'stock' && suggestedOnly && <span className="block text-xs font-normal">(sugerido)</span>}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={origin === 'purchase'}
                        onClick={() => setChoices((prev) => ({ ...prev, [item.id]: 'purchase' }))}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all border-2 ${
                          origin === 'purchase'
                            ? 'bg-orange-700 text-white border-orange-700 shadow-md'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300 hover:text-orange-700 dark:hover:border-orange-500/30 dark:hover:text-orange-300'
                        }`}
                      >
                        <ShoppingCart size={16} aria-hidden="true" />
                        <span>
                          Requiere Compra
                          {origin === 'purchase' && suggestedOnly && <span className="block text-xs font-normal">(sugerido)</span>}
                        </span>
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Advisory warning: stock chosen for lines the pool does not fully cover */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4 dark:bg-yellow-500/10 dark:border-yellow-500/30">
          <p className="flex items-center gap-2 text-sm font-semibold text-yellow-800 dark:text-yellow-300">
            <AlertCircle size={16} aria-hidden="true" className="shrink-0" />
            {warnings.length === 1 ? '1 ítem de stock sin cobertura completa' : `${warnings.length} ítems de stock sin cobertura completa`}
          </p>
          <p className="mt-1 text-xs text-yellow-800 dark:text-yellow-300">
            Puede continuar: se le pedirá confirmar. Si el stock no alcanza, lo recomendable es enviar
            el RQ a compra o crear un RQ complementario.
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-yellow-900 dark:text-yellow-200">
            {warnings.map((w) => (
              <li key={w.itemId}>
                <span className="font-semibold">Ítem {w.line}:</span> {w.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Advisory notice: products the requester proposed that logistics has not confirmed yet */}
      {pendingLinks.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-500/10 dark:border-amber-500/30">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-300">
            <AlertCircle size={16} aria-hidden="true" className="shrink-0" />
            {pendingLinks.length === 1 ? '1 producto por confirmar' : `${pendingLinks.length} productos por confirmar`}
          </p>
          <p className="mt-1 text-xs text-amber-900 dark:text-amber-300">
            {pendingLinks.length === 1
              ? 'Lo propuso el solicitante. Confírmelo con el botón del ítem (o cámbielo) para que el almacén mueva el producto correcto. Puede continuar sin confirmarlo.'
              : 'Los propuso el solicitante. Confírmelos con el botón de cada ítem (o cámbielos) para que el almacén mueva el producto correcto. Puede continuar sin confirmarlos.'}
          </p>
        </div>
      )}

      {allAssigned && (
        <div className={`rounded-xl border p-4 ${hasAnyPurchase ? 'bg-orange-50 border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30' : 'bg-teal-50 border-teal-200 dark:bg-teal-500/10 dark:border-teal-500/30'}`}>
          <p className={`text-sm font-semibold ${hasAnyPurchase ? 'text-orange-800 dark:text-orange-300' : 'text-teal-800 dark:text-teal-300'}`}>
            {!hasAnyPurchase
              ? 'Todos los ítems se pueden atender de stock.'
              : `${purchaseCount} ítem(s) requieren compra, ${stockCount} se atienden de stock.`}
          </p>
        </div>
      )}

      <NotesField value={notes} onChange={onNotes} />

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-3">
        <button
          type="button"
          onClick={handleConfirm}
          aria-disabled={confirmBlocked || undefined}
          aria-describedby={confirmHelp ? `${baseId}-confirm-help` : undefined}
          className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 text-white text-base font-bold rounded-xl transition-all duration-200 shadow-md ${
            confirmBlocked ? 'opacity-50 cursor-not-allowed' : ''
          } ${
            !allAssigned
              ? 'bg-gray-500'
              : hasAnyPurchase
              ? 'bg-orange-700 hover:bg-orange-800 hover:shadow-lg'
              : 'bg-teal-700 hover:bg-teal-800 hover:shadow-lg'
          }`}
        >
          {submitting ? 'Procesando...' : !allAssigned ? 'Marque todos los ítems arriba' : hasAnyPurchase ? 'Confirmar — Enviar a Cotización' : 'Confirmar — Todo de Stock'}
        </button>
        {confirmHelp && <p id={`${baseId}-confirm-help`} className="text-center text-xs text-gray-500">{confirmHelp}</p>}

        <p className="text-xs text-gray-500 text-center pt-1">
          Esta decisión quedará registrada en el historial del requerimiento.
        </p>
      </div>
    </div>
  );
}
