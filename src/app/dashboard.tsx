'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTheme } from './theme-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunningRow {
  issue_id: string;
  issue_identifier: string;
  attempt: number;
  status: string;
  started_at: string;
  seconds_running: number;
  tokens: { input_tokens: number; output_tokens: number; total_tokens: number };
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
  finished_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
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

function statusColor(status: string): string {
  switch (status) {
    case 'StreamingTurn': return 'text-green-400';
    case 'PreparingWorkspace':
    case 'BuildingPrompt':
    case 'LaunchingAgentProcess':
    case 'InitializingSession': return 'text-yellow-400';
    case 'Failed':
    case 'TimedOut':
    case 'Stalled': return 'text-red-400';
    default: return 'text-zinc-400';
  }
}

function priorityLabel(p: number | null): string {
  if (p === null) return '\u2014';
  const labels: Record<number, string> = { 0: 'None', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
  return labels[p] ?? String(p);
}

function priorityColor(p: number | null): string {
  if (p === 1) return 'text-red-400';
  if (p === 2) return 'text-orange-400';
  if (p === 3) return 'text-yellow-400';
  return 'text-zinc-500';
}

function sourceTag(id: string): { label: string; cls: string } {
  if (id.startsWith('manual-')) return { label: 'Manual', cls: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800/50' };
  if (id.startsWith('issue-')) return { label: 'Mock', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/50' };
  if (/^\d+$/.test(id)) return { label: 'GitHub', cls: 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700' };
  return { label: 'Tracker', cls: 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700' };
}

type KanbanColumn = 'todo' | 'in-progress' | 'review' | 'done';

// ---------------------------------------------------------------------------
// Dashboard Component
// ---------------------------------------------------------------------------

export function Dashboard() {
  const { theme, toggleTheme } = useTheme();
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

  // Track previously-running issue IDs so we can detect completions
  const prevRunningIds = useRef<Set<string>>(new Set());
  const prevRetryingIds = useRef<Set<string>>(new Set());

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
      setAvailable(json.issues ?? []);
    } catch {
      // silent
    }
  }, []);

  // Detect items that leave running/retrying and move them to Done
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

  useEffect(() => {
    fetchState();
    fetchAvailable();
    const interval = setInterval(() => {
      fetchState();
      fetchAvailable();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchState, fetchAvailable]);

  // ---- Actions ----

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
      // silent
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

  // ---- Drag & Drop ----

  const handleDragStart = (e: React.DragEvent, issueId: string, fromColumn: KanbanColumn) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ issueId, fromColumn }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, column: KanbanColumn) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(column);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, toColumn: KanbanColumn) => {
    e.preventDefault();
    setDragOverColumn(null);
    try {
      const payload = JSON.parse(e.dataTransfer.getData('text/plain'));
      const { issueId, fromColumn } = payload as { issueId: string; fromColumn: KanbanColumn };
      if (fromColumn === toColumn) return;

      // To Do -> In Progress: start the task
      if (fromColumn === 'todo' && toColumn === 'in-progress') {
        await handleStart(issueId);
      }
    } catch {
      // invalid drag data
    }
  };

  const handleDismissDone = (issueId: string) => {
    setDoneItems((prev) => prev.filter((d) => d.issue_id !== issueId));
  };

  const autoDispatch = data?.auto_dispatch ?? false;

  const columnConfig: { key: KanbanColumn; label: string; accent: string; count: number }[] = [
    { key: 'todo', label: 'To Do', accent: 'border-zinc-500', count: available.length },
    { key: 'in-progress', label: 'In Progress', accent: 'border-blue-500', count: data?.running.length ?? 0 },
    { key: 'review', label: 'Review', accent: 'border-yellow-500', count: data?.retrying.length ?? 0 },
    { key: 'done', label: 'Done', accent: 'border-green-500', count: doneItems.length },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight">Symphony</h1>
            <span className="text-xs text-zinc-500 ml-1">Agent Orchestrator</span>
            {data?.mock_mode && (
              <span className="ml-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50">
                Mock
              </span>
            )}
          </div>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors text-zinc-600 dark:text-zinc-400"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 57px)' }}>
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="shrink-0 w-6 flex items-center justify-center border-r border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/20 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/40 transition-colors text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          <span className="text-xs">{sidebarOpen ? '\u25C0' : '\u25B6'}</span>
        </button>

        {/* Sidebar */}
        <aside className={`shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 overflow-y-auto transition-all duration-200 ${sidebarOpen ? 'w-56 p-4 space-y-4' : 'w-0 p-0 overflow-hidden border-r-0'}`}>
          {/* Controls */}
          <div className="space-y-2">
            {data && (
              <span className="text-[10px] text-zinc-500 block">{relativeTime(data.generated_at)}</span>
            )}
            <button
              onClick={() => handleAutoDispatch(!autoDispatch)}
              className={`w-full px-3 py-1.5 text-xs rounded-md border transition-colors ${
                autoDispatch
                  ? 'bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-800/50 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/60'
                  : 'bg-zinc-200 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              Auto: {autoDispatch ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="w-full px-3 py-1.5 text-xs rounded-md bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 border border-zinc-300 dark:border-zinc-700 transition-colors disabled:opacity-50"
            >
              {refreshing ? 'Polling...' : 'Force Poll'}
            </button>
          </div>

          {/* Stats */}
          {data && (
            <>
              <div>
                <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Overview</h3>
                <div className="space-y-2">
                  <SummaryCard label="Running" value={String(data.counts.running)} accent="text-green-400" />
                  <SummaryCard label="Retrying" value={String(data.counts.retrying)} accent="text-yellow-400" />
                  <SummaryCard label="Total Tokens" value={formatTokens(data.codex_totals.total_tokens)} accent="text-blue-400" />
                  <SummaryCard label="Runtime" value={formatDuration(data.codex_totals.seconds_running)} accent="text-purple-400" />
                </div>
              </div>

              {/* Token breakdown */}
              {data.codex_totals.total_tokens > 0 && (
                <div>
                  <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Token Usage</h3>
                  <div className="space-y-2">
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-[10px] text-zinc-500 mb-0.5">Input</div>
                      <div className="text-sm font-semibold text-blue-400">
                        {formatTokens(data.codex_totals.input_tokens)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-[10px] text-zinc-500 mb-0.5">Output</div>
                      <div className="text-sm font-semibold text-emerald-400">
                        {formatTokens(data.codex_totals.output_tokens)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2">
                      <div className="text-[10px] text-zinc-500 mb-0.5">Total</div>
                      <div className="text-sm font-semibold text-purple-400">
                        {formatTokens(data.codex_totals.total_tokens)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Error state */}
          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Add Issue button */}
          <div className="flex justify-end">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3 py-1.5 text-xs rounded-md bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/50 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition-colors"
            >
              {showAddForm ? 'Cancel' : '+ Add Issue'}
            </button>
          </div>

          {/* Add Issue form */}
          {showAddForm && (
            <div className="rounded-lg border border-indigo-200 dark:border-indigo-800/40 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Title *</label>
                  <input
                    type="text"
                    value={addForm.title}
                    onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                    placeholder="e.g. Fix login timeout on mobile"
                    className="w-full px-3 py-2 text-sm rounded-md bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Priority</label>
                    <select
                      value={addForm.priority}
                      onChange={(e) => setAddForm({ ...addForm, priority: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-md bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-600"
                    >
                      <option value="">None</option>
                      <option value="1">Urgent</option>
                      <option value="2">High</option>
                      <option value="3">Medium</option>
                      <option value="4">Low</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Labels (comma-sep)</label>
                    <input
                      type="text"
                      value={addForm.labels}
                      onChange={(e) => setAddForm({ ...addForm, labels: e.target.value })}
                      placeholder="bug, frontend"
                      className="w-full px-3 py-2 text-sm rounded-md bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-600"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Description</label>
                <textarea
                  value={addForm.description}
                  onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                  placeholder="Describe the issue in detail..."
                  rows={2}
                  className="w-full px-3 py-2 text-sm rounded-md bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-600 resize-none"
                />
              </div>
              {addError && (
                <div className="text-xs text-red-500 dark:text-red-400">{addError}</div>
              )}
              <div className="flex justify-end">
                <button
                  onClick={handleAddIssue}
                  disabled={loadingAction === 'add-issue'}
                  className="px-4 py-2 text-xs rounded-md bg-indigo-700 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50"
                >
                  {loadingAction === 'add-issue' ? 'Adding...' : 'Add Issue'}
                </button>
              </div>
            </div>
          )}

          {/* Kanban Board */}
          <div className="grid grid-cols-4 gap-4 flex-1" style={{ minHeight: 'calc(100vh - 180px)' }}>
            {columnConfig.map((col) => (
              <div
                key={col.key}
                className={`flex flex-col rounded-lg border bg-zinc-50/50 dark:bg-zinc-900/20 transition-colors ${
                  dragOverColumn === col.key
                    ? 'border-indigo-400/60 dark:border-indigo-500/60 bg-indigo-50/30 dark:bg-indigo-950/10'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
                onDragOver={(e) => handleDragOver(e, col.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.key)}
              >
                {/* Column Header */}
                <div className={`px-4 py-3 border-b-2 ${col.accent} bg-zinc-100/80 dark:bg-zinc-900/40 rounded-t-lg`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{col.label}</h3>
                    <span className="text-xs text-zinc-500 bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                      {col.count}
                    </span>
                  </div>
                </div>

                {/* Column Body */}
                <div className="flex-1 p-3 space-y-2 overflow-y-auto">
                  {/* To Do cards */}
                  {col.key === 'todo' && available.map((issue) => {
                    const src = sourceTag(issue.id);
                    return (
                      <div
                        key={issue.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, issue.id, 'todo')}
                        className="rounded-lg border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-900/60 p-3 cursor-grab active:cursor-grabbing hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors group shadow-sm dark:shadow-none"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{issue.identifier}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${src.cls}`}>
                            {src.label}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-2 mb-2">{issue.title}</p>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] ${priorityColor(issue.priority)}`}>
                            {priorityLabel(issue.priority)}
                          </span>
                          <button
                            onClick={() => handleStart(issue.id)}
                            disabled={loadingAction === `start-${issue.id}`}
                            className="px-2 py-0.5 text-[10px] rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800/50 hover:bg-green-200 dark:hover:bg-green-900/60 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                          >
                            {loadingAction === `start-${issue.id}` ? '...' : 'Start'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {col.key === 'todo' && available.length === 0 && (
                    <div className="text-center py-8 text-zinc-600 text-xs">
                      No issues available
                    </div>
                  )}

                  {/* In Progress cards */}
                  {col.key === 'in-progress' && data?.running.map((r) => (
                    <div
                      key={r.issue_id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, r.issue_id, 'in-progress')}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-700/50 bg-white dark:bg-zinc-900/60 p-3 cursor-grab active:cursor-grabbing hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors group shadow-sm dark:shadow-none"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{r.issue_identifier}</span>
                        <span className={`text-[10px] font-medium ${statusColor(r.status)}`}>{r.status}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-zinc-500 mb-2">
                        <span>Attempt {r.attempt}</span>
                        <span>{formatDuration(r.seconds_running)}</span>
                        <span>{formatTokens(r.tokens.total_tokens)} tokens</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleStop(r.issue_id)}
                          disabled={loadingAction === `stop-${r.issue_id}`}
                          className="px-2 py-0.5 text-[10px] rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                        >
                          {loadingAction === `stop-${r.issue_id}` ? '...' : 'Stop'}
                        </button>
                        <button
                          onClick={() => handleDelete(r.issue_id, r.issue_identifier)}
                          disabled={loadingAction === `delete-${r.issue_id}`}
                          className="px-2 py-0.5 text-[10px] rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-500 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-700 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          {loadingAction === `delete-${r.issue_id}` ? '...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {col.key === 'in-progress' && (!data || data.running.length === 0) && (
                    <div className="text-center py-8 text-zinc-600 text-xs">
                      {available.length > 0 ? 'Drag a task here to start' : 'No running sessions'}
                    </div>
                  )}

                  {/* Review cards */}
                  {col.key === 'review' && data?.retrying.map((r) => (
                    <div
                      key={r.issue_id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, r.issue_id, 'review')}
                      className="rounded-lg border border-yellow-200 dark:border-yellow-800/30 bg-white dark:bg-zinc-900/60 p-3 cursor-grab active:cursor-grabbing hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors group shadow-sm dark:shadow-none"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{r.issue_identifier}</span>
                        <span className="text-[10px] text-yellow-600 dark:text-yellow-400">Retry #{r.attempt}</span>
                      </div>
                      {r.error && (
                        <p className="text-[10px] text-red-500 dark:text-red-400/80 leading-relaxed line-clamp-2 mb-2">{r.error}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-zinc-500">Due {relativeTime(r.due_at)}</span>
                        <button
                          onClick={() => handleDelete(r.issue_id, r.issue_identifier)}
                          disabled={loadingAction === `delete-${r.issue_id}`}
                          className="px-2 py-0.5 text-[10px] rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-500 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-700 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                        >
                          {loadingAction === `delete-${r.issue_id}` ? '...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {col.key === 'review' && (!data || data.retrying.length === 0) && (
                    <div className="text-center py-8 text-zinc-600 text-xs">
                      No items for review
                    </div>
                  )}

                  {/* Done cards */}
                  {col.key === 'done' && doneItems.map((d) => (
                    <div
                      key={d.issue_id}
                      className="rounded-lg border border-green-200 dark:border-green-800/20 bg-white dark:bg-zinc-900/60 p-3 group shadow-sm dark:shadow-none"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{d.issue_identifier}</span>
                        <button
                          onClick={() => handleDismissDone(d.issue_id)}
                          className="text-[10px] text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          Dismiss
                        </button>
                      </div>
                      <span className="text-[10px] text-zinc-500">Completed {relativeTime(d.finished_at)}</span>
                    </div>
                  ))}
                  {col.key === 'done' && doneItems.length === 0 && (
                    <div className="text-center py-8 text-zinc-600 text-xs">
                      Completed tasks appear here
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30 px-4 py-3">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}
