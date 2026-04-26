import { describe, expect, test, beforeEach } from "bun:test";
import {
  addClient,
  broadcast,
  heartbeat,
  clientCount,
  resetHub,
} from "@/services/job-event-hub";
import type { JobEvent } from "@/services/job-manager";

// ── Helpers ──

/** Create a mock ReadableStreamDefaultController that captures enqueued data. */
function mockController(): {
  controller: ReadableStreamDefaultController;
  chunks: Uint8Array[];
  closed: boolean;
} {
  const chunks: Uint8Array[] = [];
  let closed = false;

  const controller = {
    enqueue(chunk: Uint8Array) {
      if (closed) throw new Error("Controller is closed");
      chunks.push(chunk);
    },
    close() {
      closed = true;
    },
    error() {
      closed = true;
    },
    get desiredSize() {
      return 1;
    },
  } as unknown as ReadableStreamDefaultController;

  return { controller, chunks, closed };
}

function decodeChunks(chunks: Uint8Array[]): string {
  return chunks.map((c) => new TextDecoder().decode(c)).join("");
}

const SAMPLE_EVENT: JobEvent = {
  jobId: "job-1",
  recordingId: "rec-1",
  status: "SUCCEEDED",
  previousStatus: "RUNNING",
};

// ── Tests ──

describe("job-event-hub", () => {
  beforeEach(() => {
    resetHub();
  });

  describe("addClient / clientCount", () => {
    test("adds a client and increments count", () => {
      const { controller } = mockController();
      expect(clientCount()).toBe(0);

      addClient(controller);
      expect(clientCount()).toBe(1);
    });

    test("remove() decrements count", () => {
      const { controller } = mockController();
      const { remove } = addClient(controller);

      expect(clientCount()).toBe(1);
      remove();
      expect(clientCount()).toBe(0);
    });

    test("remove() is idempotent", () => {
      const { controller } = mockController();
      const { remove } = addClient(controller);

      remove();
      remove();
      expect(clientCount()).toBe(0);
    });

    test("tracks multiple clients independently", () => {
      const c1 = mockController();
      const c2 = mockController();
      const c3 = mockController();

      const r1 = addClient(c1.controller);
      addClient(c2.controller);
      addClient(c3.controller);

      expect(clientCount()).toBe(3);

      r1.remove();
      expect(clientCount()).toBe(2);
    });
  });

  describe("broadcast", () => {
    test("sends SSE-formatted event to all clients", () => {
      const c1 = mockController();
      const c2 = mockController();
      addClient(c1.controller);
      addClient(c2.controller);

      broadcast(SAMPLE_EVENT);

      const expected = `event: job-update\ndata: ${JSON.stringify(SAMPLE_EVENT)}\n\n`;
      expect(decodeChunks(c1.chunks)).toBe(expected);
      expect(decodeChunks(c2.chunks)).toBe(expected);
    });

    test("removes dead clients on broadcast", () => {
      const alive = mockController();
      const dead = mockController();

      // Simulate a dead client by making enqueue throw
      dead.controller.enqueue = () => {
        throw new Error("Connection reset");
      };

      addClient(alive.controller);
      addClient(dead.controller);

      expect(clientCount()).toBe(2);
      broadcast(SAMPLE_EVENT);
      expect(clientCount()).toBe(1);

      // Alive client still receives
      expect(decodeChunks(alive.chunks)).toContain("job-update");
    });

    test("no-op when no clients connected", () => {
      // Should not throw
      broadcast(SAMPLE_EVENT);
      expect(clientCount()).toBe(0);
    });
  });

  describe("heartbeat", () => {
    test("sends comment line to all clients", () => {
      const c1 = mockController();
      addClient(c1.controller);

      heartbeat();

      const output = decodeChunks(c1.chunks);
      expect(output).toBe(`: heartbeat\n\n`);
    });

    test("removes dead clients on heartbeat", () => {
      const alive = mockController();
      const dead = mockController();

      dead.controller.enqueue = () => {
        throw new Error("Gone");
      };

      addClient(alive.controller);
      addClient(dead.controller);

      heartbeat();
      expect(clientCount()).toBe(1);
    });
  });

  describe("resetHub", () => {
    test("clears all clients", () => {
      const c1 = mockController();
      const c2 = mockController();
      addClient(c1.controller);
      addClient(c2.controller);

      expect(clientCount()).toBe(2);
      resetHub();
      expect(clientCount()).toBe(0);
    });
  });
});
