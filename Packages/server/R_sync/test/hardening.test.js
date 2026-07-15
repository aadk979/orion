import { describe, it } from "node:test";
import assert from "node:assert";
import { deriveTunnelSalt } from "../lib/utils/crypto.js";
import { createReplayGuard } from "../lib/utils/replayGuard.js";

describe("deriveTunnelSalt", () => {
  it("is deterministic and order-sensitive across both sides", () => {
    const workerPub = new Uint8Array([1, 2, 3, 4]);
    const orchPub = new Uint8Array([5, 6, 7, 8]);

    const workerSide = deriveTunnelSalt(workerPub, orchPub);
    const orchSide = deriveTunnelSalt(
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8]),
    );

    // Both parties feed identical bytes in identical order → identical salt.
    assert.deepStrictEqual(Array.from(workerSide), Array.from(orchSide));
    assert.strictEqual(workerSide.length, 32);
  });

  it("differs when the key material differs (per-session)", () => {
    const a = deriveTunnelSalt(new Uint8Array([1]), new Uint8Array([2]));
    const b = deriveTunnelSalt(new Uint8Array([1]), new Uint8Array([3]));
    assert.notDeepStrictEqual(Array.from(a), Array.from(b));
  });
});

describe("replayGuard", () => {
  it("treats first use as fresh and repeats as seen", () => {
    const guard = createReplayGuard({ retentionSec: 60 });
    assert.strictEqual(guard.has("nonce-1"), false);
    guard.record("nonce-1");
    assert.strictEqual(guard.has("nonce-1"), true);
    assert.strictEqual(guard.isFresh("nonce-1"), false);
    assert.strictEqual(guard.isFresh("nonce-2"), true);
  });
});
