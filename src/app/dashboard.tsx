'use client';

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useTheme } from './theme-provider';

// ---------------------------------------------------------------------------
// Types (API contracts — preserved verbatim from prior dashboard)
// ---------------------------------------------------------------------------

interface RunningRow {
  issue_id: string;
  issue_identifier: string;
  attempt: number;
  status: string;
  started_at: string;
  seconds_running: number;
  tokens: { input_tokens: number; output_tokens: number; total_tokens: number };
  last_message: string | null;
  recent_messages?: string[];
}

interface RetryRow {
  issue_id: string;
  issue_identifier: string;
  attempt: number;
  due_at: string;
  error: string | null;
}

interface StateResponse {
  mock_mode?: boolean;
  auto_dispatch?: boolean;
  generated_at: string;
  counts: { running: number; retrying: number };
  running: RunningRow[];
  retrying: RetryRow[];
  codex_totals: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    seconds_running: number;
  };
  rate_limits: Record<string, unknown> | null;
  error?: { code: string; message: string };
}

interface AvailableIssue {
  id: string;
  identifier: string;
  title: string;
  state: string;
  priority: number | null;
  labels: string[];
  url: string | null;
  created_at: string | null;
}

interface DoneItem {
  issue_id: string;
  issue_identifier: string;
  title?: string;
  finished_at: string;
}

type LaneState = 'todo' | 'running' | 'retrying' | 'done';

interface UnifiedIssue {
  id: string;
  identifier: string;
  title: string;
  state: LaneState;
  priority: number | null;
  labels: string[];
  attempt: number;
  seconds: number;
  tokens: number;
  status: string;
  lastMsg: string | null;
  dueAtMs: number | null;
  error: string | null;
  finishedAt: string | null;
}

type KanbanColumn = 'todo' | 'in-progress' | 'review' | 'done';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
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

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 5) return 'just now';
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function priorityLabel(p: number | null): string {
  if (p === null || p === 0) return '—';
  return ['—', 'Urgent', 'High', 'Medium', 'Low'][p] || '—';
}

function priorityColor(p: number | null): string {
  if (p === null) return '#7e8a95';
  return ['#7e8a95', '#e5484d', '#f5a524', '#e5c049', '#7e8a95'][p] || '#7e8a95';
}

function statusColor(s: string): string {
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
    default:
      return '#888';
  }
}

