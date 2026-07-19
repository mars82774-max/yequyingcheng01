import { execFile } from "node:child_process";
import { createHash, constants as tlsConstants } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import { promisify } from "node:util";

const targetUrl = "https://j-av.com/video/index.php";
const hostname = new URL(targetUrl).hostname;
const tcpHttpTimeoutMs = 30000;
const curlConnectTimeoutSeconds = 10;
const curlTotalTimeoutSeconds = 30;
const productionTimeoutMs = 30000;
const comparisonTimeoutMs = 45000;
const retryDelayMs = 3000;
const execFileAsync = promisify(execFile);

const productionUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const safeHeaderNames = [
  "server",
  "content-type",
  "content-length",
  "location",
  "cf-ray",
  "cf-mitigated",
  "retry-after",
  "cache-control"
];

const diagnosis = {
  dnsResult: null,
  tcpTlsHttpResult: null,
  curlDefaultResult: null,
  curlIpv4Result: null,
  curlIpv6Result: null,
  curlHttp11Result: null,
  curlHttp2Result: null,
  nodeFetch30sResults: [],
  nodeFetch45sResult: null
};

console.log(`[diagnose] target=${targetUrl}`);
console.log("[diagnose] writes=none");
console.log("[diagnose] secrets=none");

try {
  diagnosis.dnsResult = await runStep("dns", () => diagnoseDns(hostname));
  diagnosis.tcpTlsHttpResult = await runStep("tcp_tls_http", () => diagnoseHttps(targetUrl));

  diagnosis.curlDefaultResult = await runStep("curl_default", () => diagnoseCurl("default", []));
  diagnosis.curlIpv4Result = await runStep("curl_ipv4", () => diagnoseCurl("ipv4", ["--ipv4"]));
  diagnosis.curlIpv6Result = await runStep("curl_ipv6", () => diagnoseCurl("ipv6", ["--ipv6"]));
  diagnosis.curlHttp11Result = await runStep("curl_http11", () => diagnoseCurl("http1.1", ["--http1.1"]));
  diagnosis.curlHttp2Result = await runStep("curl_http2", () => diagnoseCurl("http2", ["--http2"]));

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await runStep(`node_fetch_production_equivalent_30s_attempt_${attempt}`, () => {
      return diagnoseProductionFetch({ timeoutMs: productionTimeoutMs, attempt });
    });
    diagnosis.nodeFetch30sResults.push(result);
    if (attempt < 3) await sleep(retryDelayMs);
  }

  diagnosis.nodeFetch45sResult = await runStep("node_fetch_production_equivalent_45s", () => {
    return diagnoseProductionFetch({ timeoutMs: comparisonTimeoutMs, attempt: 1 });
  });

  printJson("node_fetch_production_equivalent", {
    nodeFetch30sResults: diagnosis.nodeFetch30sResults,
    nodeFetch45sResult: diagnosis.nodeFetch45sResult,
    intermittentFailure: isIntermittent([...diagnosis.nodeFetch30sResults, diagnosis.nodeFetch45sResult].filter(Boolean))
  });
} catch (error) {
  printJson("unexpected_error", errorSummary(error));
} finally {
  const finalDiagnosis = buildFinalDiagnosis(diagnosis);
  printJson("final_diagnosis", finalDiagnosis);
}

async function runStep(label, fn) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  console.log(`[diagnose:${label}:start] ${startedAt}`);
  try {
    const result = await fn();
    const wrapped = {
      ...(result || {}),
      stepStartedAt: startedAt,
      stepFinishedAt: new Date().toISOString(),
      stepDurationMs: elapsed(started)
    };
    printJson(label, wrapped);
    console.log(`[diagnose:${label}:end] ${wrapped.stepFinishedAt} durationMs=${wrapped.stepDurationMs}`);
    return wrapped;
  } catch (error) {
    const wrapped = {
      success: false,
      unsupported: false,
      error: errorSummary(error),
      stepStartedAt: startedAt,
      stepFinishedAt: new Date().toISOString(),
      stepDurationMs: elapsed(started)
    };
    printJson(label, wrapped);
    console.log(`[diagnose:${label}:end] ${wrapped.stepFinishedAt} durationMs=${wrapped.stepDurationMs}`);
    return wrapped;
  }
}

