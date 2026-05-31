// ---------------------------------------------------------------------------
// Shared style helpers
// ---------------------------------------------------------------------------

import type { CSSProperties } from 'react';

export const sectionLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-jetbrains-mono), monospace',
  fontSize: 10,
  color: 'var(--k-fg-dim)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

export const iconButtonStyle: CSSProperties = {
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

export function navIconButtonStyle(active: boolean): CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: active ? 'var(--k-surface-2)' : 'transparent',
    border: 0,
    color: active ? 'var(--k-fg)' : 'var(--k-fg-muted)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background .12s, color .12s',
  };
}

export function miniBtnStyle(color: string): CSSProperties {
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

export function primaryBtn(color: string): CSSProperties {
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
