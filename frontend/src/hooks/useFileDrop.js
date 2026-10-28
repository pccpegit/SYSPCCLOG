import { useRef, useState } from 'react';
import { collectDroppedFiles } from '../utils/cvFiles';

const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

/**
 * Drag-and-drop for a container (files and folders). `dropProps` goes on the
 * container; `dragging` drives the "Suelta para agregar" state (text + border,
 * not only color).
 */
export default function useFileDrop({ onFiles, disabled = false }) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const dropProps = disabled
    ? {}
    : {
        onDragEnter: (e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          depth.current += 1;
          setDragging(true);
        },
        onDragOver: (e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: () => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        },
        onDrop: async (e) => {
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          const files = await collectDroppedFiles(e.dataTransfer);
          if (files.length) onFiles(files);
        },
      };

  return { dragging, dropProps };
}
