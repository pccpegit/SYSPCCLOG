import { Check } from 'lucide-react';
import { LIFECYCLE_PHASES, getPhaseForStatus, STATUS } from '../../data/constants';

export default function LifecycleBar({ currentStatus }) {
  const isCancelled = currentStatus === STATUS.CANCELLED;
  const isRejected = [
    STATUS.TECHNICAL_REJECTED,
    STATUS.GM_REJECTED,
    STATUS.QUALITY_REJECTED,
  ].includes(currentStatus);
  const isTerminal = isCancelled || isRejected;
  const activePhaseIdx = getPhaseForStatus(currentStatus);

  return (
    <div className="w-full">
      {isTerminal && (
        <div className="mb-3 text-xs font-bold text-red-600 bg-red-50 border border-red-200/60 rounded-lg px-3 py-2 font-display">
          {isCancelled ? 'Requerimiento cancelado' : 'Requerimiento rechazado'}
        </div>
      )}

      <div className="flex items-start">
        {LIFECYCLE_PHASES.map((phase, idx) => {
          const isCompleted = !isTerminal && idx < activePhaseIdx;
          const isActive    = !isTerminal && idx === activePhaseIdx;
          const isLast      = idx === LIFECYCLE_PHASES.length - 1;

          return (
            <div key={phase.id} className="flex items-start flex-1">
              <div className="flex flex-col items-center flex-1">
                <div className="flex items-center w-full">
                  {idx !== 0 && (
                    <div
                      className={`flex-1 h-0.5 transition-colors duration-300 ${
                        isCompleted || isActive ? 'bg-blue-500' : 'bg-gray-200'
                      }`}
                    />
                  )}

                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 z-10 transition-all duration-300 ${
                      isCompleted
                        ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-sm'
                        : isActive
                        ? 'bg-gradient-to-br from-blue-500 to-blue-700 ring-4 ring-blue-100 shadow-md'
                        : 'bg-gray-200'
                    }`}
                  >
                    {isCompleted ? (
                      <Check size={16} className="text-white" strokeWidth={3} />
                    ) : isActive ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-white" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-gray-400" />
                    )}
                  </div>

                  {!isLast && (
                    <div
                      className={`flex-1 h-0.5 transition-colors duration-300 ${
                        isCompleted ? 'bg-blue-500' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>

                <span
                  className={`mt-2 text-[11px] font-bold text-center leading-tight px-1 font-display ${
                    isCompleted
                      ? 'text-emerald-600'
                      : isActive
                      ? 'text-blue-700'
                      : 'text-gray-400'
                  }`}
                >
                  {phase.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