async function diagnoseDns(host) {
  const started = performance.now();
  try {
    const records = await dns.lookup(host, { all: true, verbatim: false });
    return {
      hostname: host,
      success: true,
      durationMs: elapsed(started),
      ipv4: records.filter((record) => record.family === 4).map((record) => record.address),
      ipv6: records.filter((record) => record.family === 6).map((record) => record.address)
    };
  } catch (error) {
    return {
      hostname: host,
      success: false,
      durationMs: elapsed(started),
      ipv4: [],
      ipv6: [],
      error: errorSummary(error),
      failureKind: networkFailureKind(error)
    };
  }
}

async function diagnoseHttps(url, redirectCount = 0, previous = []) {
  const one = await requestOnce(url);
  const chain = [...previous, one];
  if (one.status >= 300 && one.status < 400 && one.headers.location && redirectCount < 10) {
    const nextUrl = new URL(one.headers.location, url).toString();
    return diagnoseHttps(nextUrl, redirectCount + 1, chain);
  }

  const final = chain.at(-1);
  return {
    success: Boolean(final.success),
    connected: chain.some((item) => Boolean(item.connected)),
    httpStatus: final.status || 0,
    finalUrl: final.url,
    redirectCount,
    timingsMs: final.timingsMs,
    responseBytes: final.responseBytes || 0,
    safeHeaders: safeHeaders(final.headers || {}),
    setCookieNames: cookieNames(final.setCookie || []),
    body: final.bodySummary || null,
    cloudflareChallenge: final.challenge || null,
    redirects: chain.slice(0, -1).map((item) => ({
      status: item.status || 0,
      url: item.url,
      location: item.headers?.location || ""
    })),
    error: final.error || null,
    failureKind: final.failureKind || ""
  };
}

function requestOnce(url) {
  return new Promise((resolve) => {
    const started = performance.now();
    const timings = { dns: null, connect: null, tls: null, ttfb: null, total: null };
    let connected = false;
    let settled = false;
    let lookupStarted = 0;
    const parsed = new URL(url);
    const chunks = [];

    const request = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      timeout: tcpHttpTimeoutMs,
      minVersion: "TLSv1.2",
      secureOptions: tlsConstants.SSL_OP_NO_SSLv2 | tlsConstants.SSL_OP_NO_SSLv3,
      headers: productionHeaders(),
      lookup(host, options, callback) {
        lookupStarted = performance.now();
        dns.lookup(host, options)
          .then((result) => {
            timings.dns = elapsed(lookupStarted);
            if (options?.all) callback(null, result);
            else callback(null, result.address, result.family);
          })
          .catch((error) => {
            timings.dns = elapsed(lookupStarted);
            callback(error);
          });
      }
    }, (response) => {
      timings.ttfb = elapsed(started);
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        timings.total = elapsed(started);
        const body = Buffer.concat(chunks);
        const headers = lowerHeaders(response.headers);
        settle({
          success: true,
          connected,
          url,
          status: response.statusCode || 0,
          headers,
          setCookie: Array.isArray(response.headers["set-cookie"]) ? response.headers["set-cookie"] : [],
          timingsMs: normalizeTimings(timings),
          responseBytes: body.length,
          bodySummary: bodySummary(body),
          challenge: challengeSummary(response.statusCode || 0, headers, body)
        });
      });
    });

    request.on("socket", (socket) => {
      socket.on("lookup", () => {
        if (lookupStarted && timings.dns === null) timings.dns = elapsed(lookupStarted);
      });
      socket.on("connect", () => {
        connected = true;
        timings.connect = elapsed(started);
      });
      socket.on("secureConnect", () => {
        timings.tls = elapsed(started);
      });
    });
    request.on("timeout", () => {
      const error = new Error(`Request timed out after ${tcpHttpTimeoutMs}ms`);
      error.name = "TimeoutError";
      error.code = "LOCAL_REQUEST_TIMEOUT";
      request.destroy(error);
    });
    request.on("error", (error) => {
      timings.total = elapsed(started);
      settle({
        success: false,
        connected,
        url,
        status: 0,
        headers: {},
        timingsMs: normalizeTimings(timings),
        responseBytes: 0,
        error: errorSummary(error),
        failureKind: networkFailureKind(error)
      });
    });
    request.end();

    function settle(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }
  });
}

