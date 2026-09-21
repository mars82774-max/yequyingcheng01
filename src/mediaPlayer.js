import { getManifestUrl, mediaVideoId } from "./mediaWorkerClient.js";

const players = new WeakMap();

document.addEventListener("DOMContentLoaded", () => {
  initMediaWorkerPlayers(document);
});

document.addEventListener("media-worker-player:refresh", (event) => {
  initMediaWorkerPlayers(event.detail?.root || document);
});

function initMediaWorkerPlayers(root = document) {
  root.querySelectorAll("video[data-media-worker-player]").forEach((video) => {
    setupMediaWorkerPlayer(video).catch((error) => markPlayerError(video, error));
  });
}

async function setupMediaWorkerPlayer(video) {
  if (players.has(video)) return;
  const source = video.dataset.src || getManifestUrl(mediaVideoId(video.dataset));
  if (!source) throw new Error("missing_source");
  video.preload = video.preload || "metadata";
  video.playsInline = true;

  if (!window.Hls) {
    await loadHlsScript();
  }

  if (window.Hls?.isSupported?.()) {
    const hls = new window.Hls({
      debug: false,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 15
    });
    players.set(video, hls);
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (data?.fatal) markPlayerError(video, data);
    });
    hls.loadSource(source);
    hls.attachMedia(video);
    markPlayerReady(video);
    return;
  }

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = source;
    markPlayerReady(video);
    return;
  }

  throw new Error("hls_not_supported");
}

function loadHlsScript() {
  if (window.Hls) return Promise.resolve();
  const existing = document.querySelector("script[data-hlsjs]");
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/src/hls.min.js";
    script.async = true;
    script.dataset.hlsjs = "true";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.head.append(script);
  });
}

function markPlayerReady(video) {
  const shell = video.closest("[data-media-player-shell]");
  shell?.classList.add("is-ready");
  shell?.classList.remove("is-error");
  const status = shell?.querySelector("[data-media-player-status]");
  if (status) status.textContent = "播放器已就緒";
}

function markPlayerError(video, error) {
  const shell = video.closest("[data-media-player-shell]");
  shell?.classList.add("is-error");
  const status = shell?.querySelector("[data-media-player-status]");
  if (status) status.textContent = "播放器暫時無法取得，請稍後再試。";
  console.error("[media-worker] player failed", error?.details || error?.message || error);
}


