import { mockVideos } from "./mockVideos.js";

const brand = {
  name: "夜趣影城",
  logo: "/assets/brands/yequyingcheng/logo.svg",
  icon: "/assets/brands/yequyingcheng/logo-icon.svg"
};

let state = {
  query: "",
  tag: "全部",
  selected: mockVideos[0]
};

const app = document.querySelector("#app");

function uniqueTags() {
  const tags = new Set(["全部"]);
  mockVideos.forEach((video) => video.tags.forEach((tag) => tags.add(tag)));
  return [...tags];
}

function filteredVideos() {
  const keyword = state.query.trim().toLowerCase();
  return mockVideos.filter((video) => {
    const text = [video.title, ...video.category, ...video.tags].join(" ").toLowerCase();
    const tagMatched = state.tag === "全部" || video.tags.includes(state.tag) || video.category.includes(state.tag);
    return tagMatched && (!keyword || text.includes(keyword));
  });
}

function videoPath(video) {
  return `/video/${encodeURIComponent(video.id)}/`;
}

function tagPath(tag) {
  return `/tag/${encodeURIComponent(tag)}/`;
}

function cardArt(video, index) {
  if (video.cover) {
    return `<img src="${video.cover}" alt="${escapeHtml(video.title)}" loading="lazy" />`;
  }
  const tone = ["gold", "sangria", "violet", "smoke", "ember", "midnight"][index % 6];
  return `<div class="poster-fallback ${tone}"><span>${String(index + 1).padStart(2, "0")}</span></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function render() {
  const videos = filteredVideos();
  const featured = state.selected || videos[0] || mockVideos[0];
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="/" aria-label="${brand.name}">
        <img src="${brand.logo}" alt="${brand.name}" />
      </a>
      <nav class="navlinks" aria-label="主選單">
        <a href="#featured">精選</a>
        <a href="#library">片庫</a>
        <a href="/sitemap.xml">Sitemap</a>
      </nav>
      <label class="search">
        <span>搜尋</span>
        <input id="searchInput" type="search" placeholder="輸入標題或標籤" value="${escapeHtml(state.query)}" />
      </label>
    </header>

    <main>
      <section id="featured" class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Nocturne Selection</p>
          <h1>${escapeHtml(featured.title)}</h1>
          <p class="summary">夜趣影城使用 mockVideos 作為資料來源，保留分類、標籤、影片詳情頁與 iframe 播放入口，並可部署到 Cloudflare Pages。</p>
          <div class="hero-actions">
            <button class="primary-action" data-play="${featured.id}">播放預覽</button>
            <a class="ghost-action" href="${videoPath(featured)}">影片詳情</a>
          </div>
          <div class="meta-row">
            <span>${escapeHtml(featured.date || "近期更新")}</span>
            ${featured.category.map((cat) => `<a href="/category/${encodeURIComponent(cat)}/">${escapeHtml(cat)}</a>`).join("")}
          </div>
        </div>
        <div class="hero-player" aria-label="播放器預覽">
          ${featured.embed_url ? `<iframe src="${featured.embed_url}" title="${escapeHtml(featured.title)}" allowfullscreen loading="lazy"></iframe>` : `<div class="player-empty"><img src="${brand.icon}" alt="" /><strong>等待接入播放入口</strong><span>目前使用 mockVideos，不載入真實影片。</span></div>`}
        </div>
      </section>

      <section class="ad-placeholder" aria-label="預留版位">
        <span>Reserved Placement</span>
        <strong>970 x 90</strong>
      </section>

      <section id="tags" class="tag-strip" aria-label="標籤篩選">
        ${uniqueTags().map((tag) => `<button class="${tag === state.tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}
      </section>

      <section id="library" class="library">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Library</p>
            <h2>夜趣片庫</h2>
          </div>
          <span>${videos.length} 部影片</span>
        </div>
        <div class="video-grid">
          ${videos.map((video, index) => `
            <article class="video-card" data-video="${video.id}">
              <a class="thumb" href="${videoPath(video)}">
                ${cardArt(video, index)}
                <span class="play-dot">▶</span>
              </a>
              <div class="card-body">
                <h3><a href="${videoPath(video)}">${escapeHtml(video.title)}</a></h3>
                <p>${escapeHtml(video.date || "未標日期")} · ${escapeHtml(video.provider || "source")}</p>
                <div class="chips">
                  ${video.tags.slice(0, 4).map((tag) => `<a href="${tagPath(tag)}">${escapeHtml(tag)}</a>`).join("")}
                </div>
              </div>
            </article>
          `).join("") || `<p class="empty">沒有符合條件的影片。</p>`}
        </div>
      </section>
    </main>

    <footer>
      <img src="${brand.icon}" alt="" />
      <span>${brand.name} · Cloudflare Pages Ready</span>
    </footer>
  `;

  bindEvents();
}

function bindEvents() {
  document.querySelector("#searchInput")?.addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });

  document.querySelectorAll("[data-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tag = button.dataset.tag;
      render();
    });
  });

  document.querySelectorAll("[data-video], [data-play]").forEach((node) => {
    node.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      const id = node.dataset.video || node.dataset.play;
      state.selected = mockVideos.find((video) => video.id === id) || state.selected;
      window.scrollTo({ top: 0, behavior: "smooth" });
      render();
    });
  });
}

render();