async function diagnoseCurl(mode, modeArgs) {
  const writeOut = [
    "exit_marker=curl_write_out",
    "http_code=%{http_code}",
    "url_effective=%{url_effective}",
    "num_redirects=%{num_redirects}",
    "remote_ip=%{remote_ip}",
    "http_version=%{http_version}",
    "time_namelookup=%{time_namelookup}",
    "time_connect=%{time_connect}",
    "time_appconnect=%{time_appconnect}",
    "time_starttransfer=%{time_starttransfer}",
    "time_total=%{time_total}",
    "size_download=%{size_download}"
  ].join("\n");
  const args = [
    "--get",
    "--silent",
    "--show-error",
    "--location",
    "--connect-timeout", String(curlConnectTimeoutSeconds),
    "--max-time", String(curlTotalTimeoutSeconds),
    "--user-agent", productionUserAgent,
    "--header", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "--header", "Accept-Language: zh-TW,zh;q=0.9,en;q=0.8",
    "--header", "Cache-Control: no-cache",
    "--header", `Referer: ${targetUrl}`,
    "--dump-header", "-",
    "--output", process.platform === "win32" ? "NUL" : "/dev/null",
    "--write-out", `\n--CURL-WRITE-OUT--\n${writeOut}\n`,
    ...modeArgs,
    targetUrl
  ];

  try {
    const { stdout, stderr } = await execFileAsync("curl", args, {
      timeout: (curlTotalTimeoutSeconds + 5) * 1000,
      maxBuffer: 1024 * 1024
    });
    return curlResult({ mode, stdout, stderr, error: null });
  } catch (error) {
    const result = curlResult({ mode, stdout: error.stdout || "", stderr: error.stderr || "", error });
    if (isUnsupportedCurlMode(mode, result)) {
      return { ...result, unsupported: true, success: false };
    }
    return result;
  }
}

function curlResult({ mode, stdout, stderr, error }) {
  const [rawHeaders, rawMetrics = ""] = String(stdout || "").split("\n--CURL-WRITE-OUT--\n");
  const headers = parseCurlHeaders(rawHeaders || "");
  const metrics = parseCurlMetrics(rawMetrics);
  const curlCode = Number(error?.code ?? 0);
  const stderrText = sanitizeCurlStderr(stderr);
  const timedOut = curlCode === 28 || /operation timed out|timed out after|connection timed out/i.test(stderrText);
  return {
    mode,
    success: !error,
    unsupported: false,
    curlCode,
    timedOut,
    httpCode: Number(metrics.http_code || 0),
    ipVersion: ipVersion(metrics.remote_ip || ""),
    httpVersion: curlHttpVersion(metrics.http_version || ""),
    finalUrl: metrics.url_effective || "",
    redirectCount: Number(metrics.num_redirects || 0),
    timings: {
      dns: Number(metrics.time_namelookup || 0),
      connect: Number(metrics.time_connect || 0),
      tls: Number(metrics.time_appconnect || 0),
      ttfb: Number(metrics.time_starttransfer || 0),
      total: Number(metrics.time_total || 0)
    },
    responseBytes: Number(metrics.size_download || 0),
    safeHeaders: safeHeaders(headers),
    setCookieNames: cookieNames(headers["set-cookie"] || []),
    error: error ? curlErrorSummary(error, stderrText) : null,
    stderr: stderrText
  };
}

