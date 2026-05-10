'use client';

import { useEffect, useState } from 'react';

interface ProposedTicket {
  tempId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  estimatedFiles: number;
  estimatedDiffLines: number;
  blockedByTempIds: string[];
  rationale: string;
}

interface DecompositionProposal {
  proposalId: string;
  featureDescription: string;
  featureSummary: string;
  feasibility: 'fits' | 'fits_with_caveats' | 'unclear' | 'no';
  feasibilityNotes: string;
  tickets: ProposedTicket[];
  totalEstimatedScope: { files: number; lines: number };
  warnings: string[];
  createdAt: string;
  status: 'proposed' | 'approved' | 'rejected';
}

export default function DecomposePage() {
  const [feature, setFeature] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<DecompositionProposal | null>(null);
  const [proposals, setProposals] = useState<DecompositionProposal[]>([]);

  const refresh = async () => {
    try {
      const r = await fetch('/api/v1/decompose');
      const data = await r.json();
      setProposals(Array.isArray(data.proposals) ? data.proposals : []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const submit = async () => {
    if (!feature.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setProposal(null);
    try {
      const r = await fetch('/api/v1/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error?.message ?? 'Decomposer failed');
      } else {
        setProposal(data.proposal);
        refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const approve = async (id: string) => {
    const r = await fetch(`/api/v1/decompose/${id}/approve`, { method: 'POST' });
    if (r.ok) {
      const data = await r.json();
      alert(`Created ${data.created.length} ticket(s)`);
      refresh();
      setProposal(null);
    } else {
      const data = await r.json();
      alert(`Approve failed: ${data.error?.message ?? r.status}`);
    }
  };

  const reject = async (id: string) => {
    const r = await fetch(`/api/v1/decompose/${id}/reject`, { method: 'POST' });
    if (r.ok) {
      refresh();
      setProposal(null);
    }
  };

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: 20, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Feature Decomposer</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Describe a feature; the decomposer proposes a DAG of PR-sized tickets
        for human approval. No execution agent picks anything up until you
        approve.
      </p>

      <textarea
        value={feature}
        onChange={(e) => setFeature(e.target.value)}
        placeholder="Describe the feature you want to build..."
        rows={6}
        style={{
          width: '100%',
          padding: 12,
          fontSize: 14,
          border: '1px solid #ccc',
          borderRadius: 6,
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
      <button
        onClick={submit}
        disabled={submitting || !feature.trim()}
        style={{
          marginTop: 12,
          padding: '10px 20px',
          fontSize: 14,
          background: submitting ? '#999' : '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          cursor: submitting ? 'wait' : 'pointer',
        }}
      >
        {submitting ? 'Decomposing…' : 'Submit'}
      </button>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: '#fee',
            border: '1px solid #fcc',
            borderRadius: 6,
            color: '#900',
          }}
        >
          {error}
        </div>
      )}

      {proposal && <ProposalView proposal={proposal} onApprove={approve} onReject={reject} />}

      <h2 style={{ marginTop: 40, fontSize: 20 }}>Recent proposals</h2>
      {proposals.length === 0 && <p style={{ color: '#999' }}>None yet.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {proposals.map((p) => (
          <li
            key={p.proposalId}
            style={{
              marginBottom: 12,
              padding: 12,
              border: '1px solid #ddd',
              borderRadius: 6,
              background: p.status === 'proposed' ? '#fff' : '#f5f5f5',
            }}
          >
            <div style={{ fontWeight: 600 }}>{p.featureSummary}</div>
            <div style={{ fontSize: 12, color: '#666' }}>
              {p.tickets.length} ticket(s) · {p.feasibility} · {p.status} ·{' '}
              {new Date(p.createdAt).toLocaleString()}
            </div>
            {p.status === 'proposed' && (
              <button
                onClick={() => setProposal(p)}
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  padding: '4px 8px',
                  background: '#eee',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                View
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

function ProposalView({
  proposal,
  onApprove,
  onReject,
}: {
  proposal: DecompositionProposal;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isFeasible = proposal.feasibility === 'fits' || proposal.feasibility === 'fits_with_caveats';
  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        border: '2px solid #0070f3',
        borderRadius: 8,
        background: '#f9fbff',
      }}
    >
      <h2 style={{ fontSize: 20, marginBottom: 4 }}>{proposal.featureSummary}</h2>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        Feasibility: <strong>{proposal.feasibility}</strong> · Status:{' '}
        <strong>{proposal.status}</strong> · Total scope: ~
        {proposal.totalEstimatedScope.files} files, ~
        {proposal.totalEstimatedScope.lines} lines
      </div>

      {proposal.feasibilityNotes && (
        <p style={{ fontSize: 14, marginBottom: 16, fontStyle: 'italic' }}>
          {proposal.feasibilityNotes}
        </p>
      )}

      {proposal.warnings.length > 0 && (
        <div
          style={{
            marginBottom: 16,
            padding: 10,
            background: '#fff8e1',
            border: '1px solid #ffd54f',
            borderRadius: 4,
          }}
        >
          <strong>Warnings:</strong>
          <ul style={{ margin: '4px 0 0 16px' }}>
            {proposal.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {proposal.tickets.length > 0 && (
        <>
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>
            Proposed tickets ({proposal.tickets.length})
          </h3>
          {proposal.tickets.map((t) => (
            <div
              key={t.tempId}
              style={{
                marginBottom: 12,
                padding: 12,
                border: '1px solid #ddd',
                borderRadius: 6,
                background: '#fff',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                <span style={{ color: '#999', fontSize: 12, marginRight: 8 }}>{t.tempId}</span>
                {t.title}
              </div>
              {t.blockedByTempIds.length > 0 && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  Blocked by: {t.blockedByTempIds.join(', ')}
                </div>
              )}
              <p style={{ marginTop: 6, fontSize: 13, color: '#444' }}>{t.description}</p>
              {t.acceptanceCriteria.length > 0 && (
                <ul style={{ margin: '6px 0 0 16px', fontSize: 13 }}>
                  {t.acceptanceCriteria.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
              <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                ~{t.estimatedFiles} files · ~{t.estimatedDiffLines} lines · {t.rationale}
              </div>
            </div>
          ))}
        </>
      )}

      {proposal.status === 'proposed' && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            onClick={() => onApprove(proposal.proposalId)}
            disabled={!isFeasible || proposal.tickets.length === 0}
            style={{
              padding: '8px 16px',
              background: '#0a8',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              opacity: !isFeasible || proposal.tickets.length === 0 ? 0.5 : 1,
            }}
          >
            Approve & create tickets
          </button>
          <button
            onClick={() => onReject(proposal.proposalId)}
            style={{
              padding: '8px 16px',
              background: '#fff',
              color: '#900',
              border: '1px solid #c00',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
