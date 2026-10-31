import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { ariaSortFor } from '../../utils/requestMaster';
import { TH_CLS } from './styles';


/** Encabezado de columna; con `field` y `onOrder` es un botón que ordena (asc -> desc -> sin orden). */
export default function SortableTh({ label, field, ordering, onOrder, align = 'left', className = '' }) {
  const alignCls = align === 'right' ? 'text-right' : 'text-left';
  if (!field || !onOrder) {
    return <th scope="col" className={`${TH_CLS} ${alignCls} ${className}`}>{label}</th>;
  }
  const sort = ariaSortFor(ordering, field);
  const Icon = sort === 'ascending' ? ArrowUp : sort === 'descending' ? ArrowDown : ArrowUpDown;
  return (
    <th scope="col" aria-sort={sort} className={`${TH_CLS} ${alignCls} ${className}`}>
      <button
        type="button"
        onClick={() => onOrder(field)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 rounded ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <Icon size={12} aria-hidden="true" className={sort === 'none' ? 'opacity-40' : 'text-blue-600 dark:text-blue-400'} />
      </button>
    </th>
  );
}
