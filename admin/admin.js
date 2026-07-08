import { adsConfig, normalizeAds, SITE_CODE } from "../src/adsConfig.js";

let ads = normalizeAds(adsConfig);

const loginPanel = document.querySelector("#loginPanel");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#loginForm");
const message = document.querySelector("#message");
const adsList = document.querySelector("#adsList");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#password").value;
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  if (!response.ok) {
    setMessage("登入失敗，請確認 ADMIN_PASSWORD。", true);
    return;
  }
  document.querySelector("#password").value = "";
  await enterDashboard();
});

document.querySelector("#reloadBtn").addEventListener("click", enterDashboard);
document.querySelector("#saveBtn").addEventListener("click", saveAds);
document.querySelector("#logoutBtn").addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  dashboard.classList.add("hidden");
  loginPanel.classList.remove("hidden");
});

checkSession();

async function checkSession() {
  const response = await fetch(`/api/admin/ads?siteCode=${encodeURIComponent(SITE_CODE)}`);
  if (response.ok) {
    const payload = await response.json();
    ads = normalizeAds(payload.ads);
    showDashboard();
    return;
  }
  renderAds();
}

async function enterDashboard() {
  const response = await fetch(`/api/admin/ads?siteCode=${encodeURIComponent(SITE_CODE)}`);
  if (!response.ok) {
    setMessage("無法讀取廣告設定，請重新登入。", true);
    return;
  }
  const payload = await response.json();
  ads = normalizeAds(payload.ads);
  showDashboard();
  setMessage("已載入最新設定。");
}

function showDashboard() {
  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
  renderAds();
}

function renderAds() {
  adsList.innerHTML = ads.map(renderAdEditor).join("");
  adsList.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", updateFromForm);
    input.addEventListener("change", updateFromForm);
  });
}

function renderAdEditor(ad) {
  return `
    <article class="ad-editor" data-slot="${escapeHtml(ad.slotKey)}">
      <div class="editor-head">
        <div>
          <h3>${escapeHtml(ad.title)}</h3>
          <code>${escapeHtml(ad.slotKey)}</code>
        </div>
        <label class="switch">
          <input type="checkbox" data-field="enabled" ${ad.enabled ? "checked" : ""} />
          <span>啟用</span>
        </label>
      </div>
      <div class="form-grid">
        <label>
          標題
          <input data-field="title" value="${escapeAttr(ad.title)}" />
        </label>
        <label>
          排序
          <input data-field="sort" type="number" value="${Number(ad.sort || 0)}" />
        </label>
        <label class="wide">
          廣告圖片 URL
          <input data-field="image" placeholder="https://example.com/ad.jpg" value="${escapeAttr(ad.image)}" />
        </label>
        <label class="wide">
          跳轉連結
          <input data-field="link" placeholder="https://example.com/" value="${escapeAttr(ad.link)}" />
        </label>
        <label>
          開啟方式
          <select data-field="target">
            <option value="_blank" ${ad.target === "_blank" ? "selected" : ""}>新分頁</option>
            <option value="_self" ${ad.target === "_self" ? "selected" : ""}>同分頁</option>
          </select>
        </label>
        <label>
          開始時間
          <input data-field="startAt" type="datetime-local" value="${toLocalDatetime(ad.startAt)}" />
        </label>
        <label>
          結束時間
          <input data-field="endAt" type="datetime-local" value="${toLocalDatetime(ad.endAt)}" />
        </label>
        <div class="checks">
          <label><input type="checkbox" data-field="desktopEnabled" ${ad.desktopEnabled ? "checked" : ""} /> 桌機顯示</label>
          <label><input type="checkbox" data-field="mobileEnabled" ${ad.mobileEnabled ? "checked" : ""} /> 手機顯示</label>
        </div>
      </div>
    </article>
  `;
}

function updateFromForm(event) {
  const editor = event.target.closest("[data-slot]");
  const slotKey = editor.dataset.slot;
  const field = event.target.dataset.field;
  const item = ads.find((ad) => ad.slotKey === slotKey);
  if (!item || !field) return;
  if (event.target.type === "checkbox") {
    item[field] = event.target.checked;
  } else if (field === "sort") {
    item[field] = Number(event.target.value || 0);
  } else if (field === "startAt" || field === "endAt") {
    item[field] = event.target.value ? new Date(event.target.value).toISOString() : "";
  } else {
    item[field] = event.target.value;
  }
}

async function saveAds() {
  ads = normalizeAds(ads).map((ad) => ({ ...ad, siteCode: SITE_CODE }));
  const response = await fetch("/api/admin/ads", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteCode: SITE_CODE, ads })
  });
  if (!response.ok) {
    setMessage("儲存失敗，請確認登入狀態與 KV 綁定。", true);
    return;
  }
  const payload = await response.json();
  ads = normalizeAds(payload.ads);
  renderAds();
  setMessage("已儲存，前台會讀取最新廣告設定。");
}

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function toLocalDatetime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
