// ---------------------------------------------------------------------------
// Next.js Instrumentation Hook (starts Harmony on server boot)
// ---------------------------------------------------------------------------
//
// This file is called once when the Next.js server starts. We use it to
// bootstrap the Harmony orchestrator as a long-running background service.
// ---------------------------------------------------------------------------

export async function register() {
  // Only run on the server (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startHarmony } = await import('./lib/harmony');

    try {
      await startHarmony();
    } catch (err) {
      // Log but don't crash the server — the dashboard should still be accessible
      // for debugging even if the orchestrator can't start
      console.error(
        '[Harmony] Failed to start orchestrator:',
        err instanceof Error ? err.message : String(err),
      );
      console.error(
        '[Harmony] The dashboard will be available but orchestration is disabled.',
      );
      console.error(
        '[Harmony] Fix WORKFLOW.md and the service will auto-reload.',
      );
    }
  }
}
