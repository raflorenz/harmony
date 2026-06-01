// ---------------------------------------------------------------------------
// Kanban card
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Icon } from './Icon';
import { Sparkline } from './Sparkline';
import { miniBtnStyle } from './styles';
import {
  formatDuration,
  formatTokens,
  priorityColor,
  priorityLabel,
  relativeTime,
  shortStatus,
  sourceTag,
  statusColor,
} from './format';
import type { UnifiedIssue } from './types';

export function KCard({
  issue,
  selected,
  onClick,
  onStart,
  onStop,
  onResume,
  onDelete,
  onDismiss,
  miniLog,
  spark,
  loadingAction,
  draggable,
  onDragStart,
}: {
  issue: UnifiedIssue;
  selected: boolean;
  onClick: () => void;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
  onDelete: () => void;
  onDismiss: () => void;
  miniLog?: string[];
  spark?: number[];
  loadingAction: string | null;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const [hover, setHover] = useState(false);
  const isRunning = issue.state === 'running';
  const isRetrying = issue.state === 'retrying';
  const isCanceled = issue.state === 'canceled';
  const isDone = issue.state === 'done';
  const isTodo = issue.state === 'todo';
  const accent = statusColor(issue.status);

  const leftBorder = isRunning
    ? accent
    : isRetrying
    ? accent
    : isCanceled
    ? '#ee9b60'
    : isDone
    ? '#7dd3a1'
    : priorityColor(issue.priority);

  const src = sourceTag(issue.id);

  const dueInSec =
    isRetrying && issue.dueAtMs ? Math.max(0, Math.round((issue.dueAtMs - Date.now()) / 1000)) : null;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      style={{
        background: selected ? 'var(--k-surface-2)' : 'var(--k-surface-1)',
        borderTop: '1px solid ' + (selected ? 'var(--k-border-strong)' : 'var(--k-border)'),
        borderRight: '1px solid ' + (selected ? 'var(--k-border-strong)' : 'var(--k-border)'),
        borderBottom: '1px solid ' + (selected ? 'var(--k-border-strong)' : 'var(--k-border)'),
        borderLeft: '2px solid ' + leftBorder,
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: draggable ? 'grab' : 'pointer',
        transition: 'background .12s, border-color .12s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span
          style={{
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--k-fg)',
            flexShrink: 0,
          }}
        >
          {issue.identifier}
        </span>
        <span
          style={{
            fontSize: 9,
            padding: '1px 6px',
            borderRadius: 4,
            background: src.color + '22',
            color: src.color,
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            border: '1px solid ' + src.color + '33',
          }}
        >
          {src.label}
        </span>
        <span style={{ flex: 1, minWidth: 4 }} />
        {isRunning && (
          <span
            className="pulse-dot"
            style={{ width: 6, height: 6, borderRadius: '50%', background: accent, flexShrink: 0 }}
          />
        )}
        <span
          title={isRunning ? issue.status : ''}
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            color: accent,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '55%',
            flexShrink: 1,
          }}
        >
          {isRunning
            ? shortStatus(issue.status)
            : isRetrying
            ? 'retry #' + issue.attempt
            : isCanceled
            ? 'canceled'
            : isDone
            ? 'done'
            : priorityLabel(issue.priority)}
        </span>
      </div>

      <div
        style={{
          fontSize: 12,
          color: 'var(--k-fg)',
          lineHeight: 1.35,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {issue.title}
      </div>

      {isRunning && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 10,
              fontFamily: 'var(--font-jetbrains-mono), monospace',
              color: 'var(--k-fg-muted)',
            }}
          >
            <span>{formatDuration(issue.seconds)}</span>
            <span>·</span>
            <span>{formatTokens(issue.tokens)} tok</span>
            <span>·</span>
            <span>#{issue.attempt}</span>
            <span style={{ flex: 1 }} />
            <Sparkline data={spark ?? []} width={60} height={16} color={accent} />
          </div>
          {miniLog && miniLog.length > 0 && (
            <div
              style={{
                fontFamily: 'var(--font-jetbrains-mono), monospace',
                fontSize: 10,
                color: 'var(--k-fg-muted)',
                background: 'var(--k-log-bg)',
                padding: '6px 8px',
                borderRadius: 6,
                height: 28,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                borderLeft: '2px solid ' + accent + '55',
              }}
            >
              {miniLog[miniLog.length - 1]}
            </div>
          )}
          {hover && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStop();
                }}
                disabled={loadingAction === `stop-${issue.id}`}
                style={miniBtnStyle('#ee6060')}
              >
                <Icon name="stop" size={10} /> {loadingAction === `stop-${issue.id}` ? '…' : 'stop'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                disabled={loadingAction === `delete-${issue.id}`}
                style={miniBtnStyle('#7e8a95')}
              >
                <Icon name="trash" size={10} /> {loadingAction === `delete-${issue.id}` ? '…' : 'delete'}
              </button>
            </div>
          )}
        </>
      )}

      {isRetrying && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 10,
              fontFamily: 'var(--font-jetbrains-mono), monospace',
              color: 'var(--k-fg-muted)',
            }}
          >
            <Icon name="clock" size={11} />
            <span>
              {dueInSec !== null ? `retry in ${dueInSec}s` : 'queued'} · #{issue.attempt}
            </span>
            <span style={{ flex: 1 }} />
          </div>
          {issue.error && (
            <div
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-jetbrains-mono), monospace',
                color: '#ee6060',
                background: 'rgba(238,96,96,0.06)',
                padding: '4px 6px',
                borderRadius: 4,
                lineHeight: 1.35,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {issue.error}
            </div>
          )}
          {hover && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                disabled={loadingAction === `delete-${issue.id}`}
                style={miniBtnStyle('#7e8a95')}
              >
                <Icon name="trash" size={10} /> {loadingAction === `delete-${issue.id}` ? '…' : 'delete'}
              </button>
            </div>
          )}
        </>
      )}

      {isCanceled && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 10,
              fontFamily: 'var(--font-jetbrains-mono), monospace',
              color: 'var(--k-fg-muted)',
            }}
          >
            <span>{formatTokens(issue.tokens)} tok</span>
            <span>·</span>
            <span>#{issue.attempt}</span>
            <span style={{ flex: 1 }} />
            <span>
              canceled {issue.finishedAt ? relativeTime(issue.finishedAt) : ''}
            </span>
          </div>
          {issue.lastMsg && (
            <div
              style={{
                fontFamily: 'var(--font-jetbrains-mono), monospace',
                fontSize: 10,
                color: 'var(--k-fg-muted)',
                background: 'var(--k-log-bg)',
                padding: '6px 8px',
                borderRadius: 6,
                height: 28,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                borderLeft: '2px solid #ee9b6055',
              }}
              title={issue.lastMsg}
            >
              {'> ' + issue.lastMsg}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResume();
              }}
              disabled={loadingAction === `resume-${issue.id}`}
              style={miniBtnStyle('#6bd69c')}
            >
              <Icon name="play" size={10} />{' '}
              {loadingAction === `resume-${issue.id}` ? '…' : 'resume'}
            </button>
            {hover && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                disabled={loadingAction === `delete-${issue.id}`}
                style={miniBtnStyle('#7e8a95')}
              >
                <Icon name="trash" size={10} />{' '}
                {loadingAction === `delete-${issue.id}` ? '…' : 'delete'}
              </button>
            )}
          </div>
        </>
      )}

      {isTodo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4, flex: 1, flexWrap: 'wrap' }}>
            {issue.labels.slice(0, 2).map((l) => (
              <span
                key={l}
                style={{
                  fontSize: 9,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'var(--k-surface-2)',
                  color: 'var(--k-fg-muted)',
                  fontFamily: 'var(--font-jetbrains-mono), monospace',
                }}
              >
                {l}
              </span>
            ))}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
            disabled={loadingAction === `start-${issue.id}`}
            style={miniBtnStyle('#6bd69c')}
          >
            <Icon name="play" size={10} /> {loadingAction === `start-${issue.id}` ? '…' : 'start'}
          </button>
        </div>
      )}

      {isDone && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10,
            fontFamily: 'var(--font-jetbrains-mono), monospace',
            color: 'var(--k-fg-muted)',
          }}
        >
          <span>Completed {issue.finishedAt ? relativeTime(issue.finishedAt) : ''}</span>
          <span style={{ flex: 1 }} />
          {hover && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              style={miniBtnStyle('#7e8a95')}
            >
              <Icon name="x" size={10} /> dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
