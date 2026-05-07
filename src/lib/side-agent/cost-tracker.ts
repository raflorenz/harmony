// ---------------------------------------------------------------------------
// Per-Ticket Cost Tracker
// ---------------------------------------------------------------------------
//
// Aggregates side-agent and execution-agent costs by ticket so the dashboard
// can answer "this ticket cost $X across N stages."
// ---------------------------------------------------------------------------

import type { SideAgentUsage } from './types';

export interface StageCost {
  stage: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  at: Date;
}

export interface TicketCostSummary {
  ticketId: string;
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  stages: StageCost[];
}

const GLOBAL_KEY = '__symphony_cost_tracker__' as const;

interface Store {
  byTicket: Map<string, StageCost[]>;
}

function getStore(): Store {
  const g = globalThis as Record<string, unknown>;
  let store = g[GLOBAL_KEY] as Store | undefined;
  if (!store) {
    store = { byTicket: new Map() };
    g[GLOBAL_KEY] = store;
  }
  return store;
}

/** Record a side-agent invocation against a ticket. No-op when ticketId missing. */
export function recordSideAgentCost(
  ticketId: string | undefined,
  stage: string,
  usage: SideAgentUsage,
): void {
  if (!ticketId) return;
  const store = getStore();
  const list = store.byTicket.get(ticketId) ?? [];
  list.push({
    stage,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    at: new Date(),
  });
  store.byTicket.set(ticketId, list);
}

/** Record arbitrary cost (e.g. execution-agent USD) against a ticket. */
export function recordTicketCost(
  ticketId: string,
  stage: string,
  costUsd: number,
  inputTokens = 0,
  outputTokens = 0,
): void {
  const store = getStore();
  const list = store.byTicket.get(ticketId) ?? [];
  list.push({ stage, costUsd, inputTokens, outputTokens, at: new Date() });
  store.byTicket.set(ticketId, list);
}

export function getTicketCost(ticketId: string): TicketCostSummary {
  const stages = getStore().byTicket.get(ticketId) ?? [];
  return {
    ticketId,
    stages,
    totalUsd: stages.reduce((s, x) => s + x.costUsd, 0),
    totalInputTokens: stages.reduce((s, x) => s + x.inputTokens, 0),
    totalOutputTokens: stages.reduce((s, x) => s + x.outputTokens, 0),
  };
}

export function getAllTicketCosts(): TicketCostSummary[] {
  return Array.from(getStore().byTicket.keys()).map((id) => getTicketCost(id));
}
