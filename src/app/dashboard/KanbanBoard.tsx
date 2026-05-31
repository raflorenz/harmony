// ---------------------------------------------------------------------------
// Kanban board — column layout, drag & drop, and the add-column composer
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Icon } from './Icon';
import { BoardColumnView, type ColumnView } from './BoardColumnView';
import { COLUMN_DRAG_MIME, type BoardColumn, type KanbanColumn, type LaneState, type UnifiedIssue } from './types';

export function KanbanBoard({
  boardColumns,
  byState,
  collapsedColumns,
  selectedId,
  logs,
  tokenHistory,
  loadingAction,
  addingColumn,
  setAddingColumn,
  onSelect,
  onStart,
  onStop,
  onResume,
  onDelete,
  onDismiss,
  onAddColumn,
  onDeleteColumn,
  onReorderColumn,
  onToggleCollapsed,
}: {
  boardColumns: BoardColumn[];
  byState: Record<LaneState, UnifiedIssue[]>;
  collapsedColumns: Set<KanbanColumn>;
  selectedId: string | null;
  logs: Record<string, string[]>;
  tokenHistory: Record<string, number[]>;
  loadingAction: string | null;
  addingColumn: boolean;
  setAddingColumn: (v: boolean) => void;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string, identifier: string) => void;
  onDismiss: (id: string) => void;
  onAddColumn: (label: string) => void;
  onDeleteColumn: (key: KanbanColumn) => void;
  onReorderColumn: (fromKey: KanbanColumn, toKey: KanbanColumn) => void;
  onToggleCollapsed: (key: KanbanColumn) => void;
}) {
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumn | null>(null);
  const [draggedColumnKey, setDraggedColumnKey] = useState<KanbanColumn | null>(null);
  const [columnDropIndex, setColumnDropIndex] = useState<number | null>(null);
  const [newColumnLabel, setNewColumnLabel] = useState('');

  const columns: ColumnView[] = boardColumns.map((c) => ({
    key: c.key,
    laneKey: c.laneKey,
    label: c.label,
    accent: c.accent,
    count: c.laneKey ? byState[c.laneKey].length : 0,
    builtin: !!c.builtin,
  }));

  const isColumnDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(COLUMN_DRAG_MIME);

  const handleCardDragStart = (e: React.DragEvent, issueId: string, fromColumn: KanbanColumn) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ issueId, fromColumn }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleColumnDragStart = (e: React.DragEvent, columnKey: KanbanColumn) => {
    e.dataTransfer.setData(COLUMN_DRAG_MIME, columnKey);
    e.dataTransfer.setData('text/plain', `column:${columnKey}`);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedColumnKey(columnKey);
  };

  const handleColumnDragEnd = () => {
    setDraggedColumnKey(null);
    setColumnDropIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, column: KanbanColumn) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (isColumnDrag(e)) {
      setColumnDropIndex(boardColumns.findIndex((c) => c.key === column));
      setDragOverColumn(null);
    } else {
      setDragOverColumn(column);
    }
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, toColumn: KanbanColumn) => {
    e.preventDefault();
    setDragOverColumn(null);
    setColumnDropIndex(null);

    if (isColumnDrag(e)) {
      const fromKey = e.dataTransfer.getData(COLUMN_DRAG_MIME);
      setDraggedColumnKey(null);
      if (fromKey && fromKey !== toColumn) onReorderColumn(fromKey, toColumn);
      return;
    }

    const raw = e.dataTransfer.getData('text/plain');
    if (!raw || raw.startsWith('column:')) return;
    try {
      const payload = JSON.parse(raw) as { issueId: string; fromColumn: KanbanColumn };
      const { issueId, fromColumn } = payload;
      if (fromColumn === toColumn) return;
      if (fromColumn === 'todo' && toColumn === 'in-progress') {
        onStart(issueId);
      }
    } catch {
      /* invalid drag data */
    }
  };

  const submitNewColumn = () => {
    const label = newColumnLabel.trim();
    if (!label) return;
    onAddColumn(label);
    setNewColumnLabel('');
    setAddingColumn(false);
  };

  const cancelNewColumn = () => {
    setAddingColumn(false);
    setNewColumnLabel('');
  };

  return (
    <div
      className="scroll-kanban"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'stretch',
        gap: 10,
        padding: '16px 20px',
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {columns.map((col) => {
        const collapsed = collapsedColumns.has(col.key);
        const isDragTarget = dragOverColumn === col.key;
        const items: UnifiedIssue[] = col.laneKey ? byState[col.laneKey] : [];
        const isDragging = draggedColumnKey === col.key;
        const isColumnDropTarget =
          columnDropIndex !== null &&
          boardColumns[columnDropIndex]?.key === col.key &&
          draggedColumnKey !== null &&
          draggedColumnKey !== col.key;

        return (
          <BoardColumnView
            key={col.key}
            col={col}
            items={items}
            collapsed={collapsed}
            isDragTarget={isDragTarget}
            isDragging={isDragging}
            isColumnDropTarget={isColumnDropTarget}
            selectedId={selectedId}
            logs={logs}
            tokenHistory={tokenHistory}
            loadingAction={loadingAction}
            onColumnDragOver={handleDragOver}
            onColumnDragLeave={handleDragLeave}
            onColumnDrop={handleDrop}
            onColumnDragStart={handleColumnDragStart}
            onColumnDragEnd={handleColumnDragEnd}
            onToggleCollapsed={onToggleCollapsed}
            onDeleteColumn={onDeleteColumn}
            onSelect={onSelect}
            onStart={onStart}
            onStop={onStop}
            onResume={onResume}
            onDelete={onDelete}
            onDismiss={onDismiss}
            onCardDragStart={handleCardDragStart}
          />
        );
      })}

      {addingColumn ? (
        <div
          style={{
            width: 240,
            flexShrink: 0,
            border: '1px dashed oklch(0.72 0.16 55)',
            borderRadius: 10,
            background: 'var(--k-surface-1)',
            display: 'flex',
            flexDirection: 'column',
            padding: 10,
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--k-fg-dim)',
              fontFamily: 'var(--font-jetbrains-mono), monospace',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            New column
          </div>
          <input
            autoFocus
            type="text"
            value={newColumnLabel}
            onChange={(e) => setNewColumnLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNewColumn();
              else if (e.key === 'Escape') cancelNewColumn();
            }}
            placeholder="Column name"
            style={{
              width: '100%',
              padding: '7px 9px',
              fontSize: 12,
              borderRadius: 6,
              background: 'var(--k-bg)',
              border: '1px solid var(--k-border)',
              color: 'var(--k-fg)',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={submitNewColumn}
              disabled={!newColumnLabel.trim()}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'oklch(0.72 0.16 55)',
                color: '#0b0c0d',
                border: 0,
                fontSize: 11,
                fontWeight: 600,
                cursor: newColumnLabel.trim() ? 'pointer' : 'default',
                opacity: newColumnLabel.trim() ? 1 : 0.5,
                fontFamily: 'inherit',
              }}
            >
              Add
            </button>
            <button
              onClick={cancelNewColumn}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: 'transparent',
                border: '1px solid var(--k-border)',
                color: 'var(--k-fg-muted)',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingColumn(true)}
          title="Add column"
          style={{
            width: 160,
            flexShrink: 0,
            border: '1px dashed var(--k-border)',
            borderRadius: 10,
            background: 'transparent',
            color: 'var(--k-fg-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 12,
            fontFamily: 'inherit',
            alignSelf: 'stretch',
          }}
        >
          <Icon name="plus" size={13} />
          Add column
        </button>
      )}
    </div>
  );
}
