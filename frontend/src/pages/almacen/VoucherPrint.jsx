import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { getVoucher } from '../../api/almacen';
import { ucFirst, formatDateLong } from '../../utils/format';
import { WAREHOUSE_LABELS_FULL as WAREHOUSE_LABELS } from '../../data/almacenConstants';

const PRINT_STYLES = `
  @media print {
    body * { visibility: hidden !important; }
    #voucher-print, #voucher-print * { visibility: visible !important; }
    #voucher-print {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      font-size: 12px !important;
    }
    .no-print { display: none !important; }
  }
`;

const DESTINATION_LABELS = { PROJECT: 'Proyecto', DEPARTMENT: 'Area / Departamento', EMPLOYEE: 'Colaborador' };


function InfoLine({ label, value }) {
  return (
    <div className="flex gap-2 text-sm py-1.5">
      <span className="font-semibold text-gray-600 min-w-[130px] shrink-0">{label}:</span>
      <span className="text-gray-900 font-medium">{value ?? '\u2014'}</span>
    </div>
  );
}

export default function VoucherPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [voucher, setVoucher] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    getVoucher(id)
      .then((res) => setVoucher(res.data))
      .catch(() => setError('No se pudo cargar el vale de salida.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-emerald-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} /> Volver</button>
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300 text-sm rounded-xl px-4 py-3">{error}</div>
      </div>
    );
  }

  const items = voucher?.items ?? [];

  return (
    <>
      <style>{PRINT_STYLES}</style>

      <div className="max-w-3xl mx-auto space-y-5">
        {/* Toolbar */}
        <div className="no-print flex items-center justify-between">
          <button onClick={() => navigate('/almacen/movimientos')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
            <ArrowLeft size={16} /> Volver a movimientos
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-all duration-150 shadow-lg shadow-emerald-600/20 active:scale-[0.97] active:shadow-md font-display">
            <Printer size={16} /> Imprimir
          </button>
        </div>

        {/* Voucher */}
        <div id="voucher-print" className="bg-white rounded-2xl border border-gray-200 p-7 sm:p-10 space-y-7">
          {/* Header */}
          <div className="flex items-start justify-between pb-5 border-b-2 border-gray-900">
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight font-display">PCC S.A.C.</h1>
              <p className="text-xs text-gray-500 mt-0.5">Proyectos, Construccion &amp; Comisionamiento</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-gray-600 uppercase tracking-[0.15em]">Vale de Salida</p>
              <p className="text-2xl font-black text-emerald-700 mt-1 tabular-nums">#{voucher?.movement_number ?? voucher?.id}</p>
            </div>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
            <InfoLine label="Fecha" value={formatDateLong(voucher?.created_at ?? voucher?.date)} />
            <InfoLine label="Tipo de destino" value={DESTINATION_LABELS[voucher?.destination_type] ?? voucher?.destination_type} />
            <InfoLine label="Almacen" value={WAREHOUSE_LABELS[voucher?.warehouse] ?? voucher?.warehouse} />
            <InfoLine label="Destino" value={voucher?.destination_detail} />
            <InfoLine label="Solicitado por" value={voucher?.requested_by} />
            <InfoLine label="Registrado por" value={voucher?.registered_by_name ?? voucher?.registered_by} />
          </div>

          {/* Items table */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.15em] mb-3">Materiales despachados</p>
            <table className="w-full text-sm border border-gray-200 rounded-xl overflow-hidden">
              <thead>
                <tr className="bg-gray-900 text-white">
                  <th className="px-4 py-3 text-left text-xs font-semibold">Codigo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold">Descripcion</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold">Unidad</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold">Cantidad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {voucher?.item ? (
                  <tr>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{voucher.item.product_code}</td>
                    <td className="px-4 py-3 text-gray-800 font-medium">{voucher.item.description}</td>
                    <td className="px-4 py-3 text-center text-gray-500">{ucFirst(voucher.item.unit)}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900 tabular-nums">{voucher.item.quantity}</td>
                  </tr>
                ) : items.length > 0 ? (
                  items.map((it, idx) => (
                    <tr key={idx} className="odd:bg-white even:bg-gray-50/60">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{it.product_code ?? it.code}</td>
                      <td className="px-4 py-3 text-gray-800 font-medium">{it.description ?? it.name}</td>
                      <td className="px-4 py-3 text-center text-gray-500">{it.unit}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 tabular-nums">{it.quantity}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-3 text-gray-400 text-center" colSpan={4}>Sin items</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Notes */}
          {voucher?.notes && (
            <div className="bg-gray-50 rounded-xl px-5 py-3.5 text-sm text-gray-600 border border-gray-200">
              <span className="font-bold text-gray-700">Observaciones: </span>{voucher.notes}
            </div>
          )}

          {/* Signatures */}
          <div className="grid grid-cols-3 gap-8 pt-10 mt-4 border-t border-gray-200">
            {['Entrego', 'Recibio', 'Autorizo'].map((label) => (
              <div key={label} className="flex flex-col items-center gap-2">
                <div className="w-full border-b-2 border-gray-400 h-12" />
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{label}</p>
              </div>
            ))}
          </div>

          {/* Footer */}
          <p className="text-center text-[10px] text-gray-400 border-t border-gray-100 pt-4">
            PCC S.A.C. \u2014 Sistema de Gestion de Almacen \u2014 Generado el{' '}
            {formatDateLong(new Date().toISOString())}
          </p>
        </div>
      </div>
    </>
  );
}
