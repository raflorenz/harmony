// ---------------------------------------------------------------------------
// Narrow persistent nav sidebar
// ---------------------------------------------------------------------------

import { Icon } from './Icon';
import { navIconButtonStyle } from './styles';

export function NavSidebar({
  theme,
  onToggleTheme,
  onNewIssue,
  addingColumn,
  onToggleAddColumn,
  onOpenSettings,
}: {
  theme: string;
  onToggleTheme: () => void;
  onNewIssue: () => void;
  addingColumn: boolean;
  onToggleAddColumn: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <nav
      style={{
        gridColumn: '1',
        gridRow: '1 / span 2',
        borderRight: '1px solid var(--k-border)',
        background: 'var(--k-bg-panel)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 6,
        zIndex: 20,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'var(--k-surface-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: '-0.02em',
          color: 'var(--k-fg)',
          marginBottom: 6,
        }}
        title="Symphony"
      >
        sy
      </div>
      <button title="Kanban board" style={navIconButtonStyle(true)}>
        <Icon name="grid" size={15} />
      </button>
      <button onClick={onNewIssue} title="New issue" style={navIconButtonStyle(false)}>
        <Icon name="doc" size={15} />
      </button>
      <button
        onClick={onToggleAddColumn}
        title={addingColumn ? 'Cancel add column' : 'Add column'}
        style={navIconButtonStyle(addingColumn)}
      >
        <Icon name="columns" size={15} />
      </button>
      <div style={{ flex: 1 }} />
      <button
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        style={navIconButtonStyle(false)}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
      </button>
      <button onClick={onOpenSettings} title="Settings" style={navIconButtonStyle(false)}>
        <Icon name="settings" size={15} />
      </button>
    </nav>
  );
}
