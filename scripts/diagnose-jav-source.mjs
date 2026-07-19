import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import { execFile } from "node:child_process";
import https from "node:https";
import { constants as tlsConstants } from "node:crypto";
import { promisify } from "node:util";

const targetUrl = "https://j-av.com/video/index.php";
const hostname = new URL(targetUrl).hostname;
const timeoutMs = 45000;
const chromeUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
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
const execFileAsync = promisify(execFile);

const diagnosis = {
  dns: null,
  http: null,
  curl: null,
  fetch: null
};

console.log(`[diagnose] target=${targetUrl}`);
console.log("[diagnose] writes=none");
console.log("[diagnose] secrets=none");

diagnosis.dns = await diagnoseDns(hostname);
printJson("dns", diagnosis.dns);

diagnosis.http = await diagnoseHttps(targetUrl);
printJson("tcp_tls_http", diagnosis.http);

diagnosis.curl = await diagnoseCurl(targetUrl);
printJson("curl_get", diagnosis.curl);

diagnosis.fetch = await diagnoseFetch(targetUrl);
printJson("node_fetch", diagnosis.fetch);

const conclusion = classify(diagnosis);
printJson("conclusion", conclusion);

async function diagnoseDns(host) {
  const started = performance.now();
  try {
    const records = await dns.lookup(host, { all: true, verbatim: false });
    const elapsedMs = elapsed(started);
    return {
      hostname: host,
      success: true,
      durationMs: elapsedMs,
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
      error: errorSummary(error)
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
    error: final.error || null
  };
}

function requestOnce(url) {
  return new Promise((resolve) => {
    const started = performance.now();
    const timings = {
      dns: null,
      connect: null,
      tls: null,
      ttfb: null,
      total: null
    };
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
      timeout: timeoutMs,
      minVersion: "TLSv1.2",
      secureOptions: tlsConstants.SSL_OP_NO_SSLv2 | tlsConstants.SSL_OP_NO_SSLv3,
      headers: requestHeaders(),
      lookup(host, options, callback) {
        lookupStarted = performance.now();
        dns.lookup(host, options)
          .then((result) => {
            timings.dns = elapsed(lookupStarted);
            if (options?.all) {
              callback(null, result);
            } else {
              callback(null, result.address, result.family);
            }
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
      const error = new Error(`Request timed out after ${timeoutMs}ms`);
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
        error: errorSummary(error)
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

async function diagnoseCurl(url) {
  const writeOut = [
    "http_code=%{http_code}",
    "url_effective=%{url_effective}",
    "num_redirects=%{num_redirects}",
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
    "--connect-timeout", "15",
    "--max-time", "45",
    "--user-agent", chromeUserAgent,
    "--header", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "--header", "Accept-Language: zh-TW,zh;q=0.9,en;q=0.8",
    "--header", "Cache-Control: no-cache",
    "--dump-header", "-",
    "--output", process.platform === "win32" ? "NUL" : "/dev/null",
    "--write-out", `\n--CURL-WRITE-OUT--\n${writeOut}\n`,
    url
  ];

  try {
    const { stdout, stderr } = await execFileAsync("curl", args, {
      timeout: timeoutMs + 5000,
      maxBuffer: 1024 * 1024
    });
    const [rawHeaders, rawMetrics = ""] = stdout.split("\n--CURL-WRITE-OUT--\n");
    const headers = parseCurlHeaders(rawHeaders || "");
    return {
      success: true,
      metrics: parseCurlMetrics(rawMetrics),
      safeHeaders: safeHeaders(headers),
      setCookieNames: cookieNames(headers["set-cookie"] || []),
      stderr: sanitizeCurlStderr(stderr)
    };
  } catch (error) {
    return {
      success: false,
      error: {
        ...errorSummary(error),
        stdout: sanitizeCurlOutput(error.stdout || ""),
        stderr: sanitizeCurlStderr(error.stderr || "")
      }
    };
  }
}

async function diagnoseFetch(url) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers: requestHeaders(),
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const arrayBuffer = await response.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    const headers = fetchHeaders(response.headers);
    return {
      success: true,
      httpStatus: response.status,
      ok: response.ok,
      finalUrl: response.url,
      totalTimeMs: elapsed(started),
      responseBytes: body.length,
      safeHeaders: safeHeaders(headers),
      setCookieNames: cookieNames(getFetchSetCookies(response.headers, headers)),
      body: bodySummary(body),
      cloudflareChallenge: challengeSummary(response.status, headers, body)
    };
  } catch (error) {
    return {
      success: false,
      totalTimeMs: elapsed(started),
      error: {
        name: error?.name || "",
        message: error?.message || String(error),
        code: error?.code || "",
        causeName: error?.cause?.name || "",
        causeMessage: error?.cause?.message || "",
        causeCode: error?.cause?.code || ""
      },
      failureKind: networkFailureKind(error)
    };
  }
}

function requestHeaders() {
  return {
    "User-Agent": chromeUserAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Referer": targetUrl
  };
}

function classify(result) {
  const fetchError = result.fetch?.error || {};
  const fetchKind = result.fetch?.failureKind || "";
  const httpError = result.http?.error || {};
  const httpStatus = Number(result.fetch?.httpStatus || result.http?.httpStatus || result.curl?.metrics?.http_code || 0);
  const challenge = result.fetch?.cloudflareChallenge?.detected || result.http?.cloudflareChallenge?.detected;

  if (!result.dns?.success) return reason("A. dns_failure", "DNS lookup failed before an HTTP request could be made.");
  if (challenge) return reason("H. cloudflare_challenge_detected", "Cloudflare challenge markers were detected in headers, status, URL, title, or body markers.");
  if (httpStatus === 403) return reason("F. http_403", "The request completed and returned HTTP 403.");
  if (httpStatus === 429) return reason("G. http_429", "The request completed and returned HTTP 429.");
  if (httpStatus >= 500) return reason("I. upstream_5xx", `The request completed and returned upstream status ${httpStatus}.`);
  if (httpStatus >= 200 && httpStatus < 400 && (result.fetch?.success || result.http?.success)) return reason("J. request_success", `The request completed successfully with HTTP ${httpStatus}.`);
  if (fetchKind === "tls_failure" || isTlsCode(fetchError.causeCode || fetchError.code || httpError.code)) return reason("C. tls_failure", "A TLS-related error was reported by Node.");
  if (fetchKind === "headers_timeout") return reason("D. headers_timeout", "Node/undici reported a headers timeout.");
  if (fetchKind === "connect_timeout" || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(fetchError.causeCode || httpError.code)) return reason("B. connect_timeout", "The connection attempt timed out.");
  if (fetchKind === "request_aborted_by_local_timeout" || fetchError.name === "AbortError" || fetchError.name === "TimeoutError" || httpError.code === "LOCAL_REQUEST_TIMEOUT") {
    return reason("E. request_aborted_by_local_timeout", `The local ${timeoutMs}ms timeout aborted the request.`);
  }
  return reason("K. unknown_network_failure", "No allowed category matched the collected DNS, curl, HTTP, and fetch results.");
}

function reason(category, basis) {
  return { category, basis };
}

function networkFailureKind(error) {
  const name = error?.name || "";
  const code = error?.code || "";
  const causeCode = error?.cause?.code || "";
  const combined = [name, code, causeCode, error?.message, error?.cause?.message].filter(Boolean).join(" ");
  if (["ENOTFOUND", "EAI_AGAIN"].some((value) => combined.includes(value))) return "dns_failure";
  if (["ECONNREFUSED", "ECONNRESET"].some((value) => combined.includes(value))) return causeCode || code || "connection_failure";
  if (combined.includes("UND_ERR_CONNECT_TIMEOUT") || combined.includes("ETIMEDOUT")) return "connect_timeout";
  if (combined.includes("UND_ERR_HEADERS_TIMEOUT")) return "headers_timeout";
  if (name === "AbortError" || name === "TimeoutError" || combined.includes("The operation was aborted due to timeout")) return "request_aborted_by_local_timeout";
  if (isTlsCode(combined)) return "tls_failure";
  return "unknown_network_failure";
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
  return {
    title: cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""),
    byteLength: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
    markers: {
      cdnCgiChallengePlatform: html.toLowerCase().includes("/cdn-cgi/challenge-platform/"),
      titleJustAMoment: cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").toLowerCase().includes("just a moment"),
      cloudflareChallengeMarker: /(cf-browser-verification|checking your browser|challenge-platform|turnstile|cf-chl|captcha)/i.test(html)
    }
  };
}

function safeHeaders(headers) {
  const result = {};
  for (const name of safeHeaderNames) {
    result[name] = headerValue(headers[name]);
  }
  return result;
}

function cookieNames(setCookieHeaders) {
  const values = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders].filter(Boolean);
  return [...new Set(values.map((value) => String(value).split("=", 1)[0].trim()).filter(Boolean))];
}

function lowerHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    result[key.toLowerCase()] = value;
  }
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

function parseCurlHeaders(raw) {
  const blocks = raw.split(/\r?\n\r?\n/).filter((block) => block.trim().startsWith("HTTP/"));
  const last = blocks.at(-1) || "";
  const result = {};
  for (const line of last.split(/\r?\n/).slice(1)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const name = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (name === "set-cookie") {
      result[name] = [...(result[name] || []), value];
    } else {
      result[name] = value;
    }
  }
  return result;
}

function parseCurlMetrics(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1);
    result[key] = Number.isFinite(Number(value)) ? Number(value) : value;
  }
  return result;
}

function sanitizeCurlOutput(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter((line) => !/^set-cookie:/i.test(line))
    .slice(-20)
    .join("\n");
}

function sanitizeCurlStderr(value) {
  return String(value || "").slice(0, 2000);
}

function errorSummary(error) {
  return {
    name: error?.name || "",
    message: error?.message || String(error),
    code: error?.code || "",
    causeCode: error?.cause?.code || ""
  };
}

function isTlsCode(value = "") {
  return /TLS|SSL|CERT|HANDSHAKE|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(String(value));
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

function elapsed(started) {
  return Number((performance.now() - started).toFixed(1));
}

function printJson(label, value) {
  console.log(`[diagnose:${label}] ${JSON.stringify(value, null, 2)}`);
}
