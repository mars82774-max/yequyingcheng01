export function latestRetryDelaysFromEnv(env = process.env) {
  return String(env.LATEST_RETRY_DELAYS_MS || "15000,60000")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

export function sourceHealth(crawlState, source, mode, at) {
  const previous = crawlState.sourceHealth[source.key] || {};
  const legacyHealth = isFlatHealth(previous) ? previous : null;
  if (legacyHealth) crawlState.sourceHealth[source.key] = {};
  crawlState.sourceHealth[source.key] = crawlState.sourceHealth[source.key] || {};
  const bucket = crawlState.sourceHealth[source.key];
  bucket.latest = normalizeHealth(bucket.latest || (mode === "latest" && legacyHealth ? legacyHealth : {}));
  bucket.backfill = normalizeHealth(bucket.backfill || (mode === "backfill" && legacyHealth ? legacyHealth : {}));
  const health = bucket[mode];
  if (mode === "latest" && legacyHealth && shouldClearLegacyLatestCooldown(health)) {
    health.blockedUntil = null;
    health.consecutiveFailures = 0;
    health.lastError = null;
    health._changed = true;
  }
  if (health.blockedUntil && Date.parse(health.blockedUntil) <= at.getTime()) {
    health.blockedUntil = null;
    health.consecutiveFailures = 0;
    health.lastError = null;
    health._changed = true;
  }
  return health;
}

export function sourceSkipReason(source, health, at) {
  if (!source.enabled) return "disabled";
  if (health.blockedUntil && Date.parse(health.blockedUntil) > at.getTime()) return "source_paused";
  return "";
}

export function recordSourceSuccess(health, at) {
  const changed = Boolean(health.consecutiveFailures || health.lastError || health.blockedUntil || !health.lastSuccessAt || health.lastHttpStatus !== 200);
  health.lastSuccessAt = at.toISOString();
  health.consecutiveFailures = 0;
  health.lastHttpStatus = 200;
  health.lastError = null;
  health.blockedUntil = null;
  return changed;
}

export function recordSourceFailure(health, error, at, options = {}) {
  const mode = options.mode || "backfill";
  const failurePauseThreshold = Number(options.failurePauseThreshold || 3);
  const blockedPauseHours = Number(options.blockedPauseHours || 24);
  health.lastFailureAt = at.toISOString();
  health.consecutiveFailures = Number(health.consecutiveFailures || 0) + 1;
  health.lastHttpStatus = Number(error.httpStatus || 0);
  health.lastError = String(error.message || error).slice(0, 500);
  const cooldownMs = cooldownMsForFailure(error, mode);
  if (cooldownMs > 0) {
    health.blockedUntil = new Date(at.getTime() + cooldownMs).toISOString();
    return { blocked: true, cooldownMs, reason: "explicit_cooldown" };
  }
  if (mode !== "latest" && health.consecutiveFailures >= failurePauseThreshold) {
    const cooldown = blockedPauseHours * 60 * 60 * 1000;
    health.blockedUntil = new Date(at.getTime() + cooldown).toISOString();
    return { blocked: true, cooldownMs: cooldown, reason: "failure_threshold" };
  }
  health.blockedUntil = null;
  return { blocked: false, cooldownMs: 0, reason: "no_cooldown" };
}

export async function crawlLatestWithRetry(source, ctx, options = {}) {
  const retryDelaysMs = Array.isArray(options.retryDelaysMs) ? options.retryDelaysMs : latestRetryDelaysFromEnv();
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = options.log || (() => {});
  const maxAttempts = retryDelaysMs.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      log(`[source:${source.sourceName}] latestAttempt=${attempt}/${maxAttempts}`);
      return await source.crawlLatest(ctx);
    } catch (error) {
      if (!isLatestRetryableNetworkError(error) || attempt >= maxAttempts) throw error;
      const delayMs = retryDelaysMs[attempt - 1] || 0;
      log(`[source:${source.sourceName}] retry reason=${error.failureKind || error.errorCode || error.message} nextAttempt=${attempt + 1} waitMs=${delayMs}`);
      await sleep(delayMs);
    }
  }
  throw new Error("unreachable latest retry state");
}

export function isLatestRetryableNetworkError(error) {
  return ["timeout", "connect_timeout", "headers_timeout", "connection_reset"].includes(error.failureKind)
    || ["ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(error.errorCode);
}

export function cooldownMsForFailure(error, mode) {
  if (mode !== "latest") return 0;
  if (error.httpStatus === 429) {
    const retryAfterMs = Number(error.retryAfterSeconds || 0) * 1000;
    return retryAfterMs > 0 ? Math.min(retryAfterMs, 4 * 60 * 60 * 1000) : 4 * 60 * 60 * 1000;
  }
  if (error.httpStatus === 403 && error.challenge) return 12 * 60 * 60 * 1000;
  if (Number(error.httpStatus || 0) >= 500) return 60 * 60 * 1000;
  return 0;
}

export function latestRunOutcome({ completedSourceCount, newCount }) {
  if (Number(completedSourceCount || 0) <= 0) {
    return {
      ok: false,
      message: "No source request was completed",
      printNoNewLatest: false
    };
  }
  return {
    ok: true,
    message: Number(newCount || 0) === 0 ? "No new latest videos" : "",
    printNoNewLatest: Number(newCount || 0) === 0
  };
}

function normalizeHealth(value = {}) {
  return {
    lastSuccessAt: "",
    lastFailureAt: "",
    consecutiveFailures: 0,
    lastHttpStatus: 0,
    lastError: null,
    blockedUntil: null,
    ...value
  };
}

function isFlatHealth(value) {
  return value && !value.latest && !value.backfill && (
    Object.hasOwn(value, "lastSuccessAt")
    || Object.hasOwn(value, "lastFailureAt")
    || Object.hasOwn(value, "consecutiveFailures")
    || Object.hasOwn(value, "blockedUntil")
  );
}

function shouldClearLegacyLatestCooldown(health) {
  const status = Number(health.lastHttpStatus || 0);
  const error = String(health.lastError || "").toLowerCase();
  return Boolean(health.blockedUntil)
    && status === 0
    && (error.includes("timeout") || error.includes("fetch failed") || error.includes("aborted"));
}