async function diagnoseProductionFetch({ timeoutMs, attempt }) {
  const started = performance.now();
  const controllerSignal = AbortSignal.timeout(timeoutMs);
  let response = null;
  let ttfbMs = null;

  try {
    response = await fetch(targetUrl, {
      headers: productionHeaders(),
      signal: controllerSignal
    });
    ttfbMs = elapsed(started);
    const arrayBuffer = await response.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    const headers = fetchHeaders(response.headers);
    return {
      label: "node_fetch_production_equivalent",
      attempt,
      timeoutMs,
      success: true,
      httpStatus: response.status,
      finalUrl: response.url,
      responseBytes: body.length,
      ttfbMs,
      totalTimeMs: elapsed(started),
      error: emptyFetchError(),
      signalAborted: Boolean(controllerSignal.aborted),
      abortReason: abortReason(controllerSignal),
      safeHeaders: safeHeaders(headers),
      setCookieNames: cookieNames(getFetchSetCookies(response.headers, headers)),
      body: bodySummary(body),
      cloudflareChallenge: challengeSummary(response.status, headers, body)
    };
  } catch (error) {
    return {
      label: "node_fetch_production_equivalent",
      attempt,
      timeoutMs,
      success: false,
      httpStatus: response?.status || 0,
      finalUrl: response?.url || targetUrl,
      responseBytes: 0,
      ttfbMs,
      totalTimeMs: elapsed(started),
      error: fetchErrorSummary(error),
      signalAborted: Boolean(controllerSignal.aborted),
      abortReason: abortReason(controllerSignal),
      safeHeaders: response ? safeHeaders(fetchHeaders(response.headers)) : safeHeaders({}),
      setCookieNames: [],
      cloudflareChallenge: null,
      failureKind: networkFailureKind(error)
    };
  }
}

function buildFinalDiagnosis(result) {
  const curlResults = [
    result.curlDefaultResult,
    result.curlIpv4Result,
    result.curlIpv6Result,
    result.curlHttp11Result,
    result.curlHttp2Result
  ].filter(Boolean);
  const node30 = result.nodeFetch30sResults.filter(Boolean);
  const nodeFetches = [...node30, result.nodeFetch45sResult].filter(Boolean);
  const allResults = [
    result.dnsResult,
    result.tcpTlsHttpResult,
    ...curlResults,
    ...nodeFetches
  ].filter(Boolean);

  const successfulRequestCount = allResults.filter(isSuccessfulRequest).length;
  const timeoutCount = allResults.filter(isTimeoutResult).length;
  const challengeCount = allResults.filter(hasChallenge).length;
  const conclusion = classifyFinal({
    result,
    curlResults,
    node30,
    nodeFetches,
    successfulRequestCount,
    timeoutCount,
    challengeCount
  });

  return {
    dnsResult: compactResult(result.dnsResult),
    tcpTlsHttpResult: compactResult(result.tcpTlsHttpResult),
    curlDefaultResult: compactResult(result.curlDefaultResult),
    curlIpv4Result: compactResult(result.curlIpv4Result),
    curlIpv6Result: compactResult(result.curlIpv6Result),
    curlHttp11Result: compactResult(result.curlHttp11Result),
    curlHttp2Result: compactResult(result.curlHttp2Result),
    nodeFetch30sResults: node30.map(compactResult),
    nodeFetch45sResult: compactResult(result.nodeFetch45sResult),
    successfulRequestCount,
    timeoutCount,
    challengeCount,
    intermittentFailure: isIntermittent([...curlResults, ...nodeFetches]),
    conclusion
  };
}

