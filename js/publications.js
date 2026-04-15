/* Publications page — type filter + year filter + Scholar auto-cite update */
(function () {
  "use strict";

  const TYPE_FILTERS = [
    { id: "top", lk: "Selected", lk_ko: "대표 논문", test: p => p.top_pick === true },
    { id: "journal", lk: "Journal", lk_ko: "저널", test: p => p.type === "journal" },
    { id: "conference", lk: "Conference", lk_ko: "학회", test: p => p.type === "conference" },
    { id: "book", lk: "Book / Patent", lk_ko: "저서·특허", test: p => p.type === "book" || p.type === "patent" },
    { id: "all", lk: "All", lk_ko: "전체", test: () => true }
  ];

  let pubs = [];
  let curType = "all";
  let curYear = "all";  // "all" or a year number

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("publications-root");
    if (!root) return;
    try {
      pubs = await SiteUtils.loadJSON("data/publications.json");
      renderAll(root);
    } catch (err) { console.error(err); }
  });

  // Scholar fetch 완료 시 citations 매칭 + 재렌더
  document.addEventListener("scholar:papers", (e) => {
    const scholarPapers = e.detail || [];
    if (!pubs.length || !scholarPapers.length) return;
    const scholarMap = new Map();
    scholarPapers.forEach(sp => scholarMap.set(normalize(sp.title), sp));

    let matched = 0;
    pubs.forEach(p => {
      const sp = scholarMap.get(normalize(p.title));
      if (sp) {
        if (sp.citations > 0) { p.citations = sp.citations; matched++; }
        if (sp.scholar_link) p.scholar_link = sp.scholar_link;
      }
    });
    if (matched > 0) {
      const root = document.getElementById("publications-root");
      if (root) renderAll(root);
    }
  });

  function renderAll(root) {
    root.innerHTML = "";
    renderFilters(root);
    renderList(root);
  }

  function renderFilters(root) {
    const lang = SiteUtils.getLang();

    // Type filter
    const typeWrap = document.createElement("div");
    typeWrap.className = "pub-filters";
    TYPE_FILTERS.forEach(f => {
      const count = pubs.filter(f.test).length;
      const btn = document.createElement("button");
      btn.className = "pub-filter" + (f.id === curType ? " active" : "");
      btn.innerHTML = `${lang === "ko" ? f.lk_ko : f.lk} <span class="pub-filter-count">${count}</span>`;
      btn.onclick = () => {
        curType = f.id;
        renderAll(root);
      };
      typeWrap.appendChild(btn);
    });
    root.appendChild(typeWrap);

    // Year filter
    const years = [...new Set(pubs.map(p => p.year))].sort((a, b) => b - a);
    const yearWrap = document.createElement("div");
    yearWrap.className = "pub-year-filters";
    const yearLabel = document.createElement("span");
    yearLabel.className = "pub-year-label";
    yearLabel.textContent = lang === "ko" ? "연도 " : "Year ";
    yearWrap.appendChild(yearLabel);

    const addYearBtn = (val, label) => {
      const btn = document.createElement("button");
      btn.className = "pub-year-btn" + (String(curYear) === String(val) ? " active" : "");
      btn.textContent = label;
      btn.onclick = () => {
        curYear = val;
        renderAll(root);
      };
      yearWrap.appendChild(btn);
    };

    addYearBtn("all", lang === "ko" ? "전체" : "All");
    years.forEach(y => addYearBtn(y, y));
    root.appendChild(yearWrap);

    const host = document.createElement("div");
    host.id = "pub-list-host";
    root.appendChild(host);
  }

  function renderList(root) {
    const host = root.querySelector("#pub-list-host");
    const tf = TYPE_FILTERS.find(x => x.id === curType);
    let filtered = pubs.filter(tf.test);
    if (curYear !== "all") filtered = filtered.filter(p => p.year === curYear);

    // Total count header
    const countHeader = `<div class="pub-count-header"><span class="pub-count-num">${filtered.length}</span> <span class="pub-count-lbl">of ${pubs.length} publications</span>${curType !== "all" || curYear !== "all" ? ` <button class="pub-count-reset" id="pub-reset">Clear filters ×</button>` : ""}</div>`;

    if (!filtered.length) {
      host.innerHTML = countHeader + `<p style="text-align:center;color:var(--c-text-light);padding:3rem 0">No publications match. Click <b>Clear filters</b>.</p>`;
    } else {
      const byYear = filtered.reduce((acc, p) => { (acc[p.year] ||= []).push(p); return acc; }, {});
      host.innerHTML = countHeader + Object.keys(byYear).sort((a, b) => b - a).map(year => {
        return `<section class="pub-year-group"><h3>${year}</h3><ul class="pub-list">${byYear[year].map((p, i) => itemHTML(p, i + 1)).join("")}</ul></section>`;
      }).join("");
    }

    const resetBtn = host.querySelector("#pub-reset");
    if (resetBtn) resetBtn.onclick = () => { curType = "all"; curYear = "all"; renderAll(root); };
  }

  function itemHTML(p, n) {
    const top = p.top_pick ? `<span class="badge-top">Selected</span>` : "";
    const href = resolveLink(p);
    const attrs = href.startsWith("data:")
      ? `download="${escapeHtml((typeof p.link === "object" && p.link.name) || "paper.pdf")}"`
      : `target="_blank" rel="noopener"`;
    const titleEl = href ? `<a href="${href}" ${attrs}>${escapeHtml(p.title)}</a>` : escapeHtml(p.title);
    return `
      <li class="pub-item">
        <div class="pub-num">${String(n).padStart(2, "0")}</div>
        <div class="pub-body">
          <div class="title">${titleEl}${top}</div>
          <div class="meta">${escapeHtml(p.authors)} · <span class="venue">${escapeHtml(p.venue)}</span>${p.volume ? ", " + escapeHtml(p.volume) : ""} (${p.year})</div>
        </div>
        <div class="cite-count"><span class="n">${p.citations ?? 0}</span><span class="lbl">cites</span></div>
      </li>`;
  }

  function resolveLink(p) {
    // Priority: uploaded PDF → explicit URL → DOI → Scholar link → Scholar search fallback
    if (p.link) {
      if (typeof p.link === "object" && p.link.dataUrl) return p.link.dataUrl;
      if (typeof p.link === "string" && p.link) return p.link;
    }
    if (p.doi) {
      const doi = String(p.doi).trim();
      return doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
    }
    if (p.scholar_link) return p.scholar_link;
    // Fallback — search by title on Scholar
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(p.title)}`;
  }

  function normalize(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
})();
