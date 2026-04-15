/* News page */
(function () {
  "use strict";
  const TABS = [{ id: "all", k: "all" }, { id: "news", k: "news" }, { id: "notice", k: "notice" }, { id: "seminar", k: "seminar" }];
  let items = [], cur = "all";

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("board-root");
    if (!root) return;
    try {
      items = await SiteUtils.loadJSON("data/news.json");
      items.sort((a, b) => (a.date < b.date ? 1 : -1));
      renderTabs(root); renderList(root);
    } catch (err) { console.error(err); }
  });

  function renderTabs(root) {
    const i18n = SiteUtils.getI18n();
    const wrap = document.createElement("div");
    wrap.className = "board-tabs";
    TABS.forEach(t => {
      const btn = document.createElement("button");
      btn.className = "board-tab" + (t.id === cur ? " active" : "");
      btn.textContent = t.id === "all" ? (SiteUtils.getLang() === "ko" ? "전체" : "All") : i18n.board[t.k];
      btn.onclick = () => {
        cur = t.id;
        wrap.querySelectorAll(".board-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        renderList(root);
      };
      wrap.appendChild(btn);
    });
    root.appendChild(wrap);
    const host = document.createElement("div"); host.id = "board-list"; root.appendChild(host);
  }

  function renderList(root) {
    const host = root.querySelector("#board-list");
    const lang = SiteUtils.getLang();
    const filtered = cur === "all" ? items : items.filter(x => x.category === cur);
    if (!filtered.length) { host.innerHTML = `<p style="text-align:center;color:var(--c-text-light);padding:3rem 0">No items.</p>`; return; }
    host.innerHTML = `<ul class="news-list">${filtered.map(n => `
      <li class="news-item">
        <div class="date">${n.date}</div>
        <div class="body">
          <div class="title">${escapeHtml(lang === "ko" ? n.title_ko : n.title_en)}</div>
          <div class="excerpt">${escapeHtml(lang === "ko" ? n.body_ko : n.body_en)}</div>
        </div>
      </li>`).join("")}</ul>`;
  }
  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
})();
