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
  ads.forEach((slot) => adsList.appendChild(AdminAdSlotEditor(slot)));
}

function AdminAdSlotEditor(slot) {
  const slotKey = slot.id || slot.slotKey;
  const article = document.createElement("article");
  article.className = "ad-editor";
  article.dataset.slot = slotKey;

  const head = document.createElement("div");
  head.className = "editor-head";
  const titleBox = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = slot.title;
  const code = document.createElement("code");
  code.textContent = slotKey;
  titleBox.append(title, code);
  head.append(titleBox, createSlotCheckbox(slotKey, "enabled", "啟用廣告位", slot.enabled, "switch"));

  const grid = document.createElement("div");
  grid.className = "form-grid slot-grid";
  grid.append(
    createSlotInput(slotKey, "title", "廣告位名稱", slot.title),
    createSlotInput(slotKey, "sort", "廣告位排序", Number(slot.sort || 0), "number"),
    createSlotInput(slotKey, "intervalMs", "輪播間隔毫秒", Number(slot.intervalMs || 5000), "number"),
    createSlotCheckbox(slotKey, "carousel", "啟用輪播", slot.carousel, "switch inline-switch"),
    createSlotCheckbox(slotKey, "desktopEnabled", "桌機顯示", slot.desktopEnabled, "switch inline-switch"),
    createSlotCheckbox(slotKey, "mobileEnabled", "手機顯示", slot.mobileEnabled, "switch inline-switch")
  );

  const itemsHead = document.createElement("div");
  itemsHead.className = "items-head";
  const count = document.createElement("strong");
  count.textContent = `廣告素材 ${slot.items.length} 筆`;
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "secondary";
  addButton.textContent = "新增廣告";
  addButton.addEventListener("click", () => addAdItem(slotKey));
  itemsHead.append(count, addButton);

  const items = document.createElement("div");
  items.className = "ad-items";
  slot.items
    .slice()
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
    .forEach((item) => items.appendChild(AdminAdItemEditor(slotKey, item)));
  if (!slot.items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-items";
    empty.textContent = "目前沒有廣告素材，點擊「新增廣告」加入圖片或影片 URL。";
    items.appendChild(empty);
  }

  article.append(head, grid, itemsHead, items);
  return article;
}

function AdminAdItemEditor(slotKey, item) {
  const section = document.createElement("section");
  section.className = "ad-item-editor";
  section.dataset.slot = slotKey;
  section.dataset.item = item.id;

  const head = document.createElement("div");
  head.className = "item-head";
  const title = document.createElement("strong");
  title.textContent = item.title || item.id;
  const actions = document.createElement("div");
  actions.className = "item-actions";
  actions.append(
    createMoveButton(slotKey, item.id, -1, "上移"),
    createMoveButton(slotKey, item.id, 1, "下移"),
    createDeleteButton(slotKey, item.id)
  );
  head.append(title, actions);

  const grid = document.createElement("div");
  grid.className = "form-grid";
  grid.append(
    createItemInput(slotKey, item.id, "title", "素材標題", item.title),
    createItemInput(slotKey, item.id, "sort", "素材排序", Number(item.sort || 0), "number"),
    createItemInput(slotKey, item.id, "imageUrl", "廣告圖片 URL", item.imageUrl, "url", "https://example.com/ad.jpg", "wide"),
    createItemInput(slotKey, item.id, "linkUrl", "跳轉連結", item.linkUrl, "url", "https://example.com/", "wide"),
    createItemSelect(slotKey, item.id, "target", "開啟方式", item.target),
    createItemInput(slotKey, item.id, "startAt", "開始時間", toLocalDatetime(item.startAt), "datetime-local"),
    createItemInput(slotKey, item.id, "endAt", "結束時間", toLocalDatetime(item.endAt), "datetime-local"),
    createItemChecks(slotKey, item)
  );

  section.append(head, grid);
  return section;
}

function createSlotInput(slotKey, field, labelText, value, type = "text", placeholder = "", className = "") {
  return createInput({ slotKey, field, labelText, value, type, placeholder, className, scope: "slot" });
}

function createItemInput(slotKey, itemId, field, labelText, value, type = "text", placeholder = "", className = "") {
  return createInput({ slotKey, itemId, field, labelText, value, type, placeholder, className, scope: "item" });
}

function createInput({ slotKey, itemId = "", field, labelText, value, type, placeholder, className, scope }) {
  const label = document.createElement("label");
  if (className) label.className = className;
  label.append(labelText);
  const input = document.createElement("input");
  input.dataset.scope = scope;
  input.dataset.slot = slotKey;
  input.dataset.item = itemId;
  input.dataset.field = field;
  input.type = type;
  input.value = value ?? "";
  input.placeholder = placeholder;
  input.addEventListener("input", updateFromForm);
  input.addEventListener("change", updateFromForm);
  label.append(input);
  return label;
}

