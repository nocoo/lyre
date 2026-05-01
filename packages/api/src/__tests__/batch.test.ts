import { describe, expect, test } from "vitest";
import { runBatch } from "../db/drivers/batch";

interface RunSpy {
  run: () => unknown;
  ran: boolean;
}

function spy(): RunSpy {
  const obj = { ran: false } as RunSpy;
  obj.run = () => {
    obj.ran = true;
    return { changes: 1 };
  };
  return obj;
}

describe("runBatch", () => {
  test("D1 path: forwards prepared statements to db.batch", async () => {
    let received: unknown[] | null = null;
    const db = {
      batch: async (stmts: unknown[]) => {
        received = stmts;
        return [];
      },
    };
    const a = spy();
    const b = spy();
    await runBatch(db, () => [a, b]);
    expect(received).toEqual([a, b]);
    // D1 path delegates execution to .batch — individual .run() not invoked.
    expect(a.ran).toBe(false);
    expect(b.ran).toBe(false);
  });

  test("sqlite path: invokes db.transaction(cb) and runs each stmt", async () => {
    let txCalls = 0;
    const db = {
      transaction: (cb: (tx: unknown) => unknown) => {
        txCalls++;
        return cb(db);
      },
    };
    const a = spy();
    const b = spy();
    await runBatch(db, () => [a, b]);
    expect(txCalls).toBe(1);
    expect(a.ran).toBe(true);
    expect(b.ran).toBe(true);
  });

  test("fallback: no batch/transaction → runs sequentially", async () => {
    const db = {};
    const a = spy();
    const b = spy();
    await runBatch(db, () => [a, b]);
    expect(a.ran).toBe(true);
    expect(b.ran).toBe(true);
  });
});
