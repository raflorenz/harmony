// ---------------------------------------------------------------------------
// Settings drawer (slide-in sidebar) + backdrop
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { iconButtonStyle, sectionLabelStyle } from './styles';

export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 40,
          }}
        />
      )}
      <aside
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 280,
          height: '100vh',
          borderRight: '1px solid var(--k-border)',
          background: 'var(--k-bg-panel)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.2s ease',
          zIndex: 50,
        }}
      >
        <div
          style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}
          className="scroll-kanban"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'oklch(0.72 0.16 55)',
                boxShadow: '0 0 10px oklch(0.72 0.16 55 / 0.7)',
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-jetbrains-mono), monospace',
                fontWeight: 700,
                letterSpacing: '0.02em',
                fontSize: 13,
                color: 'var(--k-fg)',
                flex: 1,
              }}
            >
              SYMPHONY
            </span>
            <button
              onClick={onClose}
              title="Close sidebar"
              style={iconButtonStyle}
            >
              <Icon name="x" size={13} />
            </button>
          </div>

          <div style={sectionLabelStyle}>Settings</div>

          <SettingsGroup title="Tracker">
            <SettingRow label="kind" value="github" />
            <SettingRow label="api_key" value="$GITHUB_TOKEN" />
            <SettingRow label="project_slug" value="raflorenz/harmony" />
            <SettingRow label="active_states" value="Todo, In Progress" />
            <SettingRow
              label="terminal_states"
              value="Done, Closed, Cancelled, Canceled, Duplicate"
            />
          </SettingsGroup>

          <SettingsGroup title="Polling">
            <SettingRow label="interval_ms" value="30000" />
          </SettingsGroup>

          <SettingsGroup title="Workspace">
            <SettingRow label="root" value="~/harmony_workspaces" />
          </SettingsGroup>

          <SettingsGroup title="Hooks">
            <SettingRow label="after_create" value='echo "Workspace created"' />
            <SettingRow label="before_run" value='echo "Starting agent run"' />
            <SettingRow label="after_run" value='echo "Agent run finished"' />
            <SettingRow label="timeout_ms" value="60000" />
          </SettingsGroup>

          <SettingsGroup title="Agent">
            <SettingRow label="max_concurrent_agents" value="3" />
            <SettingRow label="max_turns" value="20" />
            <SettingRow label="max_retry_backoff_ms" value="300000" />
          </SettingsGroup>

          <SettingsGroup title="Claude">
            <SettingRow label="enabled" value="true" />
            <SettingRow label="runtime_timeout_ms" value="300000" />
            <SettingRow label="max_turns" value="20" />
            <SettingRow label="model" value="claude-sonnet-4-6" />
          </SettingsGroup>

          <SettingsGroup title="Codex">
            <SettingRow label="command" value="codex app-server" />
            <SettingRow label="approval_policy" value="auto-edit" />
            <SettingRow label="turn_timeout_ms" value="3600000" />
            <SettingRow label="stall_timeout_ms" value="300000" />
          </SettingsGroup>

          <SettingsGroup title="Server">
            <SettingRow label="port" value="3000" />
          </SettingsGroup>

          <div
            style={{
              marginTop: 'auto',
              paddingTop: 10,
              borderTop: '1px solid var(--k-border)',
              fontSize: 11,
              color: 'var(--k-fg-dim)',
              fontFamily: 'var(--font-jetbrains-mono), monospace',
            }}
          >
            project harmony
          </div>
        </div>
      </aside>
    </>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--k-border)',
        borderRadius: 8,
        background: 'var(--k-surface-1)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--k-border)',
          fontFamily: 'var(--font-jetbrains-mono), monospace',
          fontSize: 10,
          color: 'var(--k-fg-muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 10px',
        fontFamily: 'var(--font-jetbrains-mono), monospace',
        fontSize: 11,
        borderTop: '1px solid var(--k-border)',
      }}
    >
      <span style={{ color: 'var(--k-fg-dim)', flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: 'var(--k-fg)',
          textAlign: 'right',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </span>
    </div>
  );
}
