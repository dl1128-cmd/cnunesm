/* PI detail page — NESM Lab */
(function () {
  "use strict";
  document.addEventListener("site:ready", async () => {
    const root = document.getElementById("pi-root");
    if (!root) return;
    try {
      const pi = await SiteUtils.loadJSON("data/pi.json");
      render(root, pi);
    } catch (err) { console.error(err); }
  });

  function render(root, pi) {
    const lang = SiteUtils.getLang();
    const name = lang === "ko" ? pi.name_ko : pi.name_en;
    // support both 'title_ko/en' (NESM schema) and 'position' fallback
    const title = lang === "ko" ? (pi.title_ko || pi.position) : (pi.title_en || pi.position);
    const aff = lang === "ko" ? pi.affiliation_ko : pi.affiliation_en;
    const bio = lang === "ko" ? (pi.bio_ko || pi.bio_en) : (pi.bio_en || pi.bio_ko);
    const interests = lang === "ko" ? pi.interests_ko : pi.interests_en;

    const photoEl = pi.photo
      ? `<img src="${escapeAttr(pi.photo)}" alt="${escapeAttr(name)}" />`
      : `<div class="photo-initials">${escapeHtml(initials(name))}</div>`;

    // Links (Scholar, CNU profile, etc.)
    const links = (pi.links || []).map(l =>
      `<a href="${escapeAttr(l.url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">${escapeHtml(l.label)} ↗</a>`
    ).join("");

    // CV button
    let cvBtn = "";
    const cv = pi.cv;
    if (cv) {
      if (typeof cv === "object" && cv.dataUrl) {
        cvBtn = `<a href="${cv.dataUrl}" download="${escapeHtml(cv.name || 'CV.pdf')}" class="btn btn-outline btn-sm">↓ Download CV</a>`;
      } else if (typeof cv === "string" && cv) {
        cvBtn = `<a href="${cv}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">↓ CV</a>`;
      }
    }

    // Office / contact details
    const office = pi.office || {};
    const building = lang === "ko" ? (office.building_ko || "") : (office.building_en || "");
    const room = office.room ? `Rm. ${office.room}` : "";
    const phone = office.phone || pi.phone || "";
    const officeLines = [building, room].filter(Boolean).join(", ");

    let contactSection = "";
    if (officeLines || phone || pi.email) {
      contactSection = `
        <section class="pi-section">
          <h2>${lang === "ko" ? "연락처" : "Contact"}</h2>
          <ul class="pi-contact-list">
            ${pi.email ? `<li><span class="label">${lang === "ko" ? "이메일" : "Email"}</span> <a href="mailto:${pi.email}">${escapeHtml(pi.email)}</a></li>` : ""}
            ${officeLines ? `<li><span class="label">${lang === "ko" ? "연구실" : "Office"}</span> ${escapeHtml(officeLines)}</li>` : ""}
            ${room && !officeLines.includes(room) ? "" : ""}
            ${phone ? `<li><span class="label">${lang === "ko" ? "전화" : "Phone"}</span> ${escapeHtml(phone)}</li>` : ""}
          </ul>
        </section>`;
    }

    root.innerHTML = `
      <div class="pi-hero">
        <div class="pi-photo">${photoEl}</div>
        <div class="pi-info">
          <div class="role">${escapeHtml(title || "")}</div>
          <h1>${escapeHtml(name)}</h1>
          <div class="affiliation">${escapeHtml(aff || "")}</div>
          <div class="bio">${escapeHtml(bio || "")}</div>
          <div class="pi-actions">
            ${pi.email ? `<a href="mailto:${pi.email}" class="btn btn-primary">✉ ${escapeHtml(pi.email)}</a>` : ""}
            ${cvBtn}
            ${links}
          </div>

          ${interests && interests.length ? `
            <section class="pi-section">
              <h2>${lang === "ko" ? "관심 연구 분야" : "Research Interests"}</h2>
              <ul class="pi-interests">${interests.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
            </section>` : ""}

          ${renderTimeline(
            pi.education,
            lang === "ko" ? "학력" : "Education",
            e => ({
              p: e.period || "",
              t: `${lang === "ko" ? e.degree_ko : e.degree_en}${(e.field_ko || e.field_en) ? " · " + (lang === "ko" ? e.field_ko : e.field_en) : ""}${e.advisor ? " (" + e.advisor + ")" : ""}`,
              o: lang === "ko" ? e.institution_ko : e.institution_en
            })
          )}

          ${renderTimeline(
            pi.experience,
            lang === "ko" ? "경력" : "Experience",
            e => ({
              p: lang === "ko" ? e.period_ko : e.period_en,
              t: lang === "ko" ? e.role_ko : e.role_en,
              o: lang === "ko" ? e.org_ko : e.org_en
            })
          )}

          ${renderTimeline(
            pi.grants,
            lang === "ko" ? "수행 연구 과제" : "Research Grants",
            g => ({
              p: lang === "ko" ? g.period_ko : g.period_en,
              t: `${lang === "ko" ? g.title_ko : g.title_en}${(g.role_ko || g.role_en) ? " · " + (lang === "ko" ? g.role_ko : g.role_en) : ""}`,
              o: lang === "ko" ? g.agency_ko : g.agency_en
            })
          )}

          ${renderTimeline(
            pi.awards,
            lang === "ko" ? "수상" : "Awards",
            a => ({
              p: String(a.year),
              t: lang === "ko" ? a.title_ko : a.title_en,
              o: lang === "ko" ? (a.org_ko || "") : (a.org_en || "")
            })
          )}

          ${contactSection}
        </div>
      </div>`;
  }

  function renderTimeline(items, title, map) {
    if (!items || !items.length) return "";
    const lis = items.map(it => {
      const m = map(it);
      return `<li>
        <div class="period">${escapeHtml(m.p || "")}</div>
        <div>
          <div class="title-text">${escapeHtml(m.t || "")}</div>
          ${m.o ? `<div class="org">${escapeHtml(m.o)}</div>` : ""}
        </div>
      </li>`;
    }).join("");
    return `<section class="pi-section"><h2>${escapeHtml(title)}</h2><ul class="pi-timeline">${lis}</ul></section>`;
  }

  function initials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function escapeAttr(s) { return escapeHtml(s); }
})();
