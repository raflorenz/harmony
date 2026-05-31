// ---------------------------------------------------------------------------
// Add-issue form
// ---------------------------------------------------------------------------

import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import { iconButtonStyle } from './styles';
import type { AddIssueFormState } from './types';

export function AddIssueForm({
  form,
  setForm,
  onSubmit,
  loading,
  error,
  onClose,
}: {
  form: AddIssueFormState;
  setForm: (f: AddIssueFormState) => void;
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