function shortStatus(s: string): string {
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

function sourceTag(id: string): { label: string; color: string } {
  if (id.startsWith('manual-')) return { label: 'Manual', color: '#c89bff' };
  if (id.startsWith('issue-')) return { label: 'Mock', color: '#f5c050' };
  if (/^\d+$/.test(id)) return { label: 'GitHub', color: '#9bb7ff' };
  return { label: 'Tracker', color: '#7e8a95' };
}

// ---------------------------------------------------------------------------
// Inline SVG icon set (lucide-style, matches handoff design)
// ---------------------------------------------------------------------------

type IconName =
  | 'play'
  | 'stop'
  | 'refresh'
  | 'plus'
  | 'x'
  | 'retry'
  | 'clock'
  | 'search'
  | 'terminal'
  | 'eye'
  | 'trash'
  | 'sun'
  | 'moon'
  | 'chevronL'
  | 'chevronR';

function Icon({
  name,
  size = 14,
  stroke = 1.8,
  style,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
}) {
  const paths: Record<IconName, ReactNode> = {
    play: <polygon points="6 3 20 12 6 21 6 3" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
    refresh: (
      <>
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </>
    ),
    plus: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    ),
    x: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    ),
    retry: (
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <polyline points="21 3 21 8 16 8" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
    terminal: (
      <>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </>
    ),
    eye: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    trash: (
      <>
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </>
    ),
    moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
    chevronL: <polyline points="15 18 9 12 15 6" />,
    chevronR: <polyline points="9 18 15 12 9 6" />,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

function Sparkline({
  data,
  color = '#7dd3a1',
  height = 22,
  width = 100,
  fill = true,
}: {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  fill?: boolean;
}) {
  if (!data || data.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const range = Math.max(1, max - min);
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - ((v - min) / range) * (height - 2) - 1] as const);
  const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = d + ` L${width} ${height} L0 ${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {fill && <path d={area} fill={color} opacity="0.15" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Streaming log tail
// ---------------------------------------------------------------------------

function LogTail({
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

// ---------------------------------------------------------------------------
// Dashboard component
// ---------------------------------------------------------------------------

const SPARK_LEN = 40;

export function Dashboard() {
  const { theme, toggleTheme } = useTheme();

  // Core API state (preserved)
  const [data, setData] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<AvailableIssue[]>([]);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ title: '', description: '', priority: '', labels: '' });
  const [addError, setAddError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [doneItems, setDoneItems] = useState<DoneItem[]>([]);
  const [dragOverColumn, setDragOverColumn] = useState<KanbanColumn | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [newIssueCount, setNewIssueCount] = useState(0);

  // Kanban+ state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tokenHistory, setTokenHistory] = useState<Record<string, number[]>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});

  // Title cache — persists titles seen via /available-issues so running/retrying cards
  // can display them (the state API doesn't return title).
  const titleCacheRef = useRef<Map<string, string>>(new Map());

  // Track prior running/retrying IDs for completion detection
  const prevRunningIds = useRef<Set<string>>(new Set());
  const prevRetryingIds = useRef<Set<string>>(new Set());
  const latestAvailableRef = useRef<AvailableIssue[]>([]);
  const displayedIdsRef = useRef<Set<string>>(new Set());

  // ---- Data fetching ----

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/state');
      const json: StateResponse = await res.json();
      if (json.error) {
        setError(json.error.message);
        setData(null);
      } else {
        setData(json);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch state');
      setData(null);
    }
  }, []);

  const fetchAvailable = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/available-issues');
      const json = await res.json();
      const issues: AvailableIssue[] = json.issues ?? [];
      setAvailable(issues);
      for (const i of issues) {
        titleCacheRef.current.set(i.id, i.title);
      }
    } catch {
      /* silent */
    }
  }, []);

  const checkForNewIssues = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/available-issues');
      const json = await res.json();
      const latest: AvailableIssue[] = json.issues ?? [];
      latestAvailableRef.current = latest;
      for (const i of latest) titleCacheRef.current.set(i.id, i.title);
      const newCount = latest.filter((i) => !displayedIdsRef.current.has(i.id)).length;
      setNewIssueCount(newCount);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    displayedIdsRef.current = new Set(available.map((a) => a.id));
  }, [available]);

  // Initial fetch + 3s polling (preserved)
  useEffect(() => {
    fetchState();
    fetchAvailable();
    checkForNewIssues();
    const interval = setInterval(() => {
      fetchState();
      checkForNewIssues();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchState, fetchAvailable, checkForNewIssues]);

  // ---- Done detection (preserved) ----
  useEffect(() => {
    if (!data) return;
    const currentRunningIds = new Set(data.running.map((r) => r.issue_id));
    const currentRetryingIds = new Set(data.retrying.map((r) => r.issue_id));
    const currentAvailableIds = new Set(available.map((a) => a.id));

    const newDone: DoneItem[] = [];
    for (const id of prevRunningIds.current) {
      if (!currentRunningIds.has(id) && !currentRetryingIds.has(id) && !currentAvailableIds.has(id)) {
        const prev = data.running.find((r) => r.issue_id === id);
        newDone.push({
          issue_id: id,
          issue_identifier: prev?.issue_identifier ?? id,
          title: titleCacheRef.current.get(id),
          finished_at: new Date().toISOString(),
        });
      }
    }
    for (const id of prevRetryingIds.current) {
      if (!currentRunningIds.has(id) && !currentRetryingIds.has(id) && !currentAvailableIds.has(id)) {
        if (!newDone.some((d) => d.issue_id === id)) {
          const prev = data.retrying.find((r) => r.issue_id === id);
          newDone.push({
            issue_id: id,
            issue_identifier: prev?.issue_identifier ?? id,
            title: titleCacheRef.current.get(id),
            finished_at: new Date().toISOString(),
          });
        }
      }
    }

    if (newDone.length > 0) {
      setDoneItems((prev) => {
        const existingIds = new Set(prev.map((d) => d.issue_id));
        const unique = newDone.filter((d) => !existingIds.has(d.issue_id));
        return [...unique, ...prev];
      });
    }

    prevRunningIds.current = currentRunningIds;
    prevRetryingIds.current = currentRetryingIds;
  }, [data, available]);

  // ---- Token history (sparklines) ----
  useEffect(() => {
    if (!data) return;
    setTokenHistory((prev) => {
      const next = { ...prev };
      for (const r of data.running) {
        const series = next[r.issue_id] ? [...next[r.issue_id]] : new Array(SPARK_LEN).fill(0);
        series.push(r.tokens.total_tokens);
        if (series.length > SPARK_LEN) series.splice(0, series.length - SPARK_LEN);
        next[r.issue_id] = series;
      }
      return next;
    });
  }, [data]);

  // ---- Log mirror: server maintains the ring buffer, we just show it ----
  useEffect(() => {
    if (!data) return;
    setLogs((prev) => {
      const next = { ...prev };
      for (const r of data.running) {
        const messages = r.recent_messages?.length
          ? r.recent_messages
          : r.last_message
            ? [r.last_message]
            : null;
        if (!messages) continue;
        next[r.issue_id] = messages.map((m) => '> ' + m);
      }
      return next;
    });
  }, [data]);

  // ---- Auto-select something sensible ----
  useEffect(() => {
    if (selectedId) {
      const stillExists =
        data?.running.some((r) => r.issue_id === selectedId) ||
        data?.retrying.some((r) => r.issue_id === selectedId) ||
        available.some((a) => a.id === selectedId) ||
        doneItems.some((d) => d.issue_id === selectedId);
      if (stillExists) return;
    }
    const firstRunning = data?.running[0]?.issue_id;
    const firstRetry = data?.retrying[0]?.issue_id;
    const firstTodo = available[0]?.id;
    const next = firstRunning ?? firstRetry ?? firstTodo ?? doneItems[0]?.issue_id ?? null;
    if (next !== selectedId) setSelectedId(next);
  }, [selectedId, data, available, doneItems]);

  // ---- Actions (preserved) ----

  const handleStart = async (issueId: string) => {
    setLoadingAction(`start-${issueId}`);
    try {
      await fetch(`/api/v1/issues/${issueId}/start`, { method: 'POST' });
      await fetchState();
      await fetchAvailable();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleStop = async (issueId: string) => {
    setLoadingAction(`stop-${issueId}`);
    try {
      await fetch(`/api/v1/issues/${issueId}/stop`, { method: 'POST' });
      await fetchState();
      await fetchAvailable();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDelete = async (issueId: string, identifier: string) => {
    setLoadingAction(`delete-${issueId}`);
    try {
      await fetch(`/api/v1/issues/${issueId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      await fetchState();
      await fetchAvailable();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleAutoDispatch = async (enabled: boolean) => {
    try {
      await fetch('/api/v1/auto-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await fetchState();
    } catch {
      /* silent */
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/v1/refresh', { method: 'POST' });
      setTimeout(async () => {
        await fetchState();
        await fetchAvailable();
        setRefreshing(false);
      }, 1500);
    } catch {
      setRefreshing(false);
    }
  };

  const handleSyncIssues = async () => {
    setSyncLoading(true);
    try {
      await fetchAvailable();
      setNewIssueCount(0);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleAddIssue = async () => {
    if (!addForm.title.trim()) {
      setAddError('Title is required');
      return;
    }
    setAddError(null);
    setLoadingAction('add-issue');
    try {
      const res = await fetch('/api/v1/manual-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: addForm.title.trim(),
          description: addForm.description.trim() || undefined,
          priority: addForm.priority ? parseInt(addForm.priority) : undefined,
          labels: addForm.labels
            ? addForm.labels.split(',').map((l) => l.trim()).filter(Boolean)
            : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAddError(json.error?.message ?? 'Failed to add issue');
        return;
      }
      setAddForm({ title: '', description: '', priority: '', labels: '' });
      setShowAddForm(false);
      await fetchAvailable();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDismissDone = (issueId: string) => {
    setDoneItems((prev) => prev.filter((d) => d.issue_id !== issueId));
  };

  // ---- Drag & Drop (preserved: todo→in-progress = start) ----

  const handleDragStart = (e: React.DragEvent, issueId: string, fromColumn: KanbanColumn) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ issueId, fromColumn }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, column: KanbanColumn) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(column);
  };

  const handleDragLeave = () => setDragOverColumn(null);

  const handleDrop = async (e: React.DragEvent, toColumn: KanbanColumn) => {
    e.preventDefault();
    setDragOverColumn(null);
    try {
      const payload = JSON.parse(e.dataTransfer.getData('text/plain')) as {
        issueId: string;
        fromColumn: KanbanColumn;
      };
      const { issueId, fromColumn } = payload;
      if (fromColumn === toColumn) return;
      if (fromColumn === 'todo' && toColumn === 'in-progress') {
        await handleStart(issueId);
      }
    } catch {
      /* invalid drag data */
    }
  };

  // ---- Unified issue normalization (so swim lanes/cards see one shape) ----

  const unifiedIssues: UnifiedIssue[] = useMemo(() => {
    const out: UnifiedIssue[] = [];
    const activeIds = new Set<string>([
      ...(data?.running.map((r) => r.issue_id) ?? []),
      ...(data?.retrying.map((r) => r.issue_id) ?? []),
      ...doneItems.map((d) => d.issue_id),
    ]);
    for (const a of available) {
      if (activeIds.has(a.id)) continue;
      out.push({
        id: a.id,
        identifier: a.identifier,
        title: a.title,
        state: 'todo',
        priority: a.priority,
        labels: a.labels,
        attempt: 0,
        seconds: 0,
        tokens: 0,
        status: 'Unclaimed',
        lastMsg: null,
        dueAtMs: null,
        error: null,
        finishedAt: null,
      });
    }
    if (data) {
      for (const r of data.running) {
        out.push({
          id: r.issue_id,
          identifier: r.issue_identifier,
          title: titleCacheRef.current.get(r.issue_id) ?? r.issue_identifier,
          state: 'running',
          priority: null,
          labels: [],
          attempt: r.attempt,
          seconds: r.seconds_running,
          tokens: r.tokens.total_tokens,
          status: r.status,
          lastMsg: r.last_message,
          dueAtMs: null,
          error: null,
          finishedAt: null,
        });
      }
      for (const r of data.retrying) {
        out.push({
          id: r.issue_id,
          identifier: r.issue_identifier,
          title: titleCacheRef.current.get(r.issue_id) ?? r.issue_identifier,
          state: 'retrying',
          priority: null,
          labels: [],
          attempt: r.attempt,
          seconds: 0,
          tokens: 0,
          status: r.error?.startsWith('Completed') ? 'Succeeded' : 'Failed',
          lastMsg: null,
          dueAtMs: new Date(r.due_at).getTime(),
          error: r.error,
          finishedAt: null,
        });
      }
    }
    for (const d of doneItems) {
      out.push({
        id: d.issue_id,
        identifier: d.issue_identifier,
        title: d.title ?? titleCacheRef.current.get(d.issue_id) ?? d.issue_identifier,
        state: 'done',
        priority: null,
        labels: [],
        attempt: 0,
        seconds: 0,
        tokens: 0,
        status: 'Succeeded',
        lastMsg: null,
        dueAtMs: null,
        error: null,
        finishedAt: d.finished_at,
      });
    }
    return out;
  }, [available, data, doneItems]);

  const byState: Record<LaneState, UnifiedIssue[]> = {
    todo: unifiedIssues.filter((i) => i.state === 'todo'),
    running: unifiedIssues.filter((i) => i.state === 'running'),
    retrying: unifiedIssues.filter((i) => i.state === 'retrying'),
    done: unifiedIssues.filter((i) => i.state === 'done'),
  };

  const selected = unifiedIssues.find((i) => i.id === selectedId) ?? null;

  const autoDispatch = data?.auto_dispatch ?? false;
  const runningCount = data?.counts.running ?? 0;
  const retryingCount = data?.counts.retrying ?? 0;

  // ---- Swim lanes (only applied in todo column — running/retrying not priority-tagged by API) ----
  const lanes: { key: string; label: string; test: (i: UnifiedIssue) => boolean; tint: string }[] = [
    { key: 'urgent', label: 'Urgent', tint: '#e5484d', test: (i) => i.priority === 1 },
    { key: 'high', label: 'High', tint: '#f5a524', test: (i) => i.priority === 2 },
    {
      key: 'rest',
      label: 'Medium & Low',
      tint: '#7e8a95',
      test: (i) => i.priority == null || i.priority > 2 || i.priority === 0,
    },
  ];

  // Columns
  const columns: {
    key: KanbanColumn;
    laneKey: LaneState;
    label: string;
    accent: string;
    count: number;
  }[] = [
    { key: 'todo', laneKey: 'todo', label: 'To do', accent: '#7e8a95', count: byState.todo.length },
    { key: 'in-progress', laneKey: 'running', label: 'Running', accent: '#6bd69c', count: byState.running.length },
    { key: 'review', laneKey: 'retrying', label: 'Retrying', accent: '#f5c050', count: byState.retrying.length },
    { key: 'done', laneKey: 'done', label: 'Done', accent: '#7dd3a1', count: byState.done.length },
  ];

  // ---- Render ----

  const rootStyle: CSSProperties = {
    minHeight: '100vh',
    background: 'var(--k-bg)',
    color: 'var(--k-fg)',
    display: 'grid',
    gridTemplateColumns: `${sidebarOpen ? 220 : 28}px 1fr 360px`,
    gridTemplateRows: '56px 1fr',
    fontFamily: 'var(--font-inter), system-ui, sans-serif',
    transition: 'grid-template-columns 0.2s',
  };

  return (
    <div style={rootStyle}>
      {/* Sidebar */}
      <aside
        style={{
          gridRow: '1 / span 2',
          borderRight: '1px solid var(--k-border)',
          background: 'var(--k-bg-panel)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {sidebarOpen ? (
          <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}
            className="scroll-kanban">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'oklch(0.72 0.16 55)',
                  boxShadow: '0 0 10px oklch(0.72 0.16 55 / 0.7)',
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--font-jetbrains-mono), monospace',
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  fontSize: 13,
                  color: 'var(--k-fg)',
                  flex: 1,
                }}
              >
                SYMPHONY
              </span>
              <button
                onClick={() => setSidebarOpen(false)}
                title="Hide sidebar"
                style={iconButtonStyle}
              >
                <Icon name="chevronL" size={13} />
              </button>
            </div>

            {data?.mock_mode && (
              <div
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-jetbrains-mono), monospace',
                  color: '#f5c050',
                  background: 'rgba(245,192,80,0.1)',
                  border: '1px solid rgba(245,192,80,0.3)',
                  padding: '4px 8px',
                  borderRadius: 4,
                  alignSelf: 'flex-start',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                Mock mode
              </div>
            )}

            <div style={sectionLabelStyle}>Overview</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <KMetric label="Running" value={String(runningCount)} accent="#6bd69c" pulse={runningCount > 0} />
              <KMetric label="Retrying" value={String(retryingCount)} accent="#f5c050" />
              <KMetric
                label="Tokens"
                value={formatTokens(data?.codex_totals.total_tokens ?? 0)}
                accent="#9bb7ff"
              />
              <KMetric
                label="Runtime"
                value={formatDuration(data?.codex_totals.seconds_running ?? 0)}
                accent="#c89bff"
              />
            </div>

            <div style={sectionLabelStyle}>Controls</div>
            <button
              onClick={() => handleAutoDispatch(!autoDispatch)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                background: autoDispatch
                  ? 'rgba(107,214,156,0.12)'
                  : 'var(--k-surface-1)',
                color: autoDispatch ? '#6bd69c' : 'var(--k-fg-muted)',
                border: autoDispatch
                  ? '1px solid rgba(107,214,156,0.3)'
                  : '1px solid var(--k-border)',
                fontFamily: 'var(--font-jetbrains-mono), monospace',
                fontSize: 11,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>auto-dispatch</span>
              <span style={{ fontWeight: 700 }}>{autoDispatch ? 'ON' : 'OFF'}</span>
            </button>

            <SideBtn
              icon="refresh"
              label={refreshing ? 'polling…' : 'Force poll'}
              onClick={handleRefresh}
              disabled={refreshing}
              spin={refreshing}
            />
            <SideBtn
              icon="plus"
              label="Add issue"
              onClick={() => setShowAddForm((s) => !s)}
            />

            {/* Token breakdown */}
            {data && data.codex_totals.total_tokens > 0 && (
              <>
                <div style={sectionLabelStyle}>Token usage</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <TokenRow label="Input" value={formatTokens(data.codex_totals.input_tokens)} color="#9bb7ff" />
                  <TokenRow label="Output" value={formatTokens(data.codex_totals.output_tokens)} color="#6bd69c" />
                  <TokenRow label="Total" value={formatTokens(data.codex_totals.total_tokens)} color="#c89bff" />
                </div>
              </>
            )}

            <div
              style={{
                marginTop: 'auto',
                paddingTop: 10,
                borderTop: '1px solid var(--k-border)',
                fontSize: 11,
                color: 'var(--k-fg-dim)',
                fontFamily: 'var(--font-jetbrains-mono), monospace',
              }}
            >
              {data?.generated_at && <div>updated {relativeTime(data.generated_at)}</div>}
              <div>project harmony</div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setSidebarOpen(true)}
            title="Show sidebar"
            style={{
              ...iconButtonStyle,
              margin: '14px auto',
              width: 24,
              height: 24,
            }}
          >
            <Icon name="chevronR" size={13} />
          </button>
        )}
      </aside>

      {/* Header */}
      <header
        style={{
          gridColumn: '2 / span 2',
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
            {runningCount} running · {retryingCount} retrying · {byState.todo.length} queued
          </div>
        </div>
        <div style={{ flex: 1 }} />

        <button
          onClick={handleSyncIssues}
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
          onClick={() => setShowAddForm((s) => !s)}
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

        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={iconButtonStyle}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
        </button>
      </header>

      {/* Main content */}
      <main
        style={{
          padding: '16px 20px',
          overflowY: 'auto',
          overflowX: 'hidden',
          minWidth: 0,
        }}
        className="scroll-kanban"
      >
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

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gridAutoRows: 'auto',
            gap: 12,
          }}
        >
          {/* Column headers */}
          {columns.map((col) => (
            <div
              key={col.key + 'h'}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px' }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: col.accent,
                  boxShadow: `0 0 8px ${col.accent}80`,
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--k-fg)' }}>{col.label}</span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--k-fg-dim)',
                  fontFamily: 'var(--font-jetbrains-mono), monospace',
                }}
              >
                {col.count}
              </span>
            </div>
          ))}

          {/* Swim lanes × columns */}
          {lanes.map((lane) =>
            columns.map((col) => {
              const items =
                col.laneKey === 'todo'
                  ? byState.todo.filter(lane.test)
                  : lane.key === 'urgent'
                  ? byState[col.laneKey] // non-todo lanes get the full column in the first swim row
                  : [];

              const isDragTarget = dragOverColumn === col.key;

              return (
                <div
                  key={lane.key + '-' + col.key}
                  onDragOver={(e) => handleDragOver(e, col.key)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, col.key)}
                  style={{
                    border: isDragTarget
                      ? '1px dashed oklch(0.72 0.16 55)'
                      : '1px solid var(--k-border)',
                    borderRadius: 10,
                    background: isDragTarget
                      ? 'oklch(0.72 0.16 55 / 0.06)'
                      : 'var(--k-surface-1)',
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    minHeight: 120,
                  }}
                >
                  {col.key === 'todo' && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: lane.tint,
                        fontFamily: 'var(--font-jetbrains-mono), monospace',
                        padding: '2px 6px',
                        marginBottom: 2,
                        alignSelf: 'flex-start',
                        background: lane.tint + '14',
                        borderRadius: 4,
                      }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: lane.tint }} />
                      {lane.label}
                    </div>
                  )}

                  {items.map((issue) => (
                    <KCard
                      key={issue.id}
                      issue={issue}
                      selected={issue.id === selectedId}
                      onClick={() => setSelectedId(issue.id)}
                      onStart={() => handleStart(issue.id)}
                      onStop={() => handleStop(issue.id)}
                      onDelete={() => handleDelete(issue.id, issue.identifier)}
                      onDismiss={() => handleDismissDone(issue.id)}
                      miniLog={logs[issue.id]}
                      spark={tokenHistory[issue.id]}
                      loadingAction={loadingAction}
                      draggable={issue.state !== 'done'}
                      onDragStart={(e) =>
                        handleDragStart(e, issue.id, columnFromLaneState(issue.state))
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
                      —
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Right rail — focused run detail */}
      <section
        style={{
          borderLeft: '1px solid var(--k-border)',
          padding: '16px 18px',
          overflowY: 'auto',
          background: 'var(--k-bg-panel)',
        }}
        className="scroll-kanban"
      >
        {selected ? (
          <KRunDetail
            issue={selected}
            logs={logs[selected.id] ?? []}
            history={tokenHistory[selected.id] ?? []}
            onStop={() => handleStop(selected.id)}
            onStart={() => handleStart(selected.id)}
            onDelete={() => handleDelete(selected.id, selected.identifier)}
            onDismiss={() => handleDismissDone(selected.id)}
            loadingAction={loadingAction}
          />
        ) : (
          <div style={{ color: 'var(--k-fg-dim)', fontSize: 12 }}>Select a card to see details</div>
        )}
      </section>
    </div>
  );
}

function columnFromLaneState(s: LaneState): KanbanColumn {
  switch (s) {
    case 'todo':
      return 'todo';
    case 'running':
      return 'in-progress';
    case 'retrying':
      return 'review';
    case 'done':
      return 'done';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const sectionLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-jetbrains-mono), monospace',
  fontSize: 10,
  color: 'var(--k-fg-dim)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const iconButtonStyle: CSSProperties = {
  padding: 6,
  borderRadius: 6,
  background: 'transparent',
  border: '1px solid var(--k-border)',
  color: 'var(--k-fg-muted)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function KMetric({
  label,
  value,
  accent,
  pulse,
}: {
  label: string;
  value: string;
  accent: string;
  pulse?: boolean;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--k-border)',
        borderRadius: 8,
        padding: '10px 12px',
        background: 'var(--k-surface-1)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--k-fg-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          marginBottom: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {pulse && (
          <span
            className="pulse-dot"
            style={{ width: 6, height: 6, borderRadius: '50%', background: accent }}
          />
        )}
        {label}
      </div>
      <div style={{ fontSize: 22, fontFamily: 'var(--font-jetbrains-mono), monospace', fontWeight: 600, color: accent }}>
        {value}
      </div>
    </div>
  );
}

