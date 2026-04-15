/* Gallery list page — 3-column grid with cover + short description */
(function () {
  "use strict";

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("gallery-root");
    if (!root) return;
    try {
      const items = await SiteUtils.loadJSON("data/gallery.json");
      render(root, items);
    } catch (err) {
      console.error(err);
      root.innerHTML = `<p style="color:var(--c-text-muted)">Failed to load gallery.</p>`;
    }
  });

  function render(root, items) {
    const lang = SiteUtils.getLang();
    const i18n = SiteUtils.getI18n();
    if (!items || items.length === 0) {
      root.innerHTML = `<p style="color:var(--c-text-muted);text-align:center;padding:var(--space-16) 0;">${(i18n?.gallery?.empty) || "No photos yet."}</p>`;
      return;
    }
    const sorted = items.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    root.innerHTML = `<div class="gallery-grid">${
      sorted.map(g => {
        const title = lang === "ko" ? (g.title_ko || g.title_en) : (g.title_en || g.title_ko);
        const summary = lang === "ko" ? (g.summary_ko || g.summary_en) : (g.summary_en || g.summary_ko);
        const cover = g.cover || ((g.images && g.images[0] && g.images[0].src) || "");
        return `
          <a class="gallery-card" href="gallery-detail.html?id=${encodeURIComponent(g.id)}">
            <div class="gallery-cover">
              ${cover ? `<img src="${escapeAttr(cover)}" alt="${escapeAttr(title || "")}" loading="lazy" />` : `<div class="gallery-cover-placeholder">EEML</div>`}
            </div>
            <div class="gallery-card-body">
              ${g.date ? `<div class="gallery-date">${escapeHtml(g.date)}</div>` : ""}
              <h3 class="gallery-title">${escapeHtml(title || "")}</h3>
              ${summary ? `<p class="gallery-summary">${escapeHtml(summary)}</p>` : ""}
              <div class="gallery-cta">${(i18n?.gallery?.read_more) || "Read more →"}</div>
            </div>
          </a>`;
      }).join("")
    }</div>`;
  }

  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
  function escapeAttr(s) { return escapeHtml(s); }
})();
