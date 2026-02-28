/**
 * GET /api/jobs/events
 *
 * Server-Sent Events endpoint for real-time job status updates.
 *
 * Clients connect via EventSource. When the JobManager detects a status
 * change on any active job, the event is broadcast to all connected
 * clients through the job-event-hub.
 *
 * Event format:
 *   event: job-update
 *   data: {"jobId":"...","recordingId":"...","status":"SUCCEEDED","previousStatus":"RUNNING"}
 *
 * Auth: uses cookie-based NextAuth session (EventSource cannot send headers).
 * In E2E mode (PLAYWRIGHT=1), auth is bypassed.
 *
 * Also initializes the JobManager singleton on first connection, ensuring
 * server-side polling is running.
 */

import { getCurrentUser } from "@/lib/api-auth";
import { getJobManager } from "@/services/job-manager-singleton";
import { addClient } from "@/services/job-event-hub";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Ensure the JobManager is running (lazy start on first SSE connect)
  getJobManager();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const { remove } = addClient(controller);

      // Send initial connected event
      const connectMsg = `event: connected\ndata: {}\n\n`;
      controller.enqueue(new TextEncoder().encode(connectMsg));

      // Heartbeat every 30s to keep connection alive through proxies
      const heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(`: heartbeat\n\n`));
        } catch {
          // Client gone — cleanup will happen in cancel()
          clearInterval(heartbeatTimer);
        }
      }, 30_000);

      cleanup = () => {
        clearInterval(heartbeatTimer);
        remove();
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
