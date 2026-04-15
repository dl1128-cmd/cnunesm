/* Member page — Current / Alumni tabs */
(function () {
  "use strict";
  const CURRENT_ROLES = ["professor", "postdoc", "phd", "ms", "undergraduate"];
  const ALUMNI_ROLES = ["alumni"];
  const ROLE_LABELS_EN = {
    professor: "Principal Investigator",
    postdoc: "Postdoctoral Researchers",
    phd: "Ph.D. Students",
    ms: "M.S. Students",
    undergraduate: "Undergraduate Researchers",
    alumni: "Alumni"
  };
  const ROLE_LABELS_KO = {
    professor: "책임연구자",
    postdoc: "박사후연구원",
    phd: "박사과정",
    ms: "석사과정",
    undergraduate: "학부연구원",
    alumni: "졸업생"
  };

  let allMembers = [];
  let curTab = "current";

  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("members-root");
    if (!root) return;
    try {
      allMembers = await SiteUtils.loadJSON("data/members.json");
      render(root);
    } catch (err) { console.error(err); }
  });

  function render(root) {
    const lang = SiteUtils.getLang();
    const currentCount = allMembers.filter(m => CURRENT_ROLES.includes(m.role)).length;
    const alumniCount = allMembers.filter(m => ALUMNI_ROLES.includes(m.role)).length;

    const tabs = `
      <div class="member-tabs">
        <button class="member-tab ${curTab === "current" ? "active" : ""}" data-tab="current">
          ${lang === "ko" ? "현재 구성원" : "Current"} <span class="member-tab-count">${currentCount}</span>
        </button>
        <button class="member-tab ${curTab === "alumni" ? "active" : ""}" data-tab="alumni">
          ${lang === "ko" ? "졸업생" : "Alumni"} <span class="member-tab-count">${alumniCount}</span>
        </button>
      </div>
    `;

    const activeRoles = curTab === "current" ? CURRENT_ROLES : ALUMNI_ROLES;
    const filtered = allMembers.filter(m => activeRoles.includes(m.role));
    const grouped = {};
    filtered.forEach(m => { (grouped[m.role] ||= []).push(m); });

    const sections = activeRoles.filter(r => grouped[r]?.length).map(role => {
      const labels = lang === "ko" ? ROLE_LABELS_KO : ROLE_LABELS_EN;
      const cards = grouped[role].map(m => renderCard(m, lang, role)).join("");
      const openCard = curTab === "current" && ["phd", "ms", "undergraduate"].includes(role) ? renderOpenCard(role, lang) : "";
      return `
        <section class="member-group">
          <div class="group-head">
            <h3>${labels[role]}</h3>
            <span class="count">${String(grouped[role].length).padStart(2, "0")}</span>
          </div>
          <div class="member-grid">${cards}${openCard}</div>
        </section>`;
    }).join("");

    const emptyMsg = !filtered.length
      ? `<p style="text-align:center;color:var(--c-text-light);padding:3rem 0">${lang === "ko" ? "등록된 구성원이 없습니다." : "No members listed yet."}</p>`
      : "";

    root.innerHTML = tabs + sections + emptyMsg;

    root.querySelectorAll(".member-tab").forEach(btn => {
      btn.onclick = () => { curTab = btn.dataset.tab; render(root); };
    });
  }

  function renderCard(m, lang, role) {
    const nameKo = m.name_ko || "";
    const nameEn = m.name_en || "";
    const title = lang === "ko" ? m.title_ko : m.title_en;
    const summary = lang === "ko" ? m.summary_ko : m.summary_en;
    const tags = lang === "ko" ? (m.tags_ko || []) : (m.tags_en || []);

    const isPI = role === "professor";
    const tag = isPI ? "a" : "div";
    const href = isPI ? `href="pi.html"` : "";
    const photoEl = m.photo
      ? `<img class="photo" src="${escapeAttr(m.photo)}" alt="${escapeAttr(nameEn || nameKo)}" onerror="this.outerHTML='<div class=photo>${escapeAttr(initials(nameEn || nameKo))}</div>'" />`
      : `<div class="photo">${escapeHtml(initials(nameEn || nameKo))}</div>`;

    const joinedLine = m.joined ? `<span class="joined">since ${escapeHtml(m.joined)}</span>` : "";

    return `
      <${tag} class="member-card" data-role="${role}" ${href}>
        ${photoEl}
        <div class="name-row">
          <span class="name-ko">${escapeHtml(nameKo)}</span>
          <span class="name-en">${escapeHtml(nameEn)}</span>
        </div>
        <div class="role-line">
          <span>${escapeHtml(title || "")}</span>
          ${m.joined ? `<span class="dot">·</span>${joinedLine}` : ""}
        </div>
        ${summary ? `<div class="summary">${escapeHtml(summary)}</div>` : ""}
        ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag-mini">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        ${m.email ? `<div class="email-row"><a href="mailto:${m.email}">✉ ${m.email}</a></div>` : ""}
      </${tag}>`;
  }

  function renderOpenCard(role, lang) {
    const labels = {
      phd: { ko: "박사과정 모집", en: "Ph.D. Position Open" },
      ms: { ko: "석사과정 모집", en: "M.S. Position Open" },
      undergraduate: { ko: "학부연구원 모집", en: "Undergrad Researcher Position" }
    };
    const desc = {
      phd: { ko: "전고체/리튬이온 전지에 진지한 관심이 있는 박사 지원자.", en: "Serious applicants in solid-state and Li-ion batteries." },
      ms: { ko: "배터리 소재·공정 연구에 열정이 있는 석사 지원자.", en: "Motivated MS applicants in battery materials and processing." },
      undergraduate: { ko: "실험실 경험을 쌓고 싶은 학부생.", en: "Undergrads seeking hands-on research experience." }
    };
    const lbl = labels[role][lang];
    const dsc = desc[role][lang];
    return `
      <a class="member-card-open" href="contact.html">
        <div class="icon">+</div>
        <h4>${lbl}</h4>
        <p>${dsc}</p>
        <span class="arrow">Get in touch →</span>
      </a>`;
  }

  function initials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
  function escapeAttr(s) { return escapeHtml(s); }
})();
