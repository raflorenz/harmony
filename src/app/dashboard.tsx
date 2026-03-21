'use client';

import { useEffect, useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types mirroring the /api/v1/state response
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
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'StreamingTurn':
      return 'text-green-400';
    case 'PreparingWorkspace':
    case 'BuildingPrompt':
    case 'LaunchingAgentProcess':
    case 'InitializingSession':
      return 'text-yellow-400';
    case 'Failed':
    case 'TimedOut':
    case 'Stalled':
      return 'text-red-400';
    default:
      return 'text-zinc-400';
  }
}

// ---------------------------------------------------------------------------
// Dashboard Component
// ---------------------------------------------------------------------------

export function Dashboard() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  // Poll every 5 seconds
  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 5000);
    return () => clearInterval(interval);
  }, [fetchState]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/v1/refresh', { method: 'POST' });
      // Wait a moment then re-fetch state
      setTimeout(() => {
        fetchState();
        setRefreshing(false);
      }, 1500);
    } catch {
      setRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight">
              Symphony
            </h1>
            <span className="text-xs text-zinc-500 ml-2">
              Agent Orchestrator
            </span>
            {data?.mock_mode && (
              <span className="ml-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded bg-amber-900/40 text-amber-400 border border-amber-800/50">
                Mock Mode
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {data && (
              <span className="text-xs text-zinc-500">
                Updated {relativeTime(data.generated_at)}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Force Poll'}
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
            <SummaryCard
              label="Running"
              value={String(data.counts.running)}
              accent="text-green-400"
            />
            <SummaryCard
              label="Retrying"
              value={String(data.counts.retrying)}
              accent="text-yellow-400"
            />
            <SummaryCard
              label="Total Tokens"
              value={formatTokens(data.codex_totals.total_tokens)}
              accent="text-blue-400"
            />
            <SummaryCard
              label="Runtime"
              value={formatDuration(data.codex_totals.seconds_running)}
              accent="text-purple-400"
            />
          </div>
        )}

        {/* Running sessions table */}
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
                    <th className="px-4 py-2 font-medium text-right">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {data.running.map((r) => (
                    <tr key={r.issue_id} className="hover:bg-zinc-900/30">
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-zinc-200">
                          {r.issue_identifier}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`font-medium ${statusColor(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400">{r.attempt}</td>
                      <td className="px-4 py-2.5 text-zinc-400">
                        {formatDuration(r.seconds_running)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-400">
                        {formatTokens(r.tokens.total_tokens)}
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {data.retrying.map((r) => (
                    <tr key={r.issue_id} className="hover:bg-zinc-900/30">
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-zinc-200">
                          {r.issue_identifier}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400">{r.attempt}</td>
                      <td className="px-4 py-2.5 text-zinc-400">
                        {relativeTime(r.due_at)}
                      </td>
                      <td className="px-4 py-2.5 text-red-400/80 truncate max-w-xs">
                        {r.error ?? '—'}
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
        {data && data.counts.running === 0 && data.counts.retrying === 0 && (
          <div className="text-center py-16 text-zinc-500">
            <div className="text-4xl mb-4">🎵</div>
            <p className="text-lg">No active sessions</p>
            <p className="text-sm mt-2">
              Symphony is polling for eligible issues every{' '}
              <span className="text-zinc-300">
                {(data.codex_totals.seconds_running > 0 ? '' : '~')}30s
              </span>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
    </div>
  );
}
