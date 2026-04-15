/* NESM — common site scripts: i18n, theme, nav, scroll reveal, data loading */
(function () {
  "use strict";

  const LS_LANG = "nesm:lang";
  const LS_THEME = "nesm:theme";

  const state = { lang: detectLang(), theme: detectTheme(), i18n: null, config: null };

  function detectLang() {
    const fromUrl = new URLSearchParams(location.search).get("lang");
    if (fromUrl === "ko" || fromUrl === "en") return fromUrl;
    const saved = localStorage.getItem(LS_LANG);
    if (saved === "ko" || saved === "en") return saved;
    return (navigator.language || "en").startsWith("ko") ? "ko" : "en";
  }

  function detectTheme() {
    const saved = localStorage.getItem(LS_THEME);
    if (saved === "light" || saved === "dark") return saved;
    return null; // follow system
  }

  async function loadJSON(path) {
    const res = await fetch(path + (path.includes("?") ? "&" : "?") + "t=" + Date.now());
    if (!res.ok) throw new Error(`Failed: ${path}`);
    return res.json();
  }

  async function init() {
    document.documentElement.lang = state.lang;
    if (state.theme) document.documentElement.setAttribute("data-theme", state.theme);
    try {
      const [i18n, config] = await Promise.all([
        loadJSON(`locales/${state.lang}.json`),
        loadJSON("data/config.json")
      ]);
      state.i18n = i18n;
      state.config = config;
      window.__SITE__ = state;
      applyI18n();
      applyConfig();
      setupNav();
      setupLangToggle();
      setupTheme();
      setupScrollReveal();
      setupHashScroll();
      document.dispatchEvent(new CustomEvent("site:ready", { detail: state }));
      // Non-blocking
      trackVisit().catch(() => {});
      showAnnouncement().catch(() => {});
      autoUpdateScholarMetrics().catch(() => {});
    } catch (err) {
      console.error("Site init failed:", err);
    }
  }

  /* =========================================================================
   * Visitor counter — uses counterapi.dev (free, no signup, anonymous)
   * Increments per-day, per-month, and total counters once per session.
   * ========================================================================= */
  const STATS_NS = "nesm-hoonhee-ryu-2026"; // unique namespace for this site
  const STATS_BASE = "https://api.counterapi.dev/v1/" + STATS_NS;

  async function trackVisit() {
    if (sessionStorage.getItem("nesm:visit:tracked")) return;
    sessionStorage.setItem("nesm:visit:tracked", "1");
    const today = new Date().toISOString().slice(0, 10);  // 2026-04-15
    const month = today.slice(0, 7);                       // 2026-04
    const keys = ["total", "day-" + today, "month-" + month];
    await Promise.allSettled(keys.map(k => fetch(`${STATS_BASE}/${k}/up`, { mode: "cors" })));
  }

  /* =========================================================================
   * Scholar metrics auto-fetch
   * Fetches Google Scholar HTML via CORS proxies and parses citations/h-index/i10.
   * Cached in localStorage for 24h to reduce calls.
   * ========================================================================= */
  const SCHOLAR_CACHE_KEY = "nesm:scholar:cache:v3"; // bump when schema changes
  const SCHOLAR_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

  async function fetchScholarMetrics(scholarId) {
    const url = `https://scholar.google.com/citations?user=${scholarId}&hl=en&cstart=0&pagesize=100`;
    const proxies = [
      "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(url),
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
      "https://corsproxy.io/?" + encodeURIComponent(url)
    ];
    for (const p of proxies) {
      try {
        const r = await fetch(p);
        if (!r.ok) continue;
        const html = await r.text();
        const stats = [...html.matchAll(/<td class="gsc_rsb_std">(\d+)<\/td>/g)].map(m => parseInt(m[1]));
        if (stats.length < 6) continue;

        // Per-year citation chart — gsc_g_t for years (x-axis), gsc_g_al for counts (bars)
        const years = [...html.matchAll(/<span class="gsc_g_t"[^>]*>(\d{4})<\/span>/g)].map(m => parseInt(m[1]));
        const counts = [...html.matchAll(/<span class="gsc_g_al">(\d+)<\/span>/g)].map(m => parseInt(m[1]));
        // Counts may be fewer than years (years with 0 cites are skipped in HTML).
        // Reconstruct via title attribute on the anchor: <a class="gsc_g_a" ... title="N">
        let history = [];
        if (years.length && counts.length === years.length) {
          history = years.map((y, i) => ({ year: y, n: counts[i] }));
        } else if (years.length) {
          // Try parsing each gsc_g_a with style left position to align with years
          const bars = [...html.matchAll(/<a[^>]*class="gsc_g_a"[^>]*style="[^"]*left:(\d+)px[^"]*z-index:(\d+)[^"]*"[^>]*>\s*<span class="gsc_g_al">(\d+)<\/span>/g)];
          // Map by z-index → reverse year index (Scholar uses z-index = year-index reversed)
          const yearMap = {};
          bars.forEach(b => {
            const zi = parseInt(b[2]); // z-index
            const n = parseInt(b[3]);
            const yearIdx = years.length - zi;
            if (yearIdx >= 0 && yearIdx < years.length) yearMap[years[yearIdx]] = n;
          });
          history = years.map(y => ({ year: y, n: yearMap[y] || 0 }));
        }

        // Per-paper citation counts — parse the publications table
        const papers = [];
        const rowRegex = /<tr class="gsc_a_tr">([\s\S]*?)<\/tr>/g;
        let rowMatch;
        while ((rowMatch = rowRegex.exec(html)) !== null) {
          const row = rowMatch[1];
          const titleMatch = row.match(/<a[^>]*class="gsc_a_at"[^>]*>([^<]+)<\/a>/);
          const citeMatch = row.match(/<a[^>]*class="gsc_a_ac[^"]*"[^>]*>(\d+)<\/a>/);
          const yearMatch = row.match(/class="gsc_a_h gsc_a_hc gs_ibl"[^>]*>(\d{4})</);
          const linkMatch = row.match(/<a[^>]*class="gsc_a_at"[^>]*href="([^"]+)"/);
          if (titleMatch) {
            papers.push({
              title: titleMatch[1].trim(),
              citations: citeMatch ? parseInt(citeMatch[1]) : 0,
              year: yearMatch ? parseInt(yearMatch[1]) : 0,
              scholar_link: linkMatch ? ("https://scholar.google.com" + linkMatch[1].replace(/&amp;/g, "&")) : ""
            });
          }
        }

        return {
          citations_total: stats[0],
          citations_recent5y: stats[1],
          h_index: stats[2],
          i10_index: stats[4],
          as_of: new Date().toISOString().slice(0, 7),
          citations_history: history,
          papers: papers
        };
      } catch {}
    }
    return null;
  }

  async function autoUpdateScholarMetrics() {
    const config = state.config;
    if (!config?.pi?.scholar) return;
    const scholarId = (config.pi.scholar.match(/user=([^&]+)/) || [])[1];
    if (!scholarId) return;
    // Check cache
    try {
      const cached = JSON.parse(localStorage.getItem(SCHOLAR_CACHE_KEY) || "null");
      if (cached && (Date.now() - cached.t) < SCHOLAR_CACHE_TTL) {
        applyScholarMetrics(cached.data);
        return;
      }
    } catch {}
    // Fetch fresh
    const metrics = await fetchScholarMetrics(scholarId);
    if (!metrics) return;
    localStorage.setItem(SCHOLAR_CACHE_KEY, JSON.stringify({ t: Date.now(), data: metrics }));
    applyScholarMetrics(metrics);
  }

  function applyScholarMetrics(metrics) {
    if (!metrics) return;
    Object.assign(state.config.metrics, metrics);
    document.querySelectorAll("[data-metric]").forEach(el => {
      const k = el.getAttribute("data-metric");
      const v = metrics[k];
      if (v !== undefined) el.textContent = typeof v === "number" ? v.toLocaleString() : v;
    });
    if (metrics.citations_history && metrics.citations_history.length) {
      state.config.citations_history = metrics.citations_history;
      document.dispatchEvent(new CustomEvent("scholar:history", { detail: metrics.citations_history }));
    }
    if (metrics.papers && metrics.papers.length) {
      document.dispatchEvent(new CustomEvent("scholar:papers", { detail: metrics.papers }));
    }
  }

  window.SiteUtils = window.SiteUtils || {};
  window.SiteUtils.fetchScholar = fetchScholarMetrics;
  window.SiteUtils.fetchStat = async (key) => {
    try {
      const r = await fetch(`${STATS_BASE}/${key}`, { mode: "cors" });
      if (!r.ok) return 0;
      const j = await r.json();
      return j.count ?? j.value ?? 0;
    } catch { return 0; }
  };

  /* =========================================================================
   * Announcement popup (modal)
   * Reads data/announcement.json. Shows once per announcement-id per browser.
   * ========================================================================= */
  async function showAnnouncement() {
    let ann;
    try {
      const res = await fetch("data/announcement.json?t=" + Date.now());
      if (!res.ok) return;
      ann = await res.json();
    } catch { return; }
    if (!ann || !ann.enabled) return;
    if (ann.expires) {
      const exp = new Date(ann.expires);
      if (!isNaN(exp) && exp < new Date()) return;
    }
    const dismissedKey = "nesm:ann:dismissed:" + (ann.id || "default");
    if (localStorage.getItem(dismissedKey)) return;

    const lang = state.lang;
    const title = lang === "ko" ? ann.title_ko : ann.title_en;
    const body = lang === "ko" ? ann.body_ko : ann.body_en;
    const btnText = lang === "ko" ? (ann.button_text_ko || "확인") : (ann.button_text_en || "OK");
    const btnUrl = ann.button_url || "";

    const modal = document.createElement("div");
    modal.className = "ann-modal";
    modal.innerHTML = `
      <div class="ann-backdrop"></div>
      <div class="ann-box" role="dialog" aria-modal="true" aria-labelledby="ann-title">
        <button class="ann-close" aria-label="close">✕</button>
        <div class="ann-eyebrow">${lang === "ko" ? "공지" : "Announcement"}</div>
        <h2 id="ann-title" class="ann-title">${escapeHtml(title || "")}</h2>
        <p class="ann-body">${escapeHtml(body || "")}</p>
        <div class="ann-actions">
          ${btnUrl ? `<a href="${btnUrl}" class="btn btn-primary ann-cta">${escapeHtml(btnText)} →</a>` : ""}
          <button class="btn btn-ghost ann-dismiss">${lang === "ko" ? "다시 보지 않기" : "Don't show again"}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add("show"));

    const close = (dismiss) => {
      if (dismiss) localStorage.setItem(dismissedKey, "1");
      modal.classList.remove("show");
      setTimeout(() => modal.remove(), 250);
    };
    modal.querySelector(".ann-close").onclick = () => close(false);
    modal.querySelector(".ann-backdrop").onclick = () => close(false);
    modal.querySelector(".ann-dismiss").onclick = () => close(true);
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(false); document.removeEventListener("keydown", esc); }
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function getKey(obj, path) {
    return path.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      const v = getKey(state.i18n, key);
      if (v !== null) el.textContent = v;
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(el => {
      const spec = el.getAttribute("data-i18n-attr");
      const [attr, key] = spec.split(":");
      const v = getKey(state.i18n, key);
      if (v !== null) el.setAttribute(attr, v);
    });
  }

  function applyConfig() {
    const { config, lang } = state;
    const name = lang === "ko" ? config.lab.name_ko : config.lab.name_en;
    const tagline = lang === "ko" ? config.lab.tagline_ko : config.lab.tagline_en;
    const aff = lang === "ko" ? config.lab.affiliation_ko : config.lab.affiliation_en;

    document.querySelectorAll("[data-lab-name]").forEach(el => el.textContent = name);
    document.querySelectorAll("[data-lab-short]").forEach(el => el.innerHTML = config.lab.short + '<span class="dot">.</span>');
    document.querySelectorAll("[data-lab-tagline]").forEach(el => el.textContent = tagline);
    document.querySelectorAll("[data-lab-affiliation]").forEach(el => el.textContent = aff);
    document.querySelectorAll("[data-pi-name]").forEach(el => el.textContent = lang === "ko" ? config.pi.name_ko : config.pi.name_en);
    document.querySelectorAll("[data-contact-email]").forEach(el => {
      el.textContent = config.contact.email;
      if (el.tagName === "A") el.href = "mailto:" + config.contact.email;
    });
    document.querySelectorAll("[data-contact-address]").forEach(el => {
      el.textContent = lang === "ko" ? config.contact.address_ko : config.contact.address_en;
    });
    document.querySelectorAll("[data-contact-address-detail]").forEach(el => {
      el.textContent = lang === "ko" ? config.contact.address_detail_ko : config.contact.address_detail_en;
    });
    document.querySelectorAll("[data-maps-embed]").forEach(el => {
      if (config.contact.maps_embed) el.src = config.contact.maps_embed;
    });

    document.querySelectorAll("[data-metric]").forEach(el => {
      const k = el.getAttribute("data-metric");
      const v = config.metrics[k];
      if (v !== undefined) el.textContent = typeof v === "number" ? v.toLocaleString() : v;
    });

    if (config.lab && config.lab.hero_image) {
      const visual = document.querySelector(".hero-visual");
      if (visual) visual.innerHTML = `<img src="${config.lab.hero_image}" alt="${name}" />`;
    }

    const titleBase = config.lab.short;
    if (!document.title.includes(titleBase)) {
      document.title = document.title ? `${document.title} · ${titleBase}` : titleBase;
    }
  }

  function setupNav() {
    const toggle = document.querySelector(".nav-toggle");
    const links = document.querySelector(".nav-links");
    if (toggle && links) {
      toggle.addEventListener("click", () => links.classList.toggle("open"));
    }
    const path = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav-links a").forEach(a => {
      const href = a.getAttribute("href");
      if (href === path || (path === "" && href === "index.html")) a.classList.add("active");
    });

    // Scrolled state
    const header = document.querySelector(".site-header");
    if (header) {
      const updateScrolled = () => header.classList.toggle("scrolled", window.scrollY > 8);
      updateScrolled();
      window.addEventListener("scroll", updateScrolled, { passive: true });
    }
  }

  function setupLangToggle() {
    document.querySelectorAll(".lang-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        const next = state.lang === "ko" ? "en" : "ko";
        localStorage.setItem(LS_LANG, next);
        const url = new URL(location.href);
        url.searchParams.set("lang", next);
        location.href = url.toString();
      });
    });
  }

  function setupTheme() {
    document.querySelectorAll(".theme-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme");
        const sysIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        let next;
        if (cur === "dark") next = "light";
        else if (cur === "light") next = "dark";
        else next = sysIsDark ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem(LS_THEME, next);
      });
    });
  }

  function setupScrollReveal() {
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(".reveal").forEach(el => el.classList.add("visible"));
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.05, rootMargin: "0px 0px -40px 0px" });
    // Only observe explicitly-tagged elements. Dynamic content rendered later
    // can call window.SiteUtils.observeReveal(el) to opt in.
    document.querySelectorAll(".reveal").forEach(el => io.observe(el));
    window.SiteUtils = window.SiteUtils || {};
    window.SiteUtils.observeReveal = (el) => { if (el) { el.classList.add("reveal"); io.observe(el); } };
  }

  function setupHashScroll() {
    if (!location.hash) return;
    let tries = 0;
    const tryScroll = () => {
      const el = document.querySelector(location.hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (tries++ < 20) setTimeout(tryScroll, 120);
    };
    setTimeout(tryScroll, 250);
  }

  window.SiteUtils = {
    loadJSON,
    getLang: () => state.lang,
    getI18n: () => state.i18n,
    getConfig: () => state.config
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
