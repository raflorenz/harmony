// ---------------------------------------------------------------------------
// Board column layout: persisted ordering, add/delete/reorder/collapse
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';
import {
  BOARD_COLUMNS_STORAGE_KEY,
  COLUMN_ACCENT_PALETTE,
  DEFAULT_BOARD_COLUMNS,
  type BoardColumn,
  type KanbanColumn,
} from './types';

export function useBoardColumns() {
  const [boardColumns, setBoardColumns] = useState<BoardColumn[]>(DEFAULT_BOARD_COLUMNS);
  const [boardColumnsHydrated, setBoardColumnsHydrated] = useState(false);
  const [collapsedColumns, setCollapsedColumns] = useState<Set<KanbanColumn>>(() => new Set());

  // Load persisted column layout on mount. localStorage isn't available during
  // SSR, so hydrating via an effect (rather than a useState initializer) is the
  // intended pattern here despite the set-state-in-effect lint rule.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BOARD_COLUMNS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as BoardColumn[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Ensure all builtin columns are still present (by key); append any missing.
          const seen = new Set(parsed.map((c) => c.key));
          const merged = [...parsed];
          for (const b of DEFAULT_BOARD_COLUMNS) {
            if (!seen.has(b.key)) merged.push(b);
          }
          setBoardColumns(merged);
        }
      }
    } catch {
      /* ignore malformed storage */
    }
    setBoardColumnsHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist column layout after hydration
  useEffect(() => {
    if (!boardColumnsHydrated) return;
    try {
      localStorage.setItem(BOARD_COLUMNS_STORAGE_KEY, JSON.stringify(boardColumns));
    } catch {
      /* quota / privacy mode */
    }
  }, [boardColumns, boardColumnsHydrated]);

  const addColumn = useCallback((label: string) => {
    setBoardColumns((prev) => {
      const customCount = prev.filter((c) => !c.builtin).length;
      const accent = COLUMN_ACCENT_PALETTE[customCount % COLUMN_ACCENT_PALETTE.length];
      const baseKey = 'col-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      let key = baseKey || 'col-' + Date.now().toString(36);
      const taken = new Set(prev.map((c) => c.key));
      let i = 2;
      while (taken.has(key)) key = baseKey + '-' + i++;
      return [...prev, { key, label, accent }];
    });
  }, []);

  const deleteColumn = useCallback((key: KanbanColumn) => {
    setBoardColumns((prev) => prev.filter((c) => c.key !== key));
    setCollapsedColumns((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const reorderColumn = useCallback((fromKey: KanbanColumn, toKey: KanbanColumn) => {
    if (fromKey === toKey) return;
    setBoardColumns((prev) => {
      const fromIdx = prev.findIndex((c) => c.key === fromKey);
      const toIdx = prev.findIndex((c) => c.key === toKey);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  const toggleCollapsed = useCallback((key: KanbanColumn) => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return {
    boardColumns,
    collapsedColumns,
    addColumn,
    deleteColumn,
    reorderColumn,
    toggleCollapsed,
  };
}
