// ---------------------------------------------------------------------------
// Streaming log tail
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, type CSSProperties } from 'react';

export function LogTail({
  lines,
  height = 180,
}: {
  lines: string[];
  height?: number | string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (pinned && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, pinned]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setPinned(nearBottom);
  };

  const slice = lines.slice(-60);
  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className="scroll-kanban-log"
      style={{
        height,
        overflowY: 'auto',
        overflowX: 'hidden',
        fontFamily: 'var(--font-jetbrains-mono), monospace',
        fontSize: 11,
        lineHeight: 1.55,
        color: 'var(--k-fg)',
        padding: '8px 10px',
        background: 'var(--k-log-bg)',
        borderRadius: 8,
        border: '1px solid var(--k-border)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {slice.map((l, i) => {
        const isCmd = l.startsWith('$');
        const isMeta = l.startsWith('>');
        const style: CSSProperties = {
          color: isCmd ? '#f5c050' : isMeta ? 'var(--k-fg)' : 'var(--k-fg-muted)',
          opacity: i < slice.length - 8 ? 0.65 : 1,
        };
        return (
          <div key={i} style={style}>
            {l}
          </div>
        );
      })}
      <span style={{ color: '#6bd69c' }} className="caret">
        ▌
      </span>
    </div>
  );
}
