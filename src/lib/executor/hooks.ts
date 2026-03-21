// ---------------------------------------------------------------------------
// Workspace Hook Execution (Spec Section 9.4)
// ---------------------------------------------------------------------------

import { spawn } from 'child_process';
import { logger } from '../observability/logger';

/**
 * Execute a shell hook script in the given workspace directory.
 *
 * @param name       Hook name for logging (e.g. "after_create", "before_run")
 * @param script     The shell script body to execute
 * @param cwd        Working directory (workspace path)
 * @param timeoutMs  Max execution time before kill
 * @returns Resolves on success, rejects on failure/timeout
 */
export async function executeHook(
  name: string,
  script: string,
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  logger.debug(`Hook "${name}" starting`, { cwd });

  return new Promise<void>((resolve, reject) => {
    const child = spawn('bash', ['-lc', script], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      // Truncate to prevent memory issues
      if (stdout.length > 10_000) {
        stdout = stdout.slice(-5_000);
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 10_000) {
        stderr = stderr.slice(-5_000);
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      // Give 5s grace, then SIGKILL
      setTimeout(() => child.kill('SIGKILL'), 5_000);
      reject(new Error(`Hook "${name}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Hook "${name}" spawn error: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        logger.debug(`Hook "${name}" completed`, { cwd });
        resolve();
      } else {
        const truncatedStderr = stderr.slice(0, 500);
        reject(
          new Error(
            `Hook "${name}" failed with exit code ${code}: ${truncatedStderr}`,
          ),
        );
      }
    });
  });
}

/**
 * Run a hook if configured, with proper failure semantics.
 *
 * @param fatal If true, errors propagate. If false, errors are logged and ignored.
 */
export async function runHook(
  name: string,
  script: string | null,
  cwd: string,
  timeoutMs: number,
  fatal: boolean,
): Promise<void> {
  if (!script) return;

  try {
    await executeHook(name, script, cwd, timeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (fatal) {
      logger.error(`Fatal hook failure: ${name}`, { error: msg, cwd });
      throw err;
    } else {
      logger.warn(`Non-fatal hook failure: ${name}`, { error: msg, cwd });
    }
  }
}
