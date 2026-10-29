import { useId } from 'react';

/** Notes / comments box shared by the logistics action panels. */
export default function NotesField({ value, onChange }) {
  const id = useId();
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <label htmlFor={id} className="block text-sm font-semibold text-gray-800 mb-2">
        Notas / Comentarios
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="Observaciones, condiciones, referencias de cotización..."
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 hover:border-gray-400 transition-colors resize-none"
      />
      <p className="mt-1 text-xs text-gray-500">{value.length} / 500 caracteres</p>
    </div>
  );
}
