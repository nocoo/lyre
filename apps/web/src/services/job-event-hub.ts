/**
 * Job Event Hub — server-side SSE connection manager.
 *
 * Holds a set of SSE client controllers. When a JobEvent arrives,
 * broadcasts it to all connected clients as an SSE message.
 *
 * Designed as a simple singleton (module-level). The JobManager
 * singleton registers itself as a listener on startup.
 */

import type { JobEvent } from "./job-manager";

// ── Types ──

/** A connected SSE client. */
interface SseClient {
  id: string;
  controller: ReadableStreamDefaultController;
}

// ── Implementation ──

const clients = new Set<SseClient>();
let clientCounter = 0;

/**
 * Register a new SSE client. Returns the client id and a cleanup function.
 */
export function addClient(controller: ReadableStreamDefaultController): {
  id: string;
  remove: () => void;
} {
  const id = `sse-${++clientCounter}`;
  const client: SseClient = { id, controller };
  clients.add(client);

  return {
    id,
    remove: () => {
      clients.delete(client);
    },
  };
}

/**
 * Broadcast a JobEvent to all connected SSE clients.
 */
export function broadcast(event: JobEvent): void {
  const data = JSON.stringify(event);
  const message = `event: job-update\ndata: ${data}\n\n`;

  for (const client of clients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(message));
    } catch {
      // Client disconnected — remove silently
      clients.delete(client);
    }
  }
}

/**
 * Send a heartbeat comment to all connected clients.
 * Keeps connections alive through proxies/load balancers.
 */
export function heartbeat(): void {
  const message = `: heartbeat\n\n`;

  for (const client of clients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(message));
    } catch {
      clients.delete(client);
    }
  }
}

/** Get the current number of connected clients (for monitoring/tests). */
export function clientCount(): number {
  return clients.size;
}

/** Remove all clients (for testing). */
export function resetHub(): void {
  clients.clear();
  clientCounter = 0;
}
