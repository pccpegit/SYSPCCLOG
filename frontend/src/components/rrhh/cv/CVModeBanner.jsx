import { AlertTriangle, FlaskConical, Info, RefreshCw } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import { NOTE, noteBase, btnLink } from './cvStyles';

/**
 * Banner for the module: simulated test mode (always visible when the
 * backend runs the fake provider), AI not configured (friendly) or a failed
 * config request.
 */
export default function CVModeBanner({ config, isError = false, onRetry }) {
  if (isError && !config) {
    return (
      <div role="alert" className={`${noteBase} ${NOTE.red} items-center justify-between flex-wrap`}>
        <span className="flex items-center gap-2.5">
          <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
          {COPY.banners.configError}
        </span>
        {onRetry && (
          <button type="button" onClick={onRetry} className={btnLink}>
            <RefreshCw size={14} aria-hidden="true" /> {COPY.retry}
          </button>
        )}
      </div>
    );
  }
  if (!config) return null;

  if (config.simulated || config.provider === 'fake') {
    return (
      <div role="note" className={`${noteBase} ${NOTE.amber}`}>
        <FlaskConical size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          <strong className="font-semibold">{COPY.banners.simulated}</strong> {COPY.banners.simulatedHint}
        </p>
      </div>
    );
  }
  if (config.enabled === false) {
    return (
      <div role="note" className={`${noteBase} ${NOTE.info}`}>
        <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          <strong className="font-semibold">{COPY.banners.noKey}</strong> {COPY.banners.noKeyHint}
        </p>
      </div>
    );
  }
  return null;
}
