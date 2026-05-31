// ---------------------------------------------------------------------------
// Types (API contracts — preserved verbatim from prior dashboard)
// ---------------------------------------------------------------------------

export interface RunningRow {
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

export interface RetryRow {
  issue_id: string;
  issue_identifier: string;
  attempt: number;
  due_at: string;
  error: string | null;
}

export interface CanceledRow {
  issue_id: string;
  issue_identifier: string;
  attempt: number;
  canceled_at: string;
  tokens: { input_tokens: number; output_tokens: number; total_tokens: number };
  turn_count: number;
  last_message: string | null;
  recent_messages: string[];
}

export interface StateResponse {
  mock_mode?: boolean;
  auto_dispatch?: boolean;
  generated_at: string;
  counts: { running: number; retrying: number; canceled?: number };
  running: RunningRow[];
  retrying: RetryRow[];
  canceled?: CanceledRow[];
  codex_totals: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    seconds_running: number;
  };
  rate_limits: Record<string, unknown> | null;
  error?: { code: string; message: string };
}

export interface AvailableIssue {
  id: string;
  identifier: string;
  title: string;
  state: string;
  priority: number | null;
  labels: string[];
  url: string | null;
  created_at: string | null;
}

export interface DoneItem {
  issue_id: string;
  issue_identifier: string;
  title?: string;
  finished_at: string;
}

export type LaneState = 'todo' | 'running' | 'retrying' | 'canceled' | 'done';

export interface UnifiedIssue {
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

export interface AddIssueFormState {
  title: string;
  description: string;
  priority: string;
  labels: string;
}

export type KanbanColumn = string;

export interface BoardColumn {
  key: KanbanColumn;
  label: string;
  accent: string;
  laneKey?: LaneState;
  builtin?: boolean;
}

export const DEFAULT_BOARD_COLUMNS: BoardColumn[] = [
  { key: 'todo', laneKey: 'todo', label: 'To do', accent: '#7e8a95', builtin: true },
  { key: 'in-progress', laneKey: 'running', label: 'Running', accent: '#6bd69c', builtin: true },
  { key: 'review', laneKey: 'retrying', label: 'Retrying', accent: '#f5c050', builtin: true },
  { key: 'canceled', laneKey: 'canceled', label: 'Canceled', accent: '#ee9b60', builtin: true },
  { key: 'done', laneKey: 'done', label: 'Done', accent: '#7dd3a1', builtin: true },
];

export const BOARD_COLUMNS_STORAGE_KEY = 'harmony:boardColumns:v2';
export const COLUMN_ACCENT_PALETTE = ['#9bb7ff', '#c89bff', '#f59bb7', '#9be8ff', '#ffc89b', '#b7f59b'];
export const COLUMN_DRAG_MIME = 'application/x-harmony-column';
