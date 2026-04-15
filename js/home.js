/* Home page — featured publications, news, citations chart */
(function () {
  "use strict";

  document.addEventListener("site:ready", async () => {
    try {
      const [topics, pubs, news] = await Promise.all([
        SiteUtils.loadJSON("data/research_topics.json"),
        SiteUtils.loadJSON("data/publications.json"),
        SiteUtils.loadJSON("data/news.json")
      ]);
      renderTopics(topics);
      renderFeatured(pubs);
      renderNews(news);
      renderCitationsChart(SiteUtils.getConfig().citations_history || []);
    } catch (err) { console.error(err); }
  });

  // Scholar 비동기 fetch 완료 시 차트 다시 그림
  document.addEventListener("scholar:history", (e) => {
    if (e.detail && e.detail.length) renderCitationsChart(e.detail);
  });

  function renderTopics(topics) {
    const host = document.getElementById("home-topics");
    if (!host) return;
    const lang = SiteUtils.getLang();
    host.innerHTML = topics.sort((a, b) => a.order - b.order).map(t => {
      const name = lang === "ko" ? t.title_ko : t.title_en;
      const desc = lang === "ko" ? t.summary_ko : t.summary_en;
      return `
        <a class="topic-card" href="research.html#${t.id}">
          <div class="topic-svg">${t.svg || ""}</div>
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(desc)}</p>
          <div class="keywords">${(t.keywords || []).map(k => `<span class="kw">${escapeHtml(k)}</span>`).join("")}</div>
          <div class="topic-cta">${lang === "ko" ? "자세히 보기 →" : "Read more →"}</div>
        </a>
      `;
    }).join("");
  }

  function renderFeatured(pubs) {
    const host = document.getElementById("home-featured");
    if (!host) return;
    const top = pubs.filter(p => p.top_pick).slice(0, 3);
    host.innerHTML = top.map(p => `
      <a class="featured-card" href="publications.html">
        <div class="meta-top"><span>${escapeHtml(p.venue)}</span><span class="year">${p.year}</span></div>
        <h3>${escapeHtml(p.title)}</h3>
        <div class="authors">${escapeHtml(truncate(p.authors, 110))}</div>
      </a>
    `).join("");
  }

  function renderNews(news) {
    const host = document.getElementById("home-news");
    if (!host) return;
    const lang = SiteUtils.getLang();
    const sorted = [...news].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
    host.innerHTML = sorted.map(n => `
      <li>
        <a href="board.html">
          <span class="date">${n.date}</span>
          <span class="title">${escapeHtml(lang === "ko" ? n.title_ko : n.title_en)}</span>
        </a>
      </li>
    `).join("");
  }

  function renderCitationsChart(history) {
    const host = document.getElementById("citations-chart");
    if (!host) return;
    if (!history.length) {
      host.innerHTML = `<p style="text-align:center;color:var(--c-text-light);padding:3rem 0;font-size:.875rem">Loading from Google Scholar...</p>`;
      return;
    }
    const W = 720, H = 280;
    const PAD_L = 50, PAD_R = 20, PAD_T = 30, PAD_B = 38;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;
    const maxN = Math.max(...history.map(d => d.n));
    const x = i => PAD_L + (innerW * i) / Math.max(1, history.length - 1);
    const y = n => PAD_T + innerH - (innerH * n) / maxN;

    const linePath = history.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.n)}`).join(" ");
    const areaPath = `${linePath} L${x(history.length - 1)},${PAD_T + innerH} L${x(0)},${PAD_T + innerH} Z`;

    // Y-axis ticks (4 levels)
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(maxN * t));

    host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Citations per year">
        ${yTicks.map(v => `
          <line class="grid-line" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y(v)}" y2="${y(v)}" />
          <text class="axis-label" x="${PAD_L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>
        `).join("")}
        <path class="area-fill" d="${areaPath}" />
        <path class="line" d="${linePath}" />
        ${history.map((d, i) => `
          <circle class="point" cx="${x(i)}" cy="${y(d.n)}" r="3.5" />
          <text class="axis-label" x="${x(i)}" y="${H - PAD_B + 18}" text-anchor="middle">${d.year}</text>
          <text class="point-label" x="${x(i)}" y="${y(d.n) - 12}">${d.n}</text>
        `).join("")}
      </svg>
    `;
  }

  function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
})();
