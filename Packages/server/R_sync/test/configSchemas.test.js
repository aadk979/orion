import { describe, it } from "node:test";
import assert from "node:assert";
import {
  validateConfig,
  OrchestratorConfigSchema,
  WorkerConfigSchema,
} from "../lib/utils/configSchemas.js";

describe("configSchemas", () => {
  it("applies orchestrator trustAdvertisedWorkerIp default false", () => {
    const v = validateConfig(
      { role: "ORCHESTRATOR", cluster: "c1" },
      OrchestratorConfigSchema,
    );
    assert.strictEqual(v.trustAdvertisedWorkerIp, false);
  });

  it("accepts orchestrator trustAdvertisedWorkerIp true", () => {
    const v = validateConfig(
      {
        role: "ORCHESTRATOR",
        cluster: "c1",
        trustAdvertisedWorkerIp: true,
      },
      OrchestratorConfigSchema,
    );
    assert.strictEqual(v.trustAdvertisedWorkerIp, true);
  });

  it("rejects invalid role", () => {
    assert.throws(
      () =>
        validateConfig({ role: "BOT", cluster: "c" }, OrchestratorConfigSchema),
      /Configuration validation failed/,
    );
  });

  it("validates worker heartbeat minimum", () => {
    assert.throws(
      () =>
        validateConfig(
          {
            role: "WORKER",
            cluster: "c",
            heartbeatIntervalMs: 500,
          },
          WorkerConfigSchema,
        ),
      /heartbeatIntervalMs/,
    );
  });
});