function classifyFinal({ result, curlResults, node30, nodeFetches, successfulRequestCount, challengeCount }) {
  if (!result.dnsResult?.success) return reason("A. dns_failure", "DNS lookup failed.");
  if (challengeCount > 0) return reason("I. cloudflare_challenge_detected", "At least one response had Cloudflare challenge headers or HTML markers.");

  const tcp = result.tcpTlsHttpResult;
  if (tcp && !tcp.success && tcp.failureKind === "connect_timeout") return reason("B. connect_timeout", "The TCP/TLS/HTTP probe reported a connect timeout.");
  if (tcp && !tcp.success && tcp.failureKind === "tls_failure") return reason("C. tls_failure", "The TCP/TLS/HTTP probe reported a TLS failure.");

  const ipv4 = result.curlIpv4Result;
  const ipv6 = result.curlIpv6Result;
  if (hasMeaningfulDifference(ipv4, ipv6)) {
    return reason("G. ipv4_ipv6_path_difference", "IPv4 and IPv6 curl probes produced different success or timeout outcomes.");
  }

  const http11 = result.curlHttp11Result;
  const http2 = result.curlHttp2Result;
  if (hasMeaningfulDifference(http11, http2)) {
    return reason("H. http_protocol_difference", "HTTP/1.1 and HTTP/2 curl probes produced different success or timeout outcomes.");
  }

  if (isIntermittent([...curlResults, ...nodeFetches])) {
    return reason("D. intermittent_no_response", "The same client family had both success and no-response timeout outcomes.");
  }

  if (node30.length > 0 && node30.every(isTimeoutResult)) {
    return reason("E. node_fetch_timeout", "All 30s production-equivalent Node fetch attempts timed out.");
  }

  const nodeSucceeded = nodeFetches.some(isSuccessfulRequest);
  const tcpSucceeded = isSuccessfulRequest(tcp);
  const supportedCurl = curlResults.filter((item) => item && !item.unsupported);
  if (tcpSucceeded && nodeSucceeded && supportedCurl.length > 0 && supportedCurl.every(isTimeoutResult)) {
    return reason("F. curl_only_timeout", "Node HTTPS and Node fetch succeeded, but every supported curl probe timed out.");
  }

  const mainResults = [tcp, result.curlDefaultResult, ...node30, result.nodeFetch45sResult].filter(Boolean);
  if (mainResults.length > 0 && mainResults.every(isSuccessfulRequest)) {
    return reason("J. request_success", "All main probes completed successfully.");
  }

  if (successfulRequestCount > 0) {
    return reason("J. request_success", "At least one primary request path completed successfully and no higher-priority failure category matched.");
  }

  return reason("K. unknown_network_failure", "No allowed category matched the collected results.");
}

function productionHeaders() {
  return {
    "User-Agent": productionUserAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Referer": targetUrl
  };
}

function isSuccessfulRequest(result) {
  const status = Number(result?.httpStatus || result?.httpCode || 0);
  return Boolean(result?.success) && status >= 200 && status < 400;
}

function isTimeoutResult(result) {
  if (!result) return false;
  if (result.timedOut) return true;
  if (result.failureKind === "request_aborted_by_local_timeout" || result.failureKind === "connect_timeout" || result.failureKind === "headers_timeout") return true;
  const error = result.error || {};
  const combined = [error.name, error.message, error.code, error.causeCode].filter(Boolean).join(" ");
  return /timeout|timed out|AbortError|TimeoutError|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|ETIMEDOUT/i.test(combined);
}

function hasChallenge(result) {
  return Boolean(result?.cloudflareChallenge?.detected || result?.body?.markers?.cloudflareChallengeMarker || result?.body?.markers?.titleJustAMoment);
}

function isIntermittent(results) {
  const groups = new Map();
  for (const result of results.filter((item) => item && !item.unsupported)) {
    const key = result.label || result.mode || "unknown";
    const current = groups.get(key) || { success: false, timeout: false };
    current.success = current.success || isSuccessfulRequest(result);
    current.timeout = current.timeout || isTimeoutResult(result);
    groups.set(key, current);
  }
  return [...groups.values()].some((group) => group.success && group.timeout);
}

