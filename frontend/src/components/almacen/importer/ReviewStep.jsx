import { useEffect, useRef, useState } from 'react';
import { Link2, Unlink, UserSearch } from 'lucide-react';
import { buildProjectMap, problemCodeLabel, projectDecision } from '../../../utils/almacenImport';
import { formatQty } from '../../../utils/almacen';
import WorkerCombobox from '../WorkerCombobox';
import ProblemsPanel from './ProblemsPanel';
import { Banner, Card, Chip, FocusHeading } from '../ui';
import { btnPrimary, btnSecondary, inputCls, thCls } from '../uiStyles';

const SHOWN_DESTINATIONS = 25;

function SummaryCard({ label, value, tone = 'default', hint }) {
  const toneCls = {
    default: 'text-gray-900',
    good: 'text-emerald-700 dark:text-emerald-400',
    warn: 'text-amber-700 dark:text-amber-300',
    bad: 'text-red-600 dark:text-red-400',
  }[tone];
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <dt className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</dt>
      <dd className={`text-2xl font-bold tabular-nums font-display mt-1 ${toneCls}`}>{formatQty(value ?? 0)}</dd>
      {hint && <dd className="text-xs text-gray-500 mt-0.5">{hint}</dd>}
    </div>
  );
}

/** «a, b y c» for a list of phrases. */
const joinPhrases = (items) => (items.length < 2
  ? (items[0] ?? '')
  : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

/** How many problems of each kind the workbook has, most frequent first (the table below has the detail). */
function ProblemTypeSummary({ byCode }) {
  const entries = Object.entries(byCode ?? {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="problem-types-title" className="space-y-2">
      <h3 id="problem-types-title" className="text-sm font-bold text-gray-700 uppercase tracking-wider font-display">
        Resumen por tipo de problema
      </h3>
      <ul className="flex flex-wrap gap-2">
        {entries.map(([code, count]) => (
          <li key={code}>
            <Chip tone="gray">{problemCodeLabel(code)}: <strong className="tabular-nums">{formatQty(count)}</strong></Chip>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectMapping({ projects, projectMap, onChange }) {
  if (!projects?.length) return null;
  return (
    <section aria-labelledby="project-mapping" className="space-y-3">
      <div>
        <h3 id="project-mapping" className="text-sm font-bold text-gray-700 uppercase tracking-wider font-display">Proyecto del libro</h3>
        <p className="text-xs text-gray-500 mt-1">Elija a qué proyecto del sistema corresponde cada etiqueta del libro.</p>
      </div>
      <ul className="space-y-3">
        {projects.map((project) => {
          const decision = projectDecision(project, projectMap);
          const selectId = `project-${project.label.replace(/\W+/g, '-')}`;
          const pendingId = `${selectId}-pending`;
          const value = decision === undefined ? '' : (decision === null ? 'none' : String(decision));
          return (
            <li key={project.label} className="rounded-xl border border-gray-100 bg-white p-4">
              <label htmlFor={selectId} className="block text-sm font-semibold text-gray-800">
                {project.label} <span className="font-normal text-gray-500">· {formatQty(project.items)} {project.items === 1 ? 'ítem' : 'ítems'}</span>
              </label>
              <select
                id={selectId}
                value={value}
                onChange={(e) => {
                  const next = e.target.value;
                  onChange(project.label, next === 'none' ? null : Number(next));
                }}
                aria-required="true"
                aria-invalid={decision === undefined ? true : undefined}
                aria-describedby={decision === undefined ? pendingId : undefined}
                className={`${inputCls(decision === undefined)} mt-2 max-w-md`}
              >
                {decision === undefined && <option value="" disabled>Elija una opción…</option>}
                {project.matches.map((m) => <option key={m.id} value={String(m.id)}>{m.code ? `${m.code} — ${m.name}` : m.name}</option>)}
                <option value="none">No asignar proyecto</option>
              </select>
              {decision === undefined && (
                <p id={pendingId} className="text-xs font-medium text-red-600 dark:text-red-400 mt-2">
                  Elija una opción para poder continuar.
                </p>
              )}
              {project.matches.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                  No existe un proyecto «{project.label}» en el sistema. Pida a un administrador crearlo en Sistema → Proyectos,
                  o elija «No asignar proyecto» para importar sin proyecto.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DestinationLinking({ destinations, links, onLink, onUnlink }) {
  const [activeKey, setActiveKey] = useState(null);
  const [showAll, setShowAll] = useState(false);
  // Id del botón que debe recibir el foco tras el próximo render (vincular, cancelar o desvincular):
  // sin esto el foco cae al body en una tabla de hasta cientos de filas.
  const pendingFocus = useRef(null);
  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });
  if (!destinations?.length) return null;
  const shown = showAll ? destinations : destinations.slice(0, SHOWN_DESTINATIONS);

  return (
    <section aria-labelledby="destinations-title" className="space-y-3">
      <div>
        <h3 id="destinations-title" className="text-sm font-bold text-gray-700 uppercase tracking-wider font-display">Destinos de egresos sin vincular</h3>
        <p className="text-xs text-gray-500 mt-1">
          Estos destinos no coinciden con un único trabajador de Personal. Puede vincularlos ahora o dejarlos como texto.
          Los nombres solo se muestran en pantalla y no se guardan en el navegador.
        </p>
      </div>
      <div className="rounded-2xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Destinos de egresos que no coinciden con Personal</caption>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left">
              <th scope="col" className={thCls}>Destino</th>
              <th scope="col" className={`${thCls} text-right`}>Filas</th>
              <th scope="col" className={thCls}>Coincidencia en Personal</th>
              <th scope="col" className={thCls}>Qué se hará</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((dest, idx) => {
              const link = links[dest.key];
              const ambiguous = Number(dest.candidates) > 1;
              const linkBtnId = `dest-${idx}-link`;
              const unlinkBtnId = `dest-${idx}-unlink`;
              return (
                <tr key={dest.key} className="align-top">
                  <td className="px-4 py-3 text-gray-900 font-medium min-w-[12rem]">{dest.display}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{dest.rows}</td>
                  <td className="px-4 py-3">
                    <Chip tone={ambiguous ? 'amber' : 'gray'}>
                      {ambiguous ? `Ambiguo (${dest.candidates} trabajadores)` : 'Sin coincidencia'}
                    </Chip>
                  </td>
                  <td className="px-4 py-3 min-w-[16rem]">
                    {link ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone="emerald" icon={Link2}>Vinculado a {link.name}</Chip>
                        <button
                          id={unlinkBtnId}
                          type="button"
                          onClick={() => { pendingFocus.current = linkBtnId; onUnlink(dest.key); }}
                          className={`${btnSecondary} !min-h-9 !px-3 !py-1.5 text-xs`}
                        >
                          <Unlink size={13} aria-hidden="true" /> Dejar como texto
                        </button>
                      </div>
                    ) : activeKey === dest.key ? (
                      <div className="space-y-2">
                        <WorkerCombobox
                          allowManual={false}
                          autoFocus
                          value={null}
                          onChange={(worker) => {
                            if (worker?.kind === 'personal') {
                              pendingFocus.current = unlinkBtnId;
                              onLink(dest.key, { id: worker.id, name: worker.name });
                              setActiveKey(null);
                            }
                          }}
                          aria-label={`Trabajador para el destino ${dest.display}`}
                        />
                        <button
                          type="button"
                          onClick={() => { pendingFocus.current = linkBtnId; setActiveKey(null); }}
                          className="text-xs font-semibold text-gray-600 hover:underline"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gray-600">Se guardará como texto.</span>
                        <button
                          id={linkBtnId}
                          type="button"
                          onClick={() => setActiveKey(dest.key)}
                          className={`${btnSecondary} !min-h-9 !px-3 !py-1.5 text-xs`}
                          aria-label={`Vincular el destino ${dest.display}`}
                        >
                          <UserSearch size={13} aria-hidden="true" /> Vincular
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {destinations.length > SHOWN_DESTINATIONS && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className={btnSecondary}>
          {showAll ? 'Mostrar menos' : `Mostrar los ${destinations.length} destinos`}
        </button>
      )}
    </section>
  );
}

/**
 * Paso 2: resumen de lo que haría la importación, problemas, proyecto y destinos.
 * Nada se escribió todavía en la base de datos.
 */
export default function ReviewStep({
  imp, projectMap, onProjectChange, destinationLinks, onLink, onUnlink, onContinue, onCancel, onRestart,
}) {
  const summary = imp.summary ?? {};
  const counts = summary.counts ?? {};
  const entries = summary.entries ?? {};
  const exits = summary.exits ?? {};
  const catalog = summary.catalog ?? {};
  const stock = summary.stock ?? {};
  const alreadyImported = (entries.already_imported ?? 0) + (exits.already_imported ?? 0);
  const skippedRows = summary.skipped_rows ?? 0;
  const mismatchedItems = stock.mismatched_items ?? 0;
  const absentImported = summary.by_code?.FILAS_IMPORTADAS_AUSENTES ?? 0;
  // «Yes» is only unreserved when nothing is dropped and the stock agrees with the book.
  const reservations = [
    skippedRows > 0 && `se omitirán ${formatQty(skippedRows)} ${skippedRows === 1 ? 'fila con errores' : 'filas con errores'}`,
    mismatchedItems > 0 && `${formatQty(mismatchedItems)} ${mismatchedItems === 1 ? 'ítem quedaría' : 'ítems quedarían'} con stock distinto al del libro`,
    absentImported > 0 && 'el libro ya no trae movimientos que se importaron antes',
  ].filter(Boolean);
  const blocked = !imp.can_confirm;
  const projectPending = buildProjectMap(imp.requires?.project_labels, imp.projects, projectMap) === null;
  const cannotContinue = blocked || projectPending;
  const continueReason = blocked
    ? 'No se puede continuar: el libro tiene problemas bloqueantes.'
    : (projectPending ? 'Para continuar, elija el proyecto del libro.' : '');

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-7 space-y-6">
        <div>
          <FocusHeading className="text-base font-bold text-gray-900 font-display">Paso 2 · Revisar</FocusHeading>
          <p className="text-sm text-gray-600 mt-1">Esto es lo que se importaría. Todavía no se guardó nada.</p>
        </div>

        {blocked ? (
          <Banner tone="red" live="assertive">
            El libro tiene {counts.blocker ?? 0} {(counts.blocker ?? 0) === 1 ? 'problema bloqueante' : 'problemas bloqueantes'} y no se puede importar.
            Corríjalo en Excel y vuelva a subir el archivo.
          </Banner>
        ) : reservations.length > 0 ? (
          <Banner tone="amber">
            <p className="font-semibold">¿Se puede importar? Sí, con reservas.</p>
            <p>
              {`${joinPhrases(reservations).replace(/^./, (c) => c.toUpperCase())}. `}
              Revise el detalle antes de continuar.
            </p>
          </Banner>
        ) : (
          <Banner tone="emerald">
            ¿Se puede importar? Sí. Revise las advertencias y elija el proyecto antes de continuar.
          </Banner>
        )}
        {absentImported > 0 && (
          <Banner tone="amber">
            Las filas que ya se importaron no se actualizan ni se borran. Si en el Excel cambió una fecha, un vale, un destino o una cantidad
            de una fila ya importada, esa fila se tomaría como un movimiento nuevo y el anterior seguiría registrado. Para corregir algo ya
            importado, registre un ajuste en el sistema.
          </Banner>
        )}

        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Ítems nuevos" value={catalog.new} tone="good" hint={`${formatQty(catalog.existing ?? 0)} ya existen`} />
          <SummaryCard label="Ingresos a importar" value={entries.to_import} tone="good" />
          <SummaryCard label="Egresos a importar" value={exits.to_import} tone="good" />
          <SummaryCard label="Ya importadas" value={alreadyImported} hint="No se duplican ni se actualizan" />
          <SummaryCard label="Con advertencias" value={counts.warning} tone={counts.warning ? 'warn' : 'default'} hint="Se importan con marca" />
          <SummaryCard label="Con errores" value={summary.skipped_rows} tone={summary.skipped_rows ? 'bad' : 'default'} hint="Se omitirán" />
          <SummaryCard label="Stock proyectado" value={stock.projected_total} hint={`Libro: ${formatQty(stock.sheet_total ?? 0)}`} />
          <SummaryCard label="Ítems con stock distinto al libro" value={stock.mismatched_items} tone={stock.mismatched_items ? 'warn' : 'good'} />
        </dl>

        {(stock.negative_items ?? 0) > 0 && (
          <Banner tone="red">{stock.negative_items} {stock.negative_items === 1 ? 'ítem quedaría' : 'ítems quedarían'} con stock negativo.</Banner>
        )}

        <ProblemTypeSummary byCode={summary.by_code} />
        <ProblemsPanel importId={imp.id} summary={summary} />
        <ProjectMapping projects={imp.projects} projectMap={projectMap} onChange={onProjectChange} />
        <DestinationLinking destinations={imp.unmatched_destinations} links={destinationLinks} onLink={onLink} onUnlink={onUnlink} />
      </Card>

      <div className="flex flex-col-reverse sm:flex-row gap-3">
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancelar importación</button>
        <button type="button" onClick={onRestart} className={btnSecondary}>Subir otro archivo</button>
        <button
          type="button"
          onClick={() => { if (!cannotContinue) onContinue(); }}
          aria-disabled={cannotContinue}
          aria-describedby={continueReason ? 'review-continue-reason' : undefined}
          className={`${btnPrimary} sm:ml-auto`}
        >
          Continuar a la confirmación
        </button>
      </div>
      {continueReason && (
        <p id="review-continue-reason" className="text-xs font-medium text-gray-600 sm:text-right">{continueReason}</p>
      )}
    </div>
  );
}
