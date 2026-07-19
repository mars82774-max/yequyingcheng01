import test from "node:test";
import assert from "node:assert/strict";
import { SourceStopError } from "../scripts/video-sources/source-errors.mjs";
import { createJavAdapter } from "../scripts/video-sources/j-av.mjs";
import {
  crawlLatestWithRetry,
  latestRunOutcome,
  recordSourceFailure,
  recordSourceSuccess,
  sourceHealth,
  sourceSkipReason
} from "../scripts/video-crawl-policy.mjs";

const source = { key: "jAv", sourceName: "j-av", enabled: true };

test("blockedUntil not expired pauses source without a request", () => {
  const now = new Date("2026-07-20T00:00:00.000Z");
  const state = {
    sourceHealth: {
      jAv: {
        latest: {
          consecutiveFailures: 3,
          blockedUntil: "2026-07-20T01:00:00.000Z",
          lastError: "previous timeout"
        }
      }
    }
  };

  const health = sourceHealth(state, source, "latest", now);

  assert.equal(sourceSkipReason(source, health, now), "source_paused");
  assert.equal(health.blockedUntil, "2026-07-20T01:00:00.000Z");
});

test("expired blockedUntil clears latest health and allows request", () => {
  const now = new Date("2026-07-20T02:00:00.000Z");
  const state = {
    sourceHealth: {
      jAv: {
        latest: {
          consecutiveFailures: 3,
          blockedUntil: "2026-07-20T01:00:00.000Z",
          lastError: "previous timeout"
        }
      }
    }
  };

  const health = sourceHealth(state, source, "latest", now);

  assert.equal(sourceSkipReason(source, health, now), "");
  assert.equal(health.blockedUntil, null);
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastError, null);
});

test("latest and backfill source health are isolated", () => {
  const now = new Date("2026-07-20T00:00:00.000Z");
  const state = {
    sourceHealth: {
      jAv: {
        backfill: {
          consecutiveFailures: 3,
          blockedUntil: "2026-07-21T00:00:00.000Z",
          lastError: "backfill failed"
        }
      }
    }
  };

  const latestHealth = sourceHealth(state, source, "latest", now);
  const backfillHealth = sourceHealth(state, source, "backfill", now);

  assert.equal(sourceSkipReason(source, latestHealth, now), "");
  assert.equal(sourceSkipReason(source, backfillHealth, now), "source_paused");
});

test("legacy timeout cooldown is not carried into latest after health split", () => {
  const now = new Date("2026-07-20T00:00:00.000Z");
  const state = {
    sourceHealth: {
      jAv: {
        consecutiveFailures: 3,
        lastHttpStatus: 0,
        lastError: "Source request failed: The operation was aborted due to timeout",
        blockedUntil: "2026-07-21T00:00:00.000Z"
      }
    }
  };

  const latestHealth = sourceHealth(state, source, "latest", now);

  assert.equal(sourceSkipReason(source, latestHealth, now), "");
  assert.equal(latestHealth.blockedUntil, null);
  assert.equal(latestHealth.consecutiveFailures, 0);
  assert.ok(state.sourceHealth.jAv.latest);
  assert.ok(state.sourceHealth.jAv.backfill);
});

test("HTTP 429 latest failure gets bounded cooldown", () => {
  const health = {};
  const failure = new SourceStopError("Fetch failed 429", {
    httpStatus: 429,
    retryAfterSeconds: 999999
  });

  recordSourceFailure(health, failure, new Date("2026-07-20T00:00:00.000Z"), { mode: "latest" });

  assert.equal(health.blockedUntil, "2026-07-20T04:00:00.000Z");
});

test("paused or failed latest run does not report no new latest videos", () => {
  const outcome = latestRunOutcome({ completedSourceCount: 0, newCount: 0 });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.printNoNewLatest, false);
  assert.notEqual(outcome.message, "No new latest videos");
});

test("successful latest run with zero new items reports no new latest videos", () => {
  const outcome = latestRunOutcome({ completedSourceCount: 1, newCount: 0 });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.printNoNewLatest, true);
  assert.equal(outcome.message, "No new latest videos");
});

test("timeout after first attempt retries and succeeds on second attempt", async () => {
  let attempts = 0;
  const fakeSource = {
    sourceName: "j-av",
    async crawlLatest() {
      attempts += 1;
      if (attempts === 1) {
        throw new SourceStopError("Source request failed: timeout", {
          failureKind: "timeout",
          httpStatus: 0,
          retryable: true
        });
      }
      return { sourceName: "j-av", items: [], sourceItems: [], pagesDone: 1, fetchedCount: 0 };
    }
  };
  const sleeps = [];

  const result = await crawlLatestWithRetry(fakeSource, {}, {
    retryDelaysMs: [15, 60],
    sleep: async (ms) => sleeps.push(ms)
  });

  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [15]);
  assert.equal(result.pagesDone, 1);
});

test("three latest timeouts fail without setting cross-day cooldown", async () => {
  let attempts = 0;
  const fakeSource = {
    sourceName: "j-av",
    async crawlLatest() {
      attempts += 1;
      throw new SourceStopError("Source request failed: timeout", {
        failureKind: "timeout",
        httpStatus: 0,
        retryable: true
      });
    }
  };

  await assert.rejects(
    () => crawlLatestWithRetry(fakeSource, {}, {
      retryDelaysMs: [15, 60],
      sleep: async () => {}
    }),
    /timeout/
  );

  const health = { consecutiveFailures: 2, blockedUntil: "2026-07-20T01:00:00.000Z" };
  recordSourceFailure(health, new SourceStopError("timeout", { failureKind: "timeout", httpStatus: 0 }), new Date("2026-07-20T00:00:00.000Z"), {
    mode: "latest"
  });

  assert.equal(attempts, 3);
  assert.equal(health.consecutiveFailures, 3);
  assert.equal(health.blockedUntil, null);
});

test("successful latest fetch with zero new items clears health and records HTTP 200", () => {
  const health = {
    consecutiveFailures: 2,
    blockedUntil: "2026-07-20T01:00:00.000Z",
    lastError: "old failure",
    lastHttpStatus: 0
  };

  recordSourceSuccess(health, new Date("2026-07-20T00:00:00.000Z"));

  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.blockedUntil, null);
  assert.equal(health.lastError, null);
  assert.equal(health.lastHttpStatus, 200);
});

test("latest default scan depth covers a multi-day catch-up window", () => {
  const adapter = createJavAdapter();
  const context = adapter.createContext({});

  assert.ok(context.maxLatestPages >= 10);
});
