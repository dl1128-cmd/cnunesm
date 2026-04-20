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
   * Scholar metrics loader
   * Primary: loads data/scholar_metrics.json (committed by GitHub Actions daily)
   * Fallback: fetches from OpenAlex API if scholar_metrics.json is missing
   * (Previous approach used CORS proxies to scrape Google Scholar directly,
   *  which was unreliable due to rate-limiting and captchas.)
   * ========================================================================= */
  const OPENALEX_CACHE_KEY = "nesm:openalex:cache:v1";
  const OPENALEX_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

  async function loadScholarMetrics() {
    try {
      const res = await fetch("data/scholar_metrics.json?t=" + Date.now(), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        // Normalize history field: Actions script uses "count", chart expects "n"
        if (data.citations_history) {
          data.citations_history = data.citations_history.map(h => ({
            year: h.year,
            n: h.count !== undefined ? h.count : h.n
          }));
        }
        applyScholarMetrics(data);
        return;
      }
    } catch { /* file may not exist yet */ }
    // Fallback to OpenAlex if scholar_metrics.json is not available
    await loadOpenAlexFallback();
  }

  async function loadOpenAlexFallback() {
    const config = state.config;
    if (!config?.pi?.name_en) return;
    // Check localStorage cache first
    try {
      const cached = JSON.parse(localStorage.getItem(OPENALEX_CACHE_KEY) || "null");
      if (cached && (Date.now() - cached.t) < OPENALEX_CACHE_TTL) {
        applyScholarMetrics(cached.data);
        return;
      }
    } catch {}
    try {
      const name = config.pi.name_en;
      const url = `https://api.openalex.org/works?per-page=200&filter=raw_author_name.search:${encodeURIComponent(name)}&mailto=scholar-bot@users.noreply.github.com`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const papers = (data.results || []).map(w => ({
        title: w.title || w.display_name || "",
        citations: w.cited_by_count || 0,
        year: w.publication_year || 0,
        scholar_link: ""
      }));
      const metrics = { papers: papers, _source: "openalex" };
      localStorage.setItem(OPENALEX_CACHE_KEY, JSON.stringify({ t: Date.now(), data: metrics }));
      applyScholarMetrics(metrics);
    } catch { /* OpenAlex unavailable — silent */ }
  }

  async function autoUpdateScholarMetrics() {
    await loadScholarMetrics();
  }

  function applyScholarMetrics(metrics) {
    if (!metrics) return;
    // Update numeric metrics on page
    const metricKeys = ["citations_total", "citations_recent5y", "h_index", "i10_index"];
    metricKeys.forEach(k => {
      if (metrics[k] !== undefined) state.config.metrics[k] = metrics[k];
    });
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
    // Expose totals for other consumers
    state.config.scholar_metrics = metrics;
    document.dispatchEvent(new CustomEvent("scholar:totals", { detail: metrics }));
  }

  window.SiteUtils = window.SiteUtils || {};
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

  Object.assign(window.SiteUtils, {
    loadJSON,
    getLang: () => state.lang,
    getI18n: () => state.i18n,
    getConfig: () => state.config
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
