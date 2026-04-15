/* Gallery detail page — renders one gallery entry with all images + lightbox */
(function () {
  "use strict";

  let CURRENT_IMAGES = [];
  let CURRENT_IDX = 0;

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("gallery-detail-root");
    if (!root) return;
    try {
      const items = await SiteUtils.loadJSON("data/gallery.json");
      render(root, items);
      setupLightbox();
    } catch (err) {
      console.error(err);
      root.innerHTML = `<section class="section"><div class="container-narrow"><p>Failed to load gallery entry.</p></div></section>`;
    }
  });

  function render(root, items) {
    const lang = SiteUtils.getLang();
    const i18n = SiteUtils.getI18n();
    const id = new URLSearchParams(location.search).get("id");
    const sorted = (items || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const entry = sorted.find(g => g.id === id) || sorted[0];
    if (!entry) {
      root.innerHTML = `
        <section class="section">
          <div class="container-narrow">
            <div class="eyebrow"><a href="gallery.html" style="color:inherit">${(i18n?.gallery?.back) || "← Gallery"}</a></div>
            <h1>Not Found</h1>
            <p style="color:var(--c-text-muted)">${(i18n?.gallery?.empty) || "No photos yet."}</p>
          </div>
        </section>`;
      return;
    }
    const idx = sorted.findIndex(g => g.id === entry.id);
    const prev = sorted[(idx - 1 + sorted.length) % sorted.length];
    const next = sorted[(idx + 1) % sorted.length];

    const title = lang === "ko" ? (entry.title_ko || entry.title_en) : (entry.title_en || entry.title_ko);
    const summary = lang === "ko" ? (entry.summary_ko || entry.summary_en) : (entry.summary_en || entry.summary_ko);
    const body = lang === "ko" ? (entry.body_ko || entry.body_en || "") : (entry.body_en || entry.body_ko || "");
    const images = (entry.images && entry.images.length) ? entry.images : (entry.cover ? [{ src: entry.cover }] : []);
    CURRENT_IMAGES = images;

    document.title = `${title || "Gallery"} · Gallery · EEML`;

    root.innerHTML = `
      <section class="page-header">
        <div class="container-narrow">
          <div class="eyebrow"><a href="gallery.html" style="color:inherit">${(i18n?.gallery?.back) || "← Gallery"}</a></div>
          <h1>${escapeHtml(title || "")}</h1>
          ${entry.date ? `<div class="gallery-date" style="margin-top:var(--space-2);">${escapeHtml(entry.date)}</div>` : ""}
          ${summary ? `<p style="max-width:680px;margin-top:var(--space-4);">${escapeHtml(summary)}</p>` : ""}
        </div>
      </section>

      <section class="section" style="padding-top: var(--space-12);">
        <div class="container-narrow">
          ${body ? `<div class="detail-body">${body.split("\n\n").map(p => `<p>${escapeHtml(p)}</p>`).join("")}</div>` : ""}

          ${images.length ? `
            <div class="gallery-detail-grid">
              ${images.map((im, i) => {
                const cap = lang === "ko" ? (im.caption_ko || im.caption_en || "") : (im.caption_en || im.caption_ko || "");
                return `
                  <figure class="gallery-detail-item" data-idx="${i}">
                    <img src="${escapeAttr(im.src)}" alt="${escapeAttr(cap)}" loading="lazy" />
                    ${cap ? `<figcaption>${escapeHtml(cap)}</figcaption>` : ""}
                  </figure>`;
              }).join("")}
            </div>` : ""}

          <hr class="divider" />
          <div class="topic-nav">
            <a class="topic-nav-link prev" href="gallery-detail.html?id=${encodeURIComponent(prev.id)}">
              <span class="topic-nav-dir">${(i18n?.gallery?.prev) || "← Previous"}</span>
              <span class="topic-nav-name">${escapeHtml(lang === "ko" ? (prev.title_ko || prev.title_en) : (prev.title_en || prev.title_ko))}</span>
            </a>
            <a class="topic-nav-link next" href="gallery-detail.html?id=${encodeURIComponent(next.id)}">
              <span class="topic-nav-dir">${(i18n?.gallery?.next) || "Next →"}</span>
              <span class="topic-nav-name">${escapeHtml(lang === "ko" ? (next.title_ko || next.title_en) : (next.title_en || next.title_ko))}</span>
            </a>
          </div>
        </div>
      </section>`;

    // Attach lightbox click handlers
    root.querySelectorAll(".gallery-detail-item").forEach(el => {
      el.addEventListener("click", () => openLightbox(parseInt(el.dataset.idx, 10)));
    });
  }

  function setupLightbox() {
    const box = document.getElementById("lightbox");
    if (!box) return;
    box.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
    box.querySelector(".lightbox-prev").addEventListener("click", () => move(-1));
    box.querySelector(".lightbox-next").addEventListener("click", () => move(1));
    box.addEventListener("click", (e) => { if (e.target === box) closeLightbox(); });
    document.addEventListener("keydown", (e) => {
      if (box.hidden) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
    });
  }

  function openLightbox(idx) {
    if (!CURRENT_IMAGES.length) return;
    CURRENT_IDX = idx;
    showCurrent();
    document.getElementById("lightbox").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    document.getElementById("lightbox").hidden = true;
    document.body.style.overflow = "";
  }

  function move(delta) {
    if (!CURRENT_IMAGES.length) return;
    CURRENT_IDX = (CURRENT_IDX + delta + CURRENT_IMAGES.length) % CURRENT_IMAGES.length;
    showCurrent();
  }

  function showCurrent() {
    const lang = SiteUtils.getLang();
    const im = CURRENT_IMAGES[CURRENT_IDX];
    if (!im) return;
    const cap = lang === "ko" ? (im.caption_ko || im.caption_en || "") : (im.caption_en || im.caption_ko || "");
    document.getElementById("lightbox-img").src = im.src;
    document.getElementById("lightbox-caption").textContent = cap;
  }

  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
  function escapeAttr(s) { return escapeHtml(s); }
})();