function hasMeaningfulDifference(a, b) {
  if (!a || !b || a.unsupported || b.unsupported) return false;
  return isSuccessfulRequest(a) !== isSuccessfulRequest(b) || isTimeoutResult(a) !== isTimeoutResult(b);
}

function compactResult(result) {
  if (!result) return null;
  return {
    success: Boolean(result.success),
    unsupported: Boolean(result.unsupported),
    httpStatus: Number(result.httpStatus || result.httpCode || 0),
    finalUrl: result.finalUrl || "",
    responseBytes: Number(result.responseBytes || 0),
    ttfbMs: nullableNumber(result.ttfbMs),
    totalTimeMs: nullableNumber(result.totalTimeMs),
    signalAborted: Boolean(result.signalAborted),
    abortReason: result.abortReason || "",
    ipVersion: result.ipVersion || "",
    httpVersion: result.httpVersion || "",
    timedOut: isTimeoutResult(result),
    challengeDetected: hasChallenge(result),
    failureKind: result.failureKind || "",
    error: result.error || null,
    safeHeaders: result.safeHeaders || null,
    timingsMs: result.timingsMs || null,
    curlTimings: result.timings || null,
    stepDurationMs: result.stepDurationMs || null
  };
}

function challengeSummary(status, headers, body) {
  const html = body.toString("utf8");
  const lower = html.toLowerCase();
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const reasons = [];
  if (String(headers["cf-mitigated"] || "").toLowerCase() === "challenge") reasons.push("cf-mitigated: challenge");
  if (lower.includes("/cdn-cgi/challenge-platform/")) reasons.push("/cdn-cgi/challenge-platform/");
  if (title.toLowerCase().includes("just a moment")) reasons.push("HTML title contains Just a moment");
  if ([403, 429, 503].includes(Number(status))) reasons.push(`HTTP ${status}`);
  if (/(cf-browser-verification|checking your browser|challenge-platform|turnstile|cf-chl|captcha)/i.test(html)) {
    reasons.push("Cloudflare challenge marker");
  }
  return {
    detected: reasons.length > 0,
    reason: reasons.length ? reasons.join("; ") : "no challenge markers detected"
  };
}

function bodySummary(body) {
  const html = body.toString("utf8");
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  return {
    title,
    byteLength: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
    markers: {
      cdnCgiChallengePlatform: html.toLowerCase().includes("/cdn-cgi/challenge-platform/"),
      titleJustAMoment: title.toLowerCase().includes("just a moment"),
      cloudflareChallengeMarker: /(cf-browser-verification|checking your browser|challenge-platform|turnstile|cf-chl|captcha)/i.test(html)
    }
  };
}

function networkFailureKind(error) {
  const name = error?.name || "";
  const code = error?.code || "";
  const causeCode = error?.cause?.code || "";
  const combined = [name, code, causeCode, error?.message, error?.cause?.message].filter(Boolean).join(" ");
  if (["ENOTFOUND", "EAI_AGAIN"].some((value) => combined.includes(value))) return "dns_failure";
  if (combined.includes("UND_ERR_CONNECT_TIMEOUT") || combined.includes("ETIMEDOUT")) return "connect_timeout";
  if (combined.includes("UND_ERR_HEADERS_TIMEOUT")) return "headers_timeout";
  if (name === "AbortError" || name === "TimeoutError" || combined.includes("The operation was aborted due to timeout")) return "request_aborted_by_local_timeout";
  if (isTlsCode(combined)) return "tls_failure";
  if (["ECONNREFUSED", "ECONNRESET"].some((value) => combined.includes(value))) return causeCode || code || "connection_failure";
  return "unknown_network_failure";
}

