// ---------------------------------------------------------------------------
// Next.js Instrumentation Hook (starts Symphony on server boot)
// ---------------------------------------------------------------------------
//
// This file is called once when the Next.js server starts. We use it to
// bootstrap the Symphony orchestrator as a long-running background service.
// ---------------------------------------------------------------------------

export async function register() {
  // Only run on the server (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startSymphony } = await import('./lib/symphony');

    try {
      await startSymphony();
    } catch (err) {
      // Log but don't crash the server — the dashboard should still be accessible
      // for debugging even if the orchestrator can't start
      console.error(
        '[Symphony] Failed to start orchestrator:',
        err instanceof Error ? err.message : String(err),
      );
      console.error(
        '[Symphony] The dashboard will be available but orchestration is disabled.',
      );
      console.error(
        '[Symphony] Fix WORKFLOW.md and the service will auto-reload.',
      );
    }
  }
}
