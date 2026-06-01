// ---------------------------------------------------------------------------
// A single kanban column (collapsed or expanded) with its cards
// ---------------------------------------------------------------------------

import { Icon } from './Icon';
import { KCard } from './KCard';
import { columnFromLaneState } from './format';
import type { KanbanColumn, LaneState, UnifiedIssue } from './types';

export interface ColumnView {
  key: KanbanColumn;
  laneKey?: LaneState;
  label: string;
  accent: string;
  count: number;
  builtin: boolean;
}

export function BoardColumnView({
  col,
  items,
  collapsed,
  isDragTarget,
  isDragging,
  isColumnDropTarget,
  selectedId,
  logs,
  tokenHistory,
  loadingAction,
  onColumnDragOver,
  onColumnDragLeave,
  onColumnDrop,
  onColumnDragStart,
  onColumnDragEnd,
  onToggleCollapsed,
  onDeleteColumn,
  onSelect,
  onStart,
  onStop,
  onResume,
  onDelete,
  onDismiss,
  onCardDragStart,
}: {
  col: ColumnView;
  items: UnifiedIssue[];
  collapsed: boolean;
  isDragTarget: boolean;
  isDragging: boolean;
  isColumnDropTarget: boolean;
  selectedId: string | null;
  logs: Record<string, string[]>;
  tokenHistory: Record<string, number[]>;
  loadingAction: string | null;
  onColumnDragOver: (e: React.DragEvent, key: KanbanColumn) => void;
  onColumnDragLeave: () => void;
  onColumnDrop: (e: React.DragEvent, key: KanbanColumn) => void;
  onColumnDragStart: (e: React.DragEvent, key: KanbanColumn) => void;
  onColumnDragEnd: () => void;
  onToggleCollapsed: (key: KanbanColumn) => void;
  onDeleteColumn: (key: KanbanColumn) => void;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string, identifier: string) => void;
  onDismiss: (id: string) => void;
  onCardDragStart: (e: React.DragEvent, issueId: string, fromColumn: KanbanColumn) => void;
}) {
  if (collapsed) {
    return (
      <div
        onDragOver={(e) => onColumnDragOver(e, col.key)}
        onDragLeave={onColumnDragLeave}
        onDrop={(e) => onColumnDrop(e, col.key)}
        onClick={() => onToggleCollapsed(col.key)}
        title={`Expand ${col.label}`}
        style={{
          width: 42,
          flexShrink: 0,
          border: isColumnDropTarget
            ? '1px dashed oklch(0.72 0.16 55)'
            : isDragTarget
            ? '1px dashed oklch(0.72 0.16 55)'
            : '1px solid var(--k-border)',
          borderRadius: 10,
          background: isDragTarget
            ? 'oklch(0.72 0.16 55 / 0.06)'
            : 'var(--k-surface-1)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '10px 0',
          gap: 10,
          cursor: 'pointer',
          opacity: isDragging ? 0.4 : 1,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: col.accent,
            boxShadow: `0 0 8px ${col.accent}80`,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--k-fg-muted)',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            userSelect: 'none',
          }}
        >
          {col.label}
        </div>
        <span
          style={{
            fontSize: 10,
            color: 'var(--k-fg-dim)',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
          }}
        >
          {col.count}
        </span>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => onColumnDragOver(e, col.key)}
      onDragLeave={onColumnDragLeave}
      onDrop={(e) => onColumnDrop(e, col.key)}
      style={{
        width: 300,
        flexShrink: 0,
        border: isColumnDropTarget
          ? '1px dashed oklch(0.72 0.16 55)'
          : isDragTarget
          ? '1px dashed oklch(0.72 0.16 55)'
          : '1px solid var(--k-border)',
        borderRadius: 10,
        background: isDragTarget
          ? 'oklch(0.72 0.16 55 / 0.06)'
          : 'var(--k-surface-1)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity .12s',
      }}
    >
      <div
        draggable
        onDragStart={(e) => onColumnDragStart(e, col.key)}
        onDragEnd={onColumnDragEnd}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid var(--k-border)',
          cursor: 'grab',
          userSelect: 'none',
        }}
        title="Drag to reorder column"
      >
        <span
          style={{
            color: 'var(--k-fg-dim)',
            display: 'inline-flex',
            alignItems: 'center',
            marginRight: -2,
          }}
        >
          <Icon name="grip" size={12} />
        </span>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: col.accent,
            boxShadow: `0 0 8px ${col.accent}80`,
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--k-fg)' }}>
          {col.label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--k-fg-dim)',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
          }}
        >
          {col.count}
        </span>
        <span style={{ flex: 1 }} />
        {!col.builtin && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteColumn(col.key);
            }}
            title={`Delete ${col.label}`}
            style={{
              padding: 4,
              borderRadius: 4,
              background: 'transparent',
              border: 0,
              color: 'var(--k-fg-muted)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="trash" size={13} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed(col.key);
          }}
          title={`Collapse ${col.label}`}
          style={{
            padding: 4,
            borderRadius: 4,
            background: 'transparent',
            border: 0,
            color: 'var(--k-fg-muted)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="chevronL" size={14} />
        </button>
      </div>

      <div
        className="scroll-kanban"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {items.map((issue) => (
          <KCard
            key={issue.id}
            issue={issue}
            selected={issue.id === selectedId}
            onClick={() => onSelect(issue.id)}
            onStart={() => onStart(issue.id)}
            onStop={() => onStop(issue.id)}
            onResume={() => onResume(issue.id)}
            onDelete={() => onDelete(issue.id, issue.identifier)}
            onDismiss={() => onDismiss(issue.id)}
            miniLog={logs[issue.id]}
            spark={tokenHistory[issue.id]}
            loadingAction={loadingAction}
            draggable={issue.state !== 'done'}
            onDragStart={(e) =>
              onCardDragStart(e, issue.id, columnFromLaneState(issue.state))
            }
          />
        ))}
        {items.length === 0 && (
          <div
            style={{
              color: 'var(--k-fg-dim)',
              fontSize: 11,
              textAlign: 'center',
              padding: '14px 0',
              fontFamily: 'var(--font-jetbrains-mono), monospace',
            }}
          >
            {col.builtin ? '—' : 'empty'}
          </div>
        )}
      </div>
    </div>
  );
}
