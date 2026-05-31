// ---------------------------------------------------------------------------
// Dashboard data: polling, done detection, token/log history, and run actions
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AddIssueFormState,
  AvailableIssue,
  DoneItem,
  StateResponse,
  UnifiedIssue,
} from './types';

const SPARK_LEN = 40;

export function useDashboardData() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<AvailableIssue[]>([]);
  const [doneItems, setDoneItems] = useState<DoneItem[]>([]);
  const [tokenHistory, setTokenHistory] = useState<Record<string, number[]>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [newIssueCount, setNewIssueCount] = useState(0);

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
    const currentCanceledIds = new Set((data.canceled ?? []).map((c) => c.issue_id));
    const currentAvailableIds = new Set(available.map((a) => a.id));

    const newDone: DoneItem[] = [];
    for (const id of prevRunningIds.current) {
      if (
        !currentRunningIds.has(id) &&
        !currentRetryingIds.has(id) &&
        !currentCanceledIds.has(id) &&
        !currentAvailableIds.has(id)
      ) {
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
      if (
        !currentRunningIds.has(id) &&
        !currentRetryingIds.has(id) &&
        !currentCanceledIds.has(id) &&
        !currentAvailableIds.has(id)
      ) {
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
      for (const c of data.canceled ?? []) {
        const messages = c.recent_messages?.length
          ? c.recent_messages
          : c.last_message
            ? [c.last_message]
            : null;
        if (!messages) continue;
        next[c.issue_id] = messages.map((m) => '> ' + m);
      }
      return next;
    });
  }, [data]);

  // ---- Actions (preserved) ----

  const start = async (issueId: string) => {
    setLoadingAction(`start-${issueId}`);
    try {
      await fetch(`/api/v1/issues/${issueId}/start`, { method: 'POST' });
      await fetchState();
      await fetchAvailable();
    } finally {
      setLoadingAction(null);
    }
  };

  const stop = async (issueId: string) => {
    setLoadingAction(`stop-${issueId}`);
    try {
      await fetch(`/api/v1/issues/${issueId}/stop`, { method: 'POST' });
      await fetchState();
      await fetchAvailable();
    } finally {
      setLoadingAction(null);
    }
  };

  const resume = async (issueId: string) => {
    setLoadingAction(`resume-${issueId}`);
    try {
      await fetch(`/api/v1/issues/${issueId}/resume`, { method: 'POST' });
      await fetchState();
      await fetchAvailable();
    } finally {
      setLoadingAction(null);
    }
  };

  const remove = async (issueId: string, identifier: string) => {
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

  const sync = async () => {
    setSyncLoading(true);
    try {
      await fetchAvailable();
      setNewIssueCount(0);
    } finally {
      setSyncLoading(false);
    }
  };

  // Returns an error message on failure, or null on success.
  const addIssue = async (form: AddIssueFormState): Promise<string | null> => {
    if (!form.title.trim()) {
      return 'Title is required';
    }
    setLoadingAction('add-issue');
    try {
      const res = await fetch('/api/v1/manual-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          priority: form.priority ? parseInt(form.priority) : undefined,
          labels: form.labels
            ? form.labels.split(',').map((l) => l.trim()).filter(Boolean)
            : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        return json.error?.message ?? 'Failed to add issue';
      }
      await fetchAvailable();
      return null;
    } finally {
      setLoadingAction(null);
    }
  };

  const dismissDone = (issueId: string) => {
    setDoneItems((prev) => prev.filter((d) => d.issue_id !== issueId));
  };

  // ---- Unified issue normalization (so swim lanes/cards see one shape) ----

  const unifiedIssues: UnifiedIssue[] = useMemo(() => {
    const out: UnifiedIssue[] = [];
    const activeIds = new Set<string>([
      ...(data?.running.map((r) => r.issue_id) ?? []),
      ...(data?.retrying.map((r) => r.issue_id) ?? []),
      ...(data?.canceled?.map((c) => c.issue_id) ?? []),
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
      for (const c of data.canceled ?? []) {
        out.push({
          id: c.issue_id,
          identifier: c.issue_identifier,
          title: titleCacheRef.current.get(c.issue_id) ?? c.issue_identifier,
          state: 'canceled',
          priority: null,
          labels: [],
          attempt: c.attempt,
          seconds: 0,
          tokens: c.tokens.total_tokens,
          status: 'Canceled',
          lastMsg: c.last_message,
          dueAtMs: null,
          error: null,
          finishedAt: c.canceled_at,
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

  return {
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
  };
}
