'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTheme } from '../theme-provider';
import { NavSidebar } from './NavSidebar';
import { SettingsDrawer } from './SettingsDrawer';
import { DashboardHeader } from './DashboardHeader';
import { AddIssueForm } from './AddIssueForm';
import { KanbanBoard } from './KanbanBoard';
import { KRunDetail } from './KRunDetail';
import { useDashboardData } from './useDashboardData';
import { useBoardColumns } from './useBoardColumns';
import type { AddIssueFormState, LaneState, UnifiedIssue } from './types';

const EMPTY_FORM: AddIssueFormState = { title: '', description: '', priority: '', labels: '' };

export function Dashboard() {
  const { theme, toggleTheme } = useTheme();

  const {
    data,
    error,
    available,
    doneItems,
    tokenHistory,
    logs,
    loadingAction,
    syncLoading,
    newIssueCount,
    unifiedIssues,
    start,
    stop,
    resume,
    remove,
    sync,
    addIssue,
    dismissDone,
  } = useDashboardData();

  const { boardColumns, collapsedColumns, addColumn, deleteColumn, reorderColumn, toggleCollapsed } =
    useBoardColumns();

  // UI-only state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddIssueFormState>(EMPTY_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addingColumn, setAddingColumn] = useState(false);

  // Close sidebar on Esc
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const byState: Record<LaneState, UnifiedIssue[]> = useMemo(
    () => ({
      todo: unifiedIssues.filter((i) => i.state === 'todo'),
      running: unifiedIssues.filter((i) => i.state === 'running'),
      retrying: unifiedIssues.filter((i) => i.state === 'retrying'),
      canceled: unifiedIssues.filter((i) => i.state === 'canceled'),
      done: unifiedIssues.filter((i) => i.state === 'done'),
    }),
    [unifiedIssues],
  );

  // Effective selection: honor the user's explicit pick while it still exists,
  // otherwise fall back to a sensible default — derived during render so there's
  // no cascading setState in an effect.
  const selectedStillExists = selectedId !== null && unifiedIssues.some((i) => i.id === selectedId);
  const fallbackId =
    data?.running[0]?.issue_id ??
    data?.retrying[0]?.issue_id ??
    data?.canceled?.[0]?.issue_id ??
    available[0]?.id ??
    doneItems[0]?.issue_id ??
    null;
  const effectiveSelectedId = selectedStillExists ? selectedId : fallbackId;
  const selected = unifiedIssues.find((i) => i.id === effectiveSelectedId) ?? null;

  const runningCount = data?.counts.running ?? 0;
  const retryingCount = data?.counts.retrying ?? 0;
  const canceledCount = data?.counts.canceled ?? data?.canceled?.length ?? 0;
  const rightRailOpen = runningCount > 0 || retryingCount > 0 || canceledCount > 0;

  const handleAddIssue = async () => {
    const err = await addIssue(addForm);
    if (err) {
      setAddError(err);
      return;
    }
    setAddForm(EMPTY_FORM);
    setShowAddForm(false);
    setAddError(null);
  };

  const handleSync = async () => {
    await sync();
  };

  const rootStyle: CSSProperties = {
    height: '100vh',
    background: 'var(--k-bg)',
    color: 'var(--k-fg)',
    display: 'grid',
    gridTemplateColumns: rightRailOpen ? '56px 1fr 360px' : '56px 1fr',
    gridTemplateRows: '56px 1fr',
    fontFamily: 'var(--font-inter), system-ui, sans-serif',
    overflow: 'hidden',
  };

  return (
    <div style={rootStyle}>
      <NavSidebar
        theme={theme}
        onToggleTheme={toggleTheme}
        onNewIssue={() => setShowAddForm((s) => !s)}
        addingColumn={addingColumn}
        onToggleAddColumn={() => setAddingColumn((s) => !s)}
        onOpenSettings={() => setSidebarOpen(true)}
      />

      <SettingsDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <DashboardHeader
        runningCount={runningCount}
        retryingCount={retryingCount}
        canceledCount={canceledCount}
        queuedCount={byState.todo.length}
        rightRailOpen={rightRailOpen}
        syncLoading={syncLoading}
        newIssueCount={newIssueCount}
        onSync={handleSync}
        showAddForm={showAddForm}
        onToggleAddForm={() => setShowAddForm((s) => !s)}
      />

      {/* Main content */}
      <main
        style={{
          gridColumn: '2',
          gridRow: '2',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {(error || showAddForm) && (
          <div style={{ padding: '12px 20px 0' }}>
            {error && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(238,96,96,0.08)',
                  border: '1px solid rgba(238,96,96,0.25)',
                  color: '#ee6060',
                  fontSize: 12,
                  fontFamily: 'var(--font-jetbrains-mono), monospace',
                }}
              >
                {error}
              </div>
            )}
            {showAddForm && (
              <AddIssueForm
                form={addForm}
                setForm={setAddForm}
                onSubmit={handleAddIssue}
                loading={loadingAction === 'add-issue'}
                error={addError}
                onClose={() => {
                  setShowAddForm(false);
                  setAddError(null);
                }}
              />
            )}
          </div>
        )}

        <KanbanBoard
          boardColumns={boardColumns}
          byState={byState}
          collapsedColumns={collapsedColumns}
          selectedId={effectiveSelectedId}
          logs={logs}
          tokenHistory={tokenHistory}
          loadingAction={loadingAction}
          addingColumn={addingColumn}
          setAddingColumn={setAddingColumn}
          onSelect={setSelectedId}
          onStart={start}
          onStop={stop}
          onResume={resume}
          onDelete={remove}
          onDismiss={dismissDone}
          onAddColumn={addColumn}
          onDeleteColumn={deleteColumn}
          onReorderColumn={reorderColumn}
          onToggleCollapsed={toggleCollapsed}
        />
      </main>

      {/* Right rail — focused run detail (only when a task is running/retrying) */}
      {rightRailOpen && (
        <section
          style={{
            gridColumn: '3',
            gridRow: '2',
            borderLeft: '1px solid var(--k-border)',
            padding: '16px 18px',
            overflowY: 'auto',
            background: 'var(--k-bg-panel)',
            minHeight: 0,
          }}
          className="scroll-kanban"
        >
          {selected ? (
            <KRunDetail
              issue={selected}
              logs={logs[selected.id] ?? []}
              history={tokenHistory[selected.id] ?? []}
              onStop={() => stop(selected.id)}
              onStart={() => start(selected.id)}
              onResume={() => resume(selected.id)}
              onDelete={() => remove(selected.id, selected.identifier)}
              onDismiss={() => dismissDone(selected.id)}
              loadingAction={loadingAction}
            />
          ) : (
            <div style={{ color: 'var(--k-fg-dim)', fontSize: 12 }}>Select a card to see details</div>
          )}
        </section>
      )}
    </div>
  );
}