function SideBtn({
  icon,
  label,
  onClick,
  disabled,
  spin,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 8,
        background: 'var(--k-surface-1)',
        border: '1px solid var(--k-border)',
        color: 'var(--k-fg)',
        fontSize: 12,
        fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Icon name={icon} size={13} style={spin ? { animation: 'pulse-dot 0.8s linear infinite' } : undefined} />
      <span>{label}</span>
    </button>
  );
}

function TokenRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--k-border)',
        borderRadius: 8,
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: 'var(--k-fg-dim)',
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          fontWeight: 600,
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function KCard({
  issue,
  selected,
  onClick,
  onStart,
  onStop,
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
  const isDone = issue.state === 'done';
  const isTodo = issue.state === 'todo';
  const accent = statusColor(issue.status);

  const leftBorder = isRunning
    ? accent
    : isRetrying
    ? accent
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

function miniBtnStyle(color: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 5,
    background: color + '22',
    color,
    border: '1px solid ' + color + '44',
    fontSize: 10,
    fontFamily: 'var(--font-jetbrains-mono), monospace',
    cursor: 'pointer',
  };
}

function KRunDetail({
  issue,
  logs,
  history,
  onStop,
  onStart,
  onDelete,
  onDismiss,
  loadingAction,
}: {
  issue: UnifiedIssue;
  logs: string[];
  history: number[];
  onStop: () => void;
  onStart: () => void;
  onDelete: () => void;
  onDismiss: () => void;
  loadingAction: string | null;
}) {
  const isRunning = issue.state === 'running';
  const isRetrying = issue.state === 'retrying';
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
        {(isRunning || isRetrying) && (
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

function primaryBtn(color: string): CSSProperties {
  return {
    flex: 1,
    padding: '9px',
    borderRadius: 8,
    background: color + '1f',
    border: '1px solid ' + color + '4d',
    color,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontFamily: 'inherit',
  };
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

function AddIssueForm({
  form,
  setForm,
  onSubmit,
  loading,
  error,
  onClose,
}: {
  form: { title: string; description: string; priority: string; labels: string };
  setForm: (f: { title: string; description: string; priority: string; labels: string }) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 12,
    borderRadius: 6,
    background: 'var(--k-bg)',
    border: '1px solid var(--k-border)',
    color: 'var(--k-fg)',
    fontFamily: 'inherit',
    outline: 'none',
  };
  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: 10,
    color: 'var(--k-fg-dim)',
    fontFamily: 'var(--font-jetbrains-mono), monospace',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 4,
  };

  return (
    <div
      style={{
        border: '1px solid var(--k-border)',
        borderRadius: 10,
        background: 'var(--k-surface-1)',
        padding: 14,
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>New issue</span>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={iconButtonStyle} title="Close">
          <Icon name="x" size={12} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelStyle}>Title *</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Fix login timeout on mobile"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Priority</label>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            style={inputStyle}
          >
            <option value="">None</option>
            <option value="1">Urgent</option>
            <option value="2">High</option>
            <option value="3">Medium</option>
            <option value="4">Low</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Labels (comma-sep)</label>
          <input
            type="text"
            value={form.labels}
            onChange={(e) => setForm({ ...form, labels: e.target.value })}
            placeholder="bug, frontend"
            style={inputStyle}
          />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Description</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Describe the issue in detail..."
          rows={2}
          style={{ ...inputStyle, resize: 'none' }}
        />
      </div>
      {error && (
        <div style={{ fontSize: 11, color: '#ee6060', fontFamily: 'var(--font-jetbrains-mono), monospace' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onSubmit}
          disabled={loading}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            background: 'oklch(0.72 0.16 55)',
            color: '#0b0c0d',
            border: 0,
            fontSize: 12,
            fontWeight: 600,
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontFamily: 'inherit',
          }}
        >
          {loading ? 'Adding…' : 'Add issue'}
        </button>
      </div>
    </div>
  );
}
