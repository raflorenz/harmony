// ---------------------------------------------------------------------------
// Workspace Manager (Spec Sections 9.1–9.5)
// ---------------------------------------------------------------------------

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../observability/logger';
import { runHook } from './hooks';
import type { WorkspaceManager as IWorkspaceManager } from '../orchestrator/scheduler';
import type { HooksConfig } from '../tracker/types';

/**
 * Sanitize an issue identifier for use as a workspace directory name.
 * Only [A-Za-z0-9._-] allowed; all other characters become '_'.
 * (Spec Section 4.2)
 */
export function sanitizeWorkspaceKey(identifier: string): string {
  return identifier.replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Validate that a workspace path is safely contained within the workspace root.
 * (Spec Section 9.5 - Safety Invariant 2)
 */
function validatePathContainment(
  workspacePath: string,
  workspaceRoot: string,
): void {
  const normalizedWs = path.resolve(workspacePath);
  const normalizedRoot = path.resolve(workspaceRoot);

  if (!normalizedWs.startsWith(normalizedRoot + path.sep) && normalizedWs !== normalizedRoot) {
    throw new Error(
      `Workspace path "${normalizedWs}" is outside workspace root "${normalizedRoot}"`,
    );
  }
}

export class WorkspaceManagerImpl implements IWorkspaceManager {
  private readonly root: string;
  private readonly hooks: HooksConfig;

  constructor(root: string, hooks: HooksConfig) {
    this.root = path.resolve(root);
    this.hooks = hooks;
  }

  /**
   * Create or reuse a workspace for the given issue identifier.
   * (Spec Section 9.2)
   */
  async createForIssue(
    identifier: string,
  ): Promise<{ path: string; workspaceKey: string; createdNow: boolean }> {
    const workspaceKey = sanitizeWorkspaceKey(identifier);
    const workspacePath = path.join(this.root, workspaceKey);

    // Safety: validate containment
    validatePathContainment(workspacePath, this.root);

    // Ensure root exists
    await fs.mkdir(this.root, { recursive: true });

    // Check if workspace already exists
    let createdNow = false;
    try {
      const stat = await fs.stat(workspacePath);
      if (!stat.isDirectory()) {
        // Non-directory at workspace location — remove and recreate
        await fs.rm(workspacePath, { force: true });
        await fs.mkdir(workspacePath, { recursive: true });
        createdNow = true;
      }
    } catch {
      // Directory doesn't exist — create it
      await fs.mkdir(workspacePath, { recursive: true });
      createdNow = true;
    }

    // Run after_create hook only on new creation (Section 9.4)
    if (createdNow) {
      try {
        await runHook(
          'after_create',
          this.hooks.afterCreate,
          workspacePath,
          this.hooks.timeoutMs,
          true, // Fatal: failure aborts workspace creation
        );
      } catch (err) {
        // Clean up the partially created workspace
        try {
          await fs.rm(workspacePath, { recursive: true, force: true });
        } catch {
          // Best effort cleanup
        }
        throw err;
      }
    }

    logger.debug('Workspace prepared', {
      workspace_key: workspaceKey,
      workspace_path: workspacePath,
      created_now: createdNow,
    });

    return { path: workspacePath, workspaceKey, createdNow };
  }

  /**
   * Remove a workspace for the given identifier.
   * Runs before_remove hook before deletion.
   */
  async removeWorkspace(identifier: string): Promise<void> {
    const workspaceKey = sanitizeWorkspaceKey(identifier);
    const workspacePath = path.join(this.root, workspaceKey);

    // Safety: validate containment
    validatePathContainment(workspacePath, this.root);

    // Check if workspace exists
    try {
      await fs.stat(workspacePath);
    } catch {
      // Workspace doesn't exist — nothing to do
      return;
    }

    // Run before_remove hook (non-fatal)
    await runHook(
      'before_remove',
      this.hooks.beforeRemove,
      workspacePath,
      this.hooks.timeoutMs,
      false, // Non-fatal: failure logged but cleanup proceeds
    );

    // Remove directory
    await fs.rm(workspacePath, { recursive: true, force: true });

    logger.debug('Workspace removed', {
      workspace_key: workspaceKey,
      workspace_path: workspacePath,
    });
  }
}