function createItemSelect(slotKey, itemId, field, labelText, value) {
  const label = document.createElement("label");
  label.append(labelText);
  const select = document.createElement("select");
  select.dataset.scope = "item";
  select.dataset.slot = slotKey;
  select.dataset.item = itemId;
  select.dataset.field = field;
  [
    ["_blank", "新分頁"],
    ["_self", "同頁開啟"]
  ].forEach(([optionValue, text]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = text;
    option.selected = value === optionValue;
    select.append(option);
  });
  select.addEventListener("input", updateFromForm);
  select.addEventListener("change", updateFromForm);
  label.append(select);
  return label;
}

function createSlotCheckbox(slotKey, field, labelText, checked, className = "") {
  return createCheckbox({ slotKey, field, labelText, checked, className, scope: "slot" });
}

function createItemCheckbox(slotKey, itemId, field, labelText, checked, className = "") {
  return createCheckbox({ slotKey, itemId, field, labelText, checked, className, scope: "item" });
}

function createCheckbox({ slotKey, itemId = "", field, labelText, checked, className = "" , scope }) {
  const label = document.createElement("label");
  if (className) label.className = className;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.scope = scope;
  input.dataset.slot = slotKey;
  input.dataset.item = itemId;
  input.dataset.field = field;
  input.checked = Boolean(checked);
  input.addEventListener("input", updateFromForm);
  input.addEventListener("change", updateFromForm);
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(input, span);
  return label;
}

function createItemChecks(slotKey, item) {
  const wrapper = document.createElement("div");
  wrapper.className = "checks wide";
  wrapper.append(
    createItemCheckbox(slotKey, item.id, "enabled", "啟用素材", item.enabled),
    createItemCheckbox(slotKey, item.id, "desktopEnabled", "桌機顯示", item.desktopEnabled),
    createItemCheckbox(slotKey, item.id, "mobileEnabled", "手機顯示", item.mobileEnabled)
  );
  return wrapper;
}

function createMoveButton(slotKey, itemId, direction, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary small";
  button.textContent = label;
  button.addEventListener("click", () => moveAdItem(slotKey, itemId, direction));
  return button;
}

function createDeleteButton(slotKey, itemId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary danger";
  button.textContent = "刪除";
  button.addEventListener("click", () => deleteAdItem(slotKey, itemId));
  return button;
}

function updateFromForm(event) {
  const { scope, slot: slotKey, item: itemId, field } = event.target.dataset;
  const slot = findSlot(slotKey);
  if (!slot || !field) return;

  const target = scope === "item" ? slot.items.find((item) => item.id === itemId) : slot;
  if (!target) return;
  target[field] = readFieldValue(event.target, field);
}

function readFieldValue(input, field) {
  if (input.type === "checkbox") return input.checked;
  if (field === "sort" || field === "intervalMs") return Number(input.value || 0);
  if (field === "startAt" || field === "endAt") return input.value ? new Date(input.value).toISOString() : "";
  return input.value;
}

function addAdItem(slotKey) {
  const slot = findSlot(slotKey);
  if (!slot) return;
  const nextSort = Math.max(0, ...slot.items.map((item) => Number(item.sort || 0))) + 1;
  slot.items.push({
    id: `${slotKey}_${Date.now()}`,
    enabled: true,
    title: `廣告素材 ${nextSort}`,
    imageUrl: "",
    linkUrl: "",
    target: "_blank",
    sort: nextSort,
    desktopEnabled: slot.items[0]?.desktopEnabled ?? true,
    mobileEnabled: slot.items[0]?.mobileEnabled ?? true,
    startAt: "",
    endAt: ""
  });
  renderAds();
}

function deleteAdItem(slotKey, itemId) {
  const slot = findSlot(slotKey);
  if (!slot) return;
  slot.items = slot.items.filter((item) => item.id !== itemId);
  renderAds();
}

function moveAdItem(slotKey, itemId, direction) {
  const slot = findSlot(slotKey);
  if (!slot) return;
  const sorted = slot.items.slice().sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
  const index = sorted.findIndex((item) => item.id === itemId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= sorted.length) return;
  [sorted[index].sort, sorted[nextIndex].sort] = [sorted[nextIndex].sort, sorted[index].sort];
  slot.items = sorted;
  renderAds();
}

async function saveAds() {
  ads = normalizeAds(ads).map((slot) => ({
    ...slot,
    id: slot.id || slot.slotKey,
    slotKey: slot.slotKey || slot.id,
    siteCode: SITE_CODE,
    items: (slot.items || []).map((item) => ({ ...item }))
  }));
  const response = await fetch("/api/admin/ads", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteCode: SITE_CODE, ads })
  });

  if (!response.ok) {
    setMessage("儲存失敗，請檢查 ADS_KV 綁定。", true);
    return;
  }

  const payload = await response.json();
  ads = normalizeAds(payload.ads);
  renderAds();
  setMessage(`已儲存 ${ads.length} 個廣告位，前台會讀取最新設定。`);
}

function findSlot(slotKey) {
  return ads.find((adSlot) => adSlot.id === slotKey || adSlot.slotKey === slotKey);
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
