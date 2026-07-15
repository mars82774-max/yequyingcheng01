import { spawn } from "node:child_process";

const mode = String(process.argv[2] || process.env.CRAWL_MODE || "backfill").toLowerCase();
if (!["backfill", "latest"].includes(mode)) {
  throw new Error(`Unsupported crawl mode: ${mode}`);
}

const env = {
  ...process.env,
  CRAWL_MODE: mode,
  CRAWL_FETCH_MODE: process.env.CRAWL_FETCH_MODE || "browser",
  BROWSER_PROFILE_DIR: process.env.BROWSER_PROFILE_DIR || "/home/ubuntu/video-browser-profile",
  SOURCE_FAILURE_PAUSE_THRESHOLD: process.env.SOURCE_FAILURE_PAUSE_THRESHOLD || "1",
  SOURCE_BLOCKED_PAUSE_HOURS: process.env.SOURCE_BLOCKED_PAUSE_HOURS || "24",
  CRAWL_TIMEOUT_MS: process.env.CRAWL_TIMEOUT_MS || "30000"
};

console.log(`[server-crawl] mode=${mode}`);
console.log(`[server-crawl] crawlFetchMode=${env.CRAWL_FETCH_MODE}`);
console.log(`[server-crawl] browserProfile=${env.BROWSER_PROFILE_DIR}`);

await run("git", ["fetch", "origin", "main"]);
await run("git", ["pull", "--ff-only", "origin", "main"]);
await run("npm", ["run", "update:videos"], { env });

const changed = await capture("git", ["status", "--porcelain", "--", "src/mockVideos.js", "src/videoCrawlState.json"]);
if (!changed.trim()) {
  console.log("[server-crawl] no data changes; skip commit");
  process.exit(0);
}

await run("git", ["add", "--", "src/mockVideos.js", "src/videoCrawlState.json"]);
await run("git", ["commit", "-m", `update ${mode} videos`]);
await run("git", ["push", "origin", "main"]);
console.log("[server-crawl] git push complete");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[server-crawl] run=${command} ${args.map(mask).join(" ")}`);
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });
}

function mask(value) {
  return String(value).replace(/(token|cookie|password)=\S+/gi, "$1=***");
}
