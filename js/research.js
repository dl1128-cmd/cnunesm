/* Research page — NESM Apple-style full-viewport sections */
(function () {
  "use strict";

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("research-root");
    if (!root) return;
    try {
      const topics = await SiteUtils.loadJSON("data/research_topics.json");
      render(root, topics);
    } catch (err) { console.error(err); }
  });

  function render(root, topics) {
    const lang = SiteUtils.getLang();
    const sorted = topics.sort((a, b) => a.order - b.order);

    root.innerHTML = sorted.map((t, idx) => {
      const name = lang === "ko" ? t.title_ko : t.title_en;
      const summary = lang === "ko" ? t.summary_ko : t.summary_en;
      const detail = lang === "ko" ? t.detail_body_ko : t.detail_body_en;
      const papers = (t.representative_papers || []).slice(0, 3);
      const flip = idx % 2 === 1;
      return `
        <section class="research-snap-section" id="${t.id}">
          <div class="research-snap-inner"${flip ? ' style="grid-template-columns: 1fr 1.2fr; direction: rtl;"' : ""}>
            <div class="research-snap-visual"${flip ? ' style="direction: ltr;"' : ""}>${t.svg || ""}</div>
            <div class="research-snap-content"${flip ? ' style="direction: ltr;"' : ""}>
              <div class="eyebrow">0${idx + 1} &middot; ${lang === "ko" ? "연구 주제" : "Research Theme"}</div>
              <h2>${escapeHtml(name)}</h2>
              <p class="research-snap-summary"><strong>${escapeHtml(summary)}</strong></p>
              <p class="research-snap-detail">${escapeHtml(detail || "").split("\n\n").map(p => p.trim()).filter(Boolean).slice(0, 2).join("<br/><br/>")}</p>
              <div class="research-snap-keywords">
                ${(t.keywords || []).map(k => `<span class="kw">${escapeHtml(k)}</span>`).join("")}
              </div>
              ${papers.length ? `
                <div class="research-snap-papers">
                  <div class="eyebrow" style="margin-top:1.5rem">${lang === "ko" ? "대표 논문" : "Representative Papers"}</div>
                  <ul>
                    ${papers.map(p => `<li><span class="pp-title">${escapeHtml(p.title)}</span> <span class="pp-venue">&mdash; ${escapeHtml(p.venue)} (${p.year})</span></li>`).join("")}
                  </ul>
                </div>
              ` : ""}
            </div>
          </div>
        </section>
      `;
    }).join("");
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
})();
