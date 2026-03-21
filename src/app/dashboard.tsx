'use client';

import { useEffect, useState, useCallback } from 'react';

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
  if (p === null) return '—';
  const labels: Record<number, string> = { 0: 'None', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };
  return labels[p] ?? String(p);
}

function priorityColor(p: number | null): string {
  if (p === 1) return 'text-red-400';
  if (p === 2) return 'text-orange-400';
  if (p === 3) return 'text-yellow-400';
  return 'text-zinc-500';
}

function stateColor(state: string): string {
  const s = state.toLowerCase();
  if (s === 'in progress') return 'text-blue-400';
  if (s === 'todo') return 'text-zinc-400';
  return 'text-zinc-500';
}

function sourceTag(id: string): { label: string; cls: string } {
  if (id.startsWith('manual-')) return { label: 'Manual', cls: 'bg-purple-900/40 text-purple-400 border-purple-800/50' };
  if (id.startsWith('issue-')) return { label: 'Mock', cls: 'bg-amber-900/40 text-amber-400 border-amber-800/50' };
  if (/^\d+$/.test(id)) return { label: 'GitHub', cls: 'bg-zinc-800 text-zinc-300 border-zinc-700' };
  return { label: 'Tracker', cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
}

// ---------------------------------------------------------------------------
// Dashboard Component
// ---------------------------------------------------------------------------

export function Dashboard() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<AvailableIssue[]>([]);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ title: '', description: '', priority: '', labels: '' });
  const [addError, setAddError] = useState<string | null>(null);

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

  const autoDispatch = data?.auto_dispatch ?? false;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight">Symphony</h1>
            <span className="text-xs text-zinc-500 ml-1">Agent Orchestrator</span>
            {data?.mock_mode && (
              <span className="ml-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded bg-amber-900/40 text-amber-400 border border-amber-800/50">
                Mock
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <span className="text-xs text-zinc-500">{relativeTime(data.generated_at)}</span>
            )}
            <button
              onClick={() => handleAutoDispatch(!autoDispatch)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                autoDispatch
                  ? 'bg-green-900/40 border-green-800/50 text-green-400 hover:bg-green-900/60'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              Auto: {autoDispatch ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors disabled:opacity-50"
            >
              {refreshing ? 'Polling…' : 'Force Poll'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Summary cards */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard label="Running" value={String(data.counts.running)} accent="text-green-400" />
            <SummaryCard label="Retrying" value={String(data.counts.retrying)} accent="text-yellow-400" />
            <SummaryCard label="Total Tokens" value={formatTokens(data.codex_totals.total_tokens)} accent="text-blue-400" />
            <SummaryCard label="Runtime" value={formatDuration(data.codex_totals.seconds_running)} accent="text-purple-400" />
          </div>
        )}

        {/* Available issues + Add Issue */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Available Issues
            </h2>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3 py-1.5 text-xs rounded-md bg-indigo-900/40 text-indigo-400 border border-indigo-800/50 hover:bg-indigo-900/60 transition-colors"
            >
              {showAddForm ? '✕ Cancel' : '+ Add Issue'}
            </button>
          </div>

          {/* Add Issue form */}
          {showAddForm && (
            <div className="rounded-lg border border-indigo-800/40 bg-indigo-950/20 p-4 mb-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Title *</label>
                  <input
                    type="text"
                    value={addForm.title}
                    onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                    placeholder="e.g. Fix login timeout on mobile"
                    className="w-full px-3 py-2 text-sm rounded-md bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Priority</label>
                    <select
                      value={addForm.priority}
                      onChange={(e) => setAddForm({ ...addForm, priority: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-md bg-zinc-900 border border-zinc-700 text-zinc-100 focus:outline-none focus:border-indigo-600"
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
                      className="w-full px-3 py-2 text-sm rounded-md bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-600"
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
                  className="w-full px-3 py-2 text-sm rounded-md bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-600 resize-none"
                />
              </div>
              {addError && (
                <div className="text-xs text-red-400">{addError}</div>
              )}
              <div className="flex justify-end">
                <button
                  onClick={handleAddIssue}
                  disabled={loadingAction === 'add-issue'}
                  className="px-4 py-2 text-xs rounded-md bg-indigo-700 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50"
                >
                  {loadingAction === 'add-issue' ? 'Adding…' : 'Add Issue'}
                </button>
              </div>
            </div>
          )}

          {/* Issues table */}
          {available.length > 0 ? (
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/50">
                  <tr className="text-left text-zinc-500">
                    <th className="px-4 py-2 font-medium">Issue</th>
                    <th className="px-4 py-2 font-medium">Title</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">State</th>
                    <th className="px-4 py-2 font-medium">Priority</th>
                    <th className="px-4 py-2 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {available.map((issue) => {
                    const src = sourceTag(issue.id);
                    return (
                      <tr key={issue.id} className="hover:bg-zinc-900/30">
                        <td className="px-4 py-2.5">
                          <span className="font-semibold text-zinc-200">{issue.identifier}</span>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-400 truncate max-w-xs">
                          {issue.title}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${src.cls}`}>
                            {src.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-medium ${stateColor(issue.state)}`}>
                            {issue.state}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs ${priorityColor(issue.priority)}`}>
                            {priorityLabel(issue.priority)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => handleStart(issue.id)}
                            disabled={loadingAction === `start-${issue.id}`}
                            className="px-3 py-1 text-xs rounded bg-green-900/40 text-green-400 border border-green-800/50 hover:bg-green-900/60 transition-colors disabled:opacity-50"
                          >
                            {loadingAction === `start-${issue.id}` ? '…' : '▶ Start'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            !showAddForm && (
              <div className="text-center py-8 text-zinc-600 text-sm border border-zinc-800/50 rounded-lg">
                No available issues. Add one manually or connect a tracker.
              </div>
            )
          )}
        </section>

        {/* Running sessions */}
        {data && data.running.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Running Sessions
            </h2>
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/50">
                  <tr className="text-left text-zinc-500">
                    <th className="px-4 py-2 font-medium">Issue</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Attempt</th>
                    <th className="px-4 py-2 font-medium">Runtime</th>
                    <th className="px-4 py-2 font-medium">Tokens</th>
                    <th className="px-4 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {data.running.map((r) => (
                    <tr key={r.issue_id} className="hover:bg-zinc-900/30">
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-zinc-200">{r.issue_identifier}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`font-medium ${statusColor(r.status)}`}>{r.status}</span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400">{r.attempt}</td>
                      <td className="px-4 py-2.5 text-zinc-400">{formatDuration(r.seconds_running)}</td>
                      <td className="px-4 py-2.5 text-zinc-400">{formatTokens(r.tokens.total_tokens)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleStop(r.issue_id)}
                            disabled={loadingAction === `stop-${r.issue_id}`}
                            className="px-3 py-1 text-xs rounded bg-red-900/30 text-red-400 border border-red-800/50 hover:bg-red-900/50 transition-colors disabled:opacity-50"
                          >
                            {loadingAction === `stop-${r.issue_id}` ? '…' : '■ Stop'}
                          </button>
                          <button
                            onClick={() => handleDelete(r.issue_id, r.issue_identifier)}
                            disabled={loadingAction === `delete-${r.issue_id}`}
                            className="px-3 py-1 text-xs rounded bg-zinc-800 text-zinc-500 border border-zinc-700 hover:bg-zinc-700 hover:text-red-400 transition-colors disabled:opacity-50"
                          >
                            {loadingAction === `delete-${r.issue_id}` ? '…' : '✕ Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Retry queue */}
        {data && data.retrying.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Retry Queue
            </h2>
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/50">
                  <tr className="text-left text-zinc-500">
                    <th className="px-4 py-2 font-medium">Issue</th>
                    <th className="px-4 py-2 font-medium">Attempt</th>
                    <th className="px-4 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 font-medium">Error</th>
                    <th className="px-4 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {data.retrying.map((r) => (
                    <tr key={r.issue_id} className="hover:bg-zinc-900/30">
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-zinc-200">{r.issue_identifier}</span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400">{r.attempt}</td>
                      <td className="px-4 py-2.5 text-zinc-400">{relativeTime(r.due_at)}</td>
                      <td className="px-4 py-2.5 text-red-400/80 truncate max-w-xs">{r.error ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => handleDelete(r.issue_id, r.issue_identifier)}
                          disabled={loadingAction === `delete-${r.issue_id}`}
                          className="px-3 py-1 text-xs rounded bg-zinc-800 text-zinc-500 border border-zinc-700 hover:bg-zinc-700 hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          {loadingAction === `delete-${r.issue_id}` ? '…' : '✕ Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Token breakdown */}
        {data && data.codex_totals.total_tokens > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Token Usage
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-zinc-800 px-4 py-3">
                <div className="text-xs text-zinc-500 mb-1">Input</div>
                <div className="text-lg font-semibold text-blue-400">
                  {formatTokens(data.codex_totals.input_tokens)}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 px-4 py-3">
                <div className="text-xs text-zinc-500 mb-1">Output</div>
                <div className="text-lg font-semibold text-emerald-400">
                  {formatTokens(data.codex_totals.output_tokens)}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 px-4 py-3">
                <div className="text-xs text-zinc-500 mb-1">Total</div>
                <div className="text-lg font-semibold text-purple-400">
                  {formatTokens(data.codex_totals.total_tokens)}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Empty state */}
        {data && data.counts.running === 0 && data.counts.retrying === 0 && available.length === 0 && !showAddForm && (
          <div className="text-center py-16 text-zinc-500">
            <div className="text-4xl mb-4">🎵</div>
            <p className="text-lg">No active sessions</p>
            <p className="text-sm mt-2">Add an issue manually or connect a GitHub/Linear tracker</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}
