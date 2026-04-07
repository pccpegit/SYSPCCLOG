import { Check } from 'lucide-react';
import { LIFECYCLE_PHASES, getPhaseForStatus, STATUS } from '../../data/constants';

/**
 * Horizontal progress bar showing the lifecycle phases of a request.
 * @param {{ currentStatus: string }} props
 */
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
        <div className="mb-3 text-sm text-red-600 font-medium">
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
                {/* Circle row with connector lines */}
                <div className="flex items-center w-full">
                  {/* Left connector */}
                  {idx !== 0 && (
                    <div
                      className={`flex-1 h-0.5 ${
                        isCompleted || isActive ? 'bg-blue-500' : 'bg-gray-200'
                      }`}
                    />
                  )}

                  {/* Circle */}
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 z-10 transition-all duration-200 ${
                      isCompleted
                        ? 'bg-green-500 shadow-sm'
                        : isActive
                        ? 'bg-blue-600 ring-4 ring-blue-200 shadow-md pulse-attention'
                        : 'bg-gray-200'
                    }`}
                  >
                    {isCompleted ? (
                      <Check size={18} className="text-white" strokeWidth={3} />
                    ) : isActive ? (
                      <span className="w-3 h-3 rounded-full bg-white" />
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                    )}
                  </div>

                  {/* Right connector */}
                  {!isLast && (
                    <div
                      className={`flex-1 h-0.5 ${
                        isCompleted ? 'bg-blue-500' : 'bg-gray-200'
                      }`}
                    />
                  )}
                </div>

                {/* Phase label */}
                <span
                  className={`mt-2.5 text-sm font-medium text-center leading-tight px-1 ${
                    isCompleted
                      ? 'text-green-600 font-semibold'
                      : isActive
                      ? 'text-blue-700 font-bold'
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
