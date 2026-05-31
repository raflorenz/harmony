// ---------------------------------------------------------------------------
// Right-rail run detail
// ---------------------------------------------------------------------------

import { Icon } from './Icon';
import { Sparkline } from './Sparkline';
import { LogTail } from './LogTail';
import { primaryBtn, sectionLabelStyle } from './styles';
import { formatDuration, formatTokens, priorityColor, priorityLabel, statusColor } from './format';
import type { UnifiedIssue } from './types';

export function KRunDetail({
  issue,
  logs,
  history,
  onStop,
  onStart,
  onResume,
  onDelete,
  onDismiss,
  loadingAction,
}: {
  issue: UnifiedIssue;
  logs: string[];
  history: number[];
  onStop: () => void;
  onStart: () => void;
  onResume: () => void;
  onDelete: () => void;
  onDismiss: () => void;
  loadingAction: string | null;
}) {
  const isRunning = issue.state === 'running';
  const isRetrying = issue.state === 'retrying';
  const isCanceled = issue.state === 'canceled';
  const isTodo = issue.state === 'todo';
  const isDone = issue.state === 'done';
  const accent = statusColor(issue.status);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: 'var(--font-jetbrains-mono), monospace',
              fontSize: 11,
              color: 'var(--k-fg-muted)',
            }}
          >
            {issue.identifier}
          </span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 99,
              fontSize: 10,
              fontFamily: 'var(--font-jetbrains-mono), monospace',
              background: accent + '22',
              color: accent,
              border: '1px solid ' + accent + '44',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {isRunning && (
              <span
                className="pulse-dot"
                style={{ width: 5, height: 5, borderRadius: '50%', background: accent }}
              />
            )}
            {issue.status}
          </span>
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--k-fg)',
            letterSpacing: '-0.01em',
            lineHeight: 1.3,
          }}
        >
          {issue.title}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <KStat label="Attempt" value={issue.attempt > 0 ? '#' + issue.attempt : '—'} />
        <KStat
          label="Runtime"
          value={issue.seconds > 0 ? formatDuration(issue.seconds) : '—'}
        />
        <KStat
          label="Tokens"
          value={issue.tokens > 0 ? formatTokens(issue.tokens) : '—'}
        />
        <KStat
          label="Priority"
          value={priorityLabel(issue.priority)}
          accent={priorityColor(issue.priority)}
        />
      </div>

      {isRunning && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <span style={sectionLabelStyle}>Token rate</span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--k-fg-dim)',
                fontFamily: 'var(--font-jetbrains-mono), monospace',
              }}
            >
              {history.length}s
            </span>
          </div>
          <div
            style={{
              border: '1px solid var(--k-border)',
              borderRadius: 8,
              padding: '10px 12px',
              background: 'var(--k-surface-1)',
            }}
          >
            <Sparkline data={history} width={312} height={44} color={accent} />
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="terminal" size={12} style={{ color: 'var(--k-fg-muted)' }} />
          <span style={sectionLabelStyle}>Live output</span>
          {isRunning && (
            <span
              className="pulse-dot"
              style={{ width: 5, height: 5, borderRadius: '50%', background: '#6bd69c', marginLeft: 2 }}
            />
          )}
        </div>
        <div style={{ flex: 1, minHeight: 160 }}>
          <LogTail
            lines={logs.length ? logs : ['(no output yet)']}
            height="100%"
          />
        </div>
      </div>

      {issue.error && (
        <div
          style={{
            fontSize: 11,
            color: '#ee6060',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            background: 'rgba(238,96,96,0.08)',
            border: '1px solid rgba(238,96,96,0.2)',
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          <div
            style={{
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              opacity: 0.7,
              marginBottom: 3,
            }}
          >
            error
          </div>
          {issue.error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {isRunning && (
          <button
            onClick={onStop}
            disabled={loadingAction === `stop-${issue.id}`}
            style={primaryBtn('#ee6060')}
          >
            <Icon name="stop" size={12} /> Stop run
          </button>
        )}
        {isRetrying && (
          <button
            onClick={onDelete}
            disabled={loadingAction === `delete-${issue.id}`}
            style={primaryBtn('#7e8a95')}
          >
            <Icon name="trash" size={12} /> Delete
          </button>
        )}
        {isCanceled && (
          <button
            onClick={onResume}
            disabled={loadingAction === `resume-${issue.id}`}
            style={primaryBtn('#6bd69c')}
          >
            <Icon name="play" size={12} />{' '}
            {loadingAction === `resume-${issue.id}` ? 'Resuming…' : 'Resume run'}
          </button>
        )}
        {isTodo && (
          <button
            onClick={onStart}
            disabled={loadingAction === `start-${issue.id}`}
            style={primaryBtn('#6bd69c')}
          >
            <Icon name="play" size={12} /> Start run
          </button>
        )}
        {isDone && (
          <button onClick={onDismiss} style={primaryBtn('#7e8a95')}>
            <Icon name="x" size={12} /> Dismiss
          </button>
        )}
        {(isRunning || isRetrying || isCanceled) && (
          <button
            onClick={onDelete}
            disabled={loadingAction === `delete-${issue.id}`}
            style={{
              padding: '9px 12px',
              borderRadius: 8,
              background: 'var(--k-surface-1)',
              border: '1px solid var(--k-border)',
              color: 'var(--k-fg-muted)',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            title="Stop and clean workspace"
          >
            <Icon name="trash" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function KStat({ label, value, accent = 'var(--k-fg)' }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--k-border)',
        borderRadius: 8,
        padding: '8px 10px',
        background: 'var(--k-surface-1)',
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: 'var(--k-fg-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          fontWeight: 500,
          color: accent,
        }}
      >
        {value}
      </div>
    </div>
  );
}
