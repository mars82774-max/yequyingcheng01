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
    setMessage("登入失敗，請確認管理密碼。", true);
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
  setMessage("");
});

checkSession();

async function checkSession() {
  const response = await fetch(`/api/admin/ads?siteCode=${encodeURIComponent(SITE_CODE)}`);
  if (!response.ok) {
    renderAds();
    return;
  }

  const payload = await response.json();
  ads = normalizeAds(payload.ads);
  showDashboard();
  setMessage(`已載入 ${ads.length} 個廣告位。`);
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
  setMessage(`已載入 ${ads.length} 個廣告位。`);
}

function showDashboard() {
  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
  renderAds();
}

function renderAds() {
  ads = normalizeAds(ads);
  if (!ads.length) {
    adsList.innerHTML = `<p class="muted">目前沒有廣告位資料。</p>`;
    return;
  }

  adsList.textContent = "";
  ads.forEach((ad) => adsList.appendChild(renderAdEditor(ad)));
  adsList.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", updateFromForm);
    input.addEventListener("change", updateFromForm);
  });
}

function renderAdEditor(ad) {
  const article = document.createElement("article");
  article.className = "ad-editor";
  article.dataset.slot = ad.slotKey;

  const head = document.createElement("div");
  head.className = "editor-head";
  const titleBox = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = ad.title;
  const code = document.createElement("code");
  code.textContent = ad.slotKey;
  titleBox.append(title, code);
  head.append(titleBox, createCheckbox("enabled", "啟用", ad.enabled, "switch"));

  const grid = document.createElement("div");
  grid.className = "form-grid";
  grid.append(
    createInput("title", "標題", ad.title),
    createInput("sort", "排序", Number(ad.sort || 0), "number"),
    createInput("image", "廣告圖片 URL", ad.image, "url", "https://example.com/ad.jpg", "wide"),
    createInput("link", "跳轉連結", ad.link, "url", "https://example.com/", "wide"),
    createSelect("target", "開啟方式", ad.target),
    createInput("startAt", "開始時間", toLocalDatetime(ad.startAt), "datetime-local"),
    createInput("endAt", "結束時間", toLocalDatetime(ad.endAt), "datetime-local"),
    createChecks(ad)
  );

  article.append(head, grid);
  return article;
}

function createInput(field, labelText, value, type = "text", placeholder = "", className = "") {
  const label = document.createElement("label");
  if (className) label.className = className;
  label.append(labelText);
  const input = document.createElement("input");
  input.dataset.field = field;
  input.type = type;
  input.value = value ?? "";
  input.placeholder = placeholder;
  label.append(input);
  return label;
}

function createSelect(field, labelText, value) {
  const label = document.createElement("label");
  label.append(labelText);
  const select = document.createElement("select");
  select.dataset.field = field;
  [
    ["_blank", "新分頁"],
    ["_self", "同分頁"]
  ].forEach(([optionValue, text]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = text;
    option.selected = value === optionValue;
    select.append(option);
  });
  label.append(select);
  return label;
}

function createCheckbox(field, labelText, checked, className = "") {
  const label = document.createElement("label");
  if (className) label.className = className;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.field = field;
  input.checked = Boolean(checked);
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(input, span);
  return label;
}

function createChecks(ad) {
  const wrapper = document.createElement("div");
  wrapper.className = "checks";
  wrapper.append(
    createCheckbox("desktopEnabled", "桌機顯示", ad.desktopEnabled),
    createCheckbox("mobileEnabled", "手機顯示", ad.mobileEnabled)
  );
  return wrapper;
}

function updateFromForm(event) {
  const editor = event.target.closest("[data-slot]");
  if (!editor) return;
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
  setMessage(`已儲存 ${ads.length} 個廣告位，前台會讀取最新設定。`);
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
