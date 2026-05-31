// ---------------------------------------------------------------------------
// Top header bar: run counts, sync, and add-issue toggle
// ---------------------------------------------------------------------------

import { Icon } from './Icon';

export function DashboardHeader({
  runningCount,
  retryingCount,
  canceledCount,
  queuedCount,
  rightRailOpen,
  syncLoading,
  newIssueCount,
  onSync,
  showAddForm,
  onToggleAddForm,
}: {
  runningCount: number;
  retryingCount: number;
  canceledCount: number;
  queuedCount: number;
  rightRailOpen: boolean;
  syncLoading: boolean;
  newIssueCount: number;
  onSync: () => void;
  showAddForm: boolean;
  onToggleAddForm: () => void;
}) {
  return (
    <header
      style={{
        gridColumn: rightRailOpen ? '2 / span 2' : '2',
        gridRow: '1',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 24px',
        borderBottom: '1px solid var(--k-border)',
        background: 'var(--k-bg)',
      }}
    >
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>Dashboard</div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--k-fg-muted)',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            marginTop: 2,
          }}
        >
          {runningCount} running · {retryingCount} retrying · {canceledCount} canceled · {queuedCount} queued
        </div>
      </div>
      <div style={{ flex: 1 }} />

      <button
        onClick={onSync}
        disabled={syncLoading}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 12px',
          borderRadius: 8,
          background: 'var(--k-surface-1)',
          color: 'var(--k-fg)',
          border: '1px solid var(--k-border)',
          fontSize: 12,
          cursor: syncLoading ? 'default' : 'pointer',
          opacity: syncLoading ? 0.6 : 1,
          fontFamily: 'inherit',
        }}
      >
        <Icon
          name="refresh"
          size={13}
          style={syncLoading ? { animation: 'pulse-dot 0.8s linear infinite' } : undefined}
        />
        {syncLoading ? 'Syncing…' : 'Sync issues'}
        {newIssueCount > 0 && !syncLoading && (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 18,
              height: 18,
              padding: '0 4px',
              borderRadius: 9,
              background: '#ee6060',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {newIssueCount}
          </span>
        )}
      </button>

      <button
        onClick={onToggleAddForm}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 12px',
          borderRadius: 8,
          background: 'oklch(0.72 0.16 55)',
          color: '#0b0c0d',
          border: 0,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <Icon name="plus" size={13} />
        {showAddForm ? 'Cancel' : 'Add issue'}
      </button>
    </header>
  );
}
