/**
 * Client-side error logger — posts to /api/log-error which saves to Supabase error_logs.
 * Fire-and-forget: never throws, never blocks the UI.
 */
export async function logClientError(
  errorType: string,
  message: string,
  stack?: string,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    await fetch("/api/log-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ errorType, message, stack, context }),
    });
  } catch {
    // Swallow — logging should never crash the app
  }
}
