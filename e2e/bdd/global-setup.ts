const L3_PORT = 27016;
const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

export default async function globalSetup() {
  const liveUrl = `http://localhost:${L3_PORT}/api/live`;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(liveUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log(`L3 server ready (${Date.now() - start}ms)`);
        return;
      }
    } catch {
      // Server not up yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Server did not start within ${MAX_WAIT_MS}ms`);
}
