import { PartyPopper } from 'lucide-react';
import { COPY } from '../../../utils/cvCopy';
import { NOTE, noteBase } from './cvStyles';

/**
 * Short, respectful celebration: once, no sound, no confetti, no blinking,
 * motion-safe only, and it is not auto-dismissed. Mounted only on the
 * PROCESSING -> finished transition seen in this session. It is a VISUAL
 * reinforcement: the end of the run is announced by the page's persistent
 * live region (a live region that appears already filled is not announced
 * reliably, and a second role="status" here would announce it twice).
 */
export default function CVCompletionBanner({ counts }) {
  return (
    <div className={`${noteBase} ${NOTE.green} items-center`}>
      <PartyPopper
        size={28}
        className="shrink-0 motion-safe:animate-[fadeIn_0.6s_ease-out_1]"
        aria-hidden="true"
      />
      <div>
        <p className="text-base font-extrabold font-display">{COPY.results.doneBanner(counts.done, counts.total)}</p>
        {counts.failed > 0 && <p className="text-sm">{COPY.results.doneErrors(counts.failed)}</p>}
      </div>
    </div>
  );
}
