// ---------------------------------------------------------------------------
// In-memory proposal store
// ---------------------------------------------------------------------------
//
// Holds open proposals between submission and approval. Persistence across
// process restarts is out of scope for v1 — proposals are short-lived.
// ---------------------------------------------------------------------------

import type { DecompositionProposal } from './types';

const GLOBAL_KEY = '__symphony_proposal_store__';

interface Store {
  byId: Map<string, DecompositionProposal>;
}

function getStore(): Store {
  const g = globalThis as Record<string, unknown>;
  let store = g[GLOBAL_KEY] as Store | undefined;
  if (!store) {
    store = { byId: new Map() };
    g[GLOBAL_KEY] = store;
  }
  return store;
}

export function saveProposal(p: DecompositionProposal): void {
  getStore().byId.set(p.proposalId, p);
}

export function getProposal(id: string): DecompositionProposal | undefined {
  return getStore().byId.get(id);
}

export function listProposals(): DecompositionProposal[] {
  return Array.from(getStore().byId.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function updateProposal(
  id: string,
  patch: Partial<DecompositionProposal>,
): DecompositionProposal | undefined {
  const existing = getProposal(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };
  saveProposal(updated);
  return updated;
}

export function deleteProposal(id: string): boolean {
  return getStore().byId.delete(id);
}