function parseCurlHeaders(raw) {
  const blocks = String(raw || "").split(/\r?\n\r?\n/).filter((block) => block.trim().startsWith("HTTP/"));
  const last = blocks.at(-1) || "";
  const result = {};
  for (const line of last.split(/\r?\n/).slice(1)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const name = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (name === "set-cookie") result[name] = [...(result[name] || []), value];
    else result[name] = value;
  }
  return result;
}

function parseCurlMetrics(raw) {
  const result = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    result[key] = Number.isFinite(Number(value)) && value.trim() !== "" ? Number(value) : value;
  }
  return result;
}

function safeHeaders(headers) {
  const result = {};
  for (const name of safeHeaderNames) result[name] = headerValue(headers[name]);
  return result;
}

function cookieNames(setCookieHeaders) {
  const values = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders].filter(Boolean);
  return [...new Set(values.map((value) => String(value).split("=", 1)[0].trim()).filter(Boolean))];
}

function lowerHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) result[key.toLowerCase()] = value;
  return result;
}

function fetchHeaders(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) result[key.toLowerCase()] = value;
  return result;
}

function getFetchSetCookies(headers, lowered) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  return lowered["set-cookie"] ? [lowered["set-cookie"]] : [];
}

function errorSummary(error) {
  return {
    name: error?.name || "",
    message: error?.message || String(error),
    code: error?.code || "",
    causeCode: error?.cause?.code || ""
  };
}

function fetchErrorSummary(error) {
  return {
    name: error?.name || "",
    message: error?.message || String(error),
    code: error?.code || "",
    causeName: error?.cause?.name || "",
    causeMessage: error?.cause?.message || "",
    causeCode: error?.cause?.code || ""
  };
}

function curlErrorSummary(error, stderrText) {
  return {
    name: error?.name || "",
    message: stderrText || error?.message || String(error),
    code: error?.code || "",
    causeCode: error?.cause?.code || ""
  };
}

function emptyFetchError() {
  return {
    name: "",
    message: "",
    code: "",
    causeName: "",
    causeMessage: "",
    causeCode: ""
  };
}

function abortReason(signal) {
  const reason = signal?.reason;
  if (!reason) return "";
  return reason?.name || reason?.message || String(reason);
}

function normalizeTimings(timings) {
  return {
    dns: nullableNumber(timings.dns),
    connect: nullableNumber(timings.connect),
    tls: nullableNumber(timings.tls),
    ttfb: nullableNumber(timings.ttfb),
    total: nullableNumber(timings.total)
  };
}

function isUnsupportedCurlMode(mode, result) {
  const text = `${result.error?.message || ""}\n${result.stderr || ""}`.toLowerCase();
  if (mode === "ipv6" && /couldn't connect|network is unreachable|no route to host|address family|cannot assign requested address/.test(text)) return true;
  if (mode === "http2" && /option --http2.*unknown|unsupported protocol|does not support|doesn't support|the installed libcurl version/.test(text)) return true;
  return false;
}

function ipVersion(value) {
  if (!value) return "";
  return String(value).includes(":") ? "IPv6" : "IPv4";
}

function curlHttpVersion(value) {
  const text = String(value || "");
  if (text === "1") return "HTTP/1.x";
  if (text === "1.1") return "HTTP/1.1";
  if (text === "2") return "HTTP/2";
  if (text === "3") return "HTTP/3";
  return text;
}

function sanitizeCurlStderr(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !/^set-cookie:/i.test(line))
    .join("\n")
    .slice(0, 2000);
}

function isTlsCode(value = "") {
  return /TLS|SSL|CERT|HANDSHAKE|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(String(value));
}

function nullableNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
}

function headerValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value || "";
}

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function reason(category, basis) {
  return { category, basis };
}

function elapsed(started) {
  return Number((performance.now() - started).toFixed(1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printJson(label, value) {
  console.log(`[diagnose:${label}] ${JSON.stringify(value, null, 2)}`);
}
