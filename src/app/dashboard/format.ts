// ---------------------------------------------------------------------------
// Formatting + color helpers
// ---------------------------------------------------------------------------

import type { KanbanColumn, LaneState } from './types';

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 5) return 'just now';
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function priorityLabel(p: number | null): string {
  if (p === null || p === 0) return '—';
  return ['—', 'Urgent', 'High', 'Medium', 'Low'][p] || '—';
}

export function priorityColor(p: number | null): string {
  if (p === null) return '#7e8a95';
  return ['#7e8a95', '#e5484d', '#f5a524', '#e5c049', '#7e8a95'][p] || '#7e8a95';
}

export function statusColor(s: string): string {
  switch (s) {
    case 'StreamingTurn':
    case 'Succeeded':
      return '#6bd69c';
    case 'InitializingSession':
    case 'LaunchingAgentProcess':
    case 'PreparingWorkspace':
    case 'BuildingPrompt':
      return '#f5c050';
    case 'Failed':
    case 'TimedOut':
    case 'Stalled':
    case 'CanceledByReconciliation':
      return '#ee6060';
    case 'Canceled':
      return '#ee9b60';
    default:
      return '#888';
  }
}

export function shortStatus(s: string): string {
  const map: Record<string, string> = {
    StreamingTurn: 'streaming',
    InitializingSession: 'init',
    LaunchingAgentProcess: 'launching',
    PreparingWorkspace: 'prep ws',
    BuildingPrompt: 'prompt',
    Failed: 'failed',
    TimedOut: 'timeout',
    Stalled: 'stalled',
    Succeeded: 'ok',
    CanceledByReconciliation: 'canceled',
  };
  return map[s] ?? s;
}

export function sourceTag(id: string): { label: string; color: string } {
  if (id.startsWith('manual-')) return { label: 'Manual', color: '#c89bff' };
  if (id.startsWith('issue-')) return { label: 'Mock', color: '#f5c050' };
  if (/^\d+$/.test(id)) return { label: 'GitHub', color: '#9bb7ff' };
  return { label: 'Tracker', color: '#7e8a95' };
}

export function columnFromLaneState(s: LaneState): KanbanColumn {
  switch (s) {
    case 'todo':
      return 'todo';
    case 'running':
      return 'in-progress';
    case 'retrying':
      return 'review';
    case 'canceled':
      return 'canceled';
    case 'done':
      return 'done';
  }
}
