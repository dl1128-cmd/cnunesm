"""Fetch Google Scholar metrics and write data/scholar_metrics.json.

Runs in GitHub Actions (see .github/workflows/update-citations.yml).

Strategy chain:
1. Try SerpAPI if SERPAPI_KEY secret is set (most reliable).
2. Try scholarly with free proxy (may be blocked by Google).
3. Try Playwright headless Chromium to scrape Google Scholar directly.
   - Works well on local machines / residential IPs.
   - May be blocked on GH Actions IP ranges; falls through to OpenAlex.
4. Fallback to OpenAlex API (always works, but citation counts differ from Scholar).

If all fail and a previous scholar_metrics.json exists, it is preserved.
"""

import json
import os
import pathlib
import re
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

CONFIG_PATH = pathlib.Path("data/config.json")
OUTPUT_PATH = pathlib.Path("data/scholar_metrics.json")


def get_user_id() -> str | None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    scholar_url = (config.get("pi") or {}).get("scholar", "")
    m = re.search(r"user=([^&]+)", scholar_url)
    return m.group(1) if m else None


def get_author_name() -> str:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return (config.get("pi") or {}).get("name_en", "")


# ---------------------------------------------------------------------------
# Strategy 1: SerpAPI (requires SERPAPI_KEY repo secret)
# ---------------------------------------------------------------------------
def try_serpapi(user_id: str) -> dict | None:
    api_key = os.environ.get("SERPAPI_KEY", "").strip()
    if not api_key:
        print("  SerpAPI: no SERPAPI_KEY set, skipping.")
        return None

    try:
        from serpapi import GoogleSearch  # type: ignore
    except ImportError:
        print("  SerpAPI: serpapi package not installed, skipping.")
        return None

    try:
        # Author profile
        params = {
            "engine": "google_scholar_author",
            "author_id": user_id,
            "api_key": api_key,
            "hl": "en",
            "num": 100,
        }
        search = GoogleSearch(params)
        results = search.get_dict()

        cited_by = results.get("cited_by", {})
        table = cited_by.get("table", [])
        graph = cited_by.get("graph", [])

        citations_total = 0
        citations_recent5y = 0
        h_index = 0
        i10_index = 0
        for row in table:
            if "citations" in row:
                citations_total = row["citations"].get("all", 0)
                citations_recent5y = row["citations"].get("since_2021", 0)
            if "h_index" in row:
                h_index = row["h_index"].get("all", 0)
            if "i10_index" in row:
                i10_index = row["i10_index"].get("all", 0)

        citations_history = [
            {"year": int(g["year"]), "count": int(g["citations"])}
            for g in graph
        ]

        articles = results.get("articles", [])
        papers = [
            {
                "title": a.get("title", ""),
                "year": a.get("year"),
                "citations": a.get("cited_by", {}).get("value", 0),
                "scholar_link": a.get("link", ""),
            }
            for a in articles
        ]

        return {
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "user_id": user_id,
            "citations_total": citations_total,
            "citations_recent5y": citations_recent5y,
            "h_index": h_index,
            "i10_index": i10_index,
            "citations_history": citations_history,
            "papers": papers,
            "_source": "serpapi",
        }
    except Exception as exc:
        print(f"  SerpAPI failed: {exc}")
        return None


# ---------------------------------------------------------------------------
# Strategy 2: scholarly with free proxy
# ---------------------------------------------------------------------------
def try_scholarly(user_id: str) -> dict | None:
    try:
        from scholarly import scholarly, ProxyGenerator  # type: ignore
    except ImportError:
        print("  scholarly: package not installed, skipping.")
        return None

    try:
        # Set up free proxy to avoid Google blocking
        pg = ProxyGenerator()
        success = pg.FreeProxies()
        if success:
            scholarly.use_proxy(pg)
            print("  scholarly: free proxy configured.")
        else:
            print("  scholarly: no free proxy available, trying direct.")

        author = scholarly.search_author_id(user_id)
        author = scholarly.fill(author, sections=["basics", "indices", "counts", "publications"])

        papers = []
        for pub in author.get("publications", []):
            # Don't fill individual publications to save time and avoid blocks.
            # The author profile already contains num_citations and basic bib info.
            bib = pub.get("bib") or {}
            papers.append({
                "title": bib.get("title", ""),
                "year": bib.get("pub_year"),
                "citations": pub.get("num_citations", 0),
                "scholar_link": (
                    f"https://scholar.google.com/citations?"
                    f"view_op=view_citation&hl=en&user={user_id}"
                    f"&citation_for_view={pub.get('author_pub_id', '')}"
                ),
            })

        cites_per_year = author.get("cites_per_year") or {}
        citations_history = [
            {"year": int(y), "count": int(c)}
            for y, c in sorted(cites_per_year.items())
        ]

        return {
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "user_id": user_id,
            "citations_total": author.get("citedby", 0),
            "citations_recent5y": author.get("citedby5y", 0),
            "h_index": author.get("hindex", 0),
            "i10_index": author.get("i10index", 0),
            "citations_history": citations_history,
            "papers": papers,
            "_source": "scholarly",
        }
    except Exception as exc:
        print(f"  scholarly failed: {exc}")
        return None


# ---------------------------------------------------------------------------
# Strategy 3: Playwright headless Chromium (scrape Scholar directly)
# Works on local/residential IPs; may be blocked on GH Actions runners.
# ---------------------------------------------------------------------------
def try_playwright_scholar(user_id: str) -> dict | None:
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError:
        print("  Playwright: package not installed, skipping.")
        return None

    SCHOLAR_URL = (
        f"https://scholar.google.com/citations?"
        f"user={user_id}&hl=en&pagesize=100"
    )
    BROWSER_TIMEOUT_MS = 90_000

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/125.0.0.0 Safari/537.36"
                ),
                locale="en-US",
                viewport={"width": 1280, "height": 900},
            )
            context.set_default_timeout(BROWSER_TIMEOUT_MS)
            page = context.new_page()

            print(f"  Playwright: navigating to {SCHOLAR_URL[:80]}...")
            page.goto(SCHOLAR_URL, wait_until="domcontentloaded")
            time.sleep(1)  # allow JS rendering

            # Detect captcha / bot wall
            if page.query_selector("#gs_captcha_ccl") or page.query_selector(
                "form#captcha-form"
            ):
                print("  Playwright: CAPTCHA detected, bailing out.")
                browser.close()
                return None

            # Wait for the metrics table
            page.wait_for_selector("#gsc_rsb_st", timeout=15_000)

            # --- Parse metrics table ---
            stat_cells = page.query_selector_all("#gsc_rsb_st td.gsc_rsb_std")
            if len(stat_cells) < 6:
                print(f"  Playwright: expected 6 stat cells, got {len(stat_cells)}.")
                browser.close()
                return None

            def _int(el) -> int:
                txt = (el.text_content() or "").strip().replace(",", "")
                return int(txt) if txt.isdigit() else 0

            citations_total = _int(stat_cells[0])
            citations_recent5y = _int(stat_cells[1])
            h_index = _int(stat_cells[2])
            h_index_recent = _int(stat_cells[3])
            i10_index = _int(stat_cells[4])
            i10_index_recent = _int(stat_cells[5])

            # --- Parse citations-per-year graph ---
            year_els = page.query_selector_all(".gsc_g_t")
            count_els = page.query_selector_all(".gsc_g_al")
            citations_history = []
            for y_el, c_el in zip(year_els, count_els):
                y_txt = (y_el.text_content() or "").strip()
                c_txt = (c_el.text_content() or "").strip().replace(",", "")
                if y_txt.isdigit():
                    citations_history.append({
                        "year": int(y_txt),
                        "count": int(c_txt) if c_txt.isdigit() else 0,
                    })

            # --- Load all papers (click "Show more" up to 5 times) ---
            for _ in range(5):
                btn = page.query_selector("#gsc_bpf_more")
                if not btn:
                    break
                if btn.get_attribute("disabled") is not None:
                    break
                btn.click()
                time.sleep(1.5)
                # Re-check for captcha after clicking
                if page.query_selector("#gs_captcha_ccl"):
                    print("  Playwright: CAPTCHA after 'Show more', stopping pagination.")
                    break

            # --- Parse paper list ---
            paper_rows = page.query_selector_all("#gsc_a_b tr.gsc_a_tr")
            papers = []
            for row in paper_rows:
                title_el = row.query_selector(".gsc_a_at")
                title = (title_el.text_content() or "").strip() if title_el else ""
                # Scholar link
                href = title_el.get_attribute("href") if title_el else ""
                if href and not href.startswith("http"):
                    href = "https://scholar.google.com" + href
                # Authors + venue (gray text)
                gray_els = row.query_selector_all(".gs_gray")
                authors = (gray_els[0].text_content() or "").strip() if len(gray_els) > 0 else ""
                venue = (gray_els[1].text_content() or "").strip() if len(gray_els) > 1 else ""
                # Year
                year_el = row.query_selector(".gsc_a_y span")
                year_txt = (year_el.text_content() or "").strip() if year_el else ""
                year_val = int(year_txt) if year_txt.isdigit() else None
                # Citations
                cite_el = row.query_selector(".gsc_a_ac")
                cite_txt = (cite_el.text_content() or "").strip().replace(",", "") if cite_el else "0"
                cite_count = int(cite_txt) if cite_txt.isdigit() else 0

                papers.append({
                    "title": title,
                    "year": year_val,
                    "citations": cite_count,
                    "scholar_link": href or "",
                })

            browser.close()

            print(f"  Playwright: parsed {citations_total} total citations, "
                  f"h={h_index}, i10={i10_index}, {len(papers)} papers")

            return {
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "user_id": user_id,
                "citations_total": citations_total,
                "citations_recent5y": citations_recent5y,
                "h_index": h_index,
                "i10_index": i10_index,
                "citations_history": citations_history,
                "papers": papers,
                "_source": "playwright_scholar",
            }
    except Exception as exc:
        print(f"  Playwright failed: {exc}")
        return None


# ---------------------------------------------------------------------------
# Strategy 4: OpenAlex API (free, always works, no auth)
# Resolves author -> fetches author summary stats + counts_by_year + works.
# ---------------------------------------------------------------------------
MAILTO = "scholar-bot@users.noreply.github.com"


def _openalex_get(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": "scholar-bot/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        print(f"  OpenAlex GET failed ({url[:80]}…): {exc}")
        return None


def _resolve_openalex_author_id(author_name: str) -> str | None:
    """Identify the PI's OpenAlex author ID by majority-vote across our own
    publications. Looks up several recent journal papers from publications.json
    on OpenAlex and picks the author ID that appears most often.

    This avoids the homonym problem of name-only search (e.g. "Hoon-Hee Ryu"
    matching an unrelated researcher with more citations).

    If publications.json is unavailable or no matches found, falls back to
    name-based search restricted to candidates whose name strictly contains
    the family name.
    """
    pub_path = pathlib.Path("data/publications.json")
    title_candidates: list[str] = []
    if pub_path.exists():
        try:
            pubs = json.loads(pub_path.read_text(encoding="utf-8"))
            journal_pubs = [
                p for p in pubs
                if (p.get("type") in (None, "journal")) and p.get("title")
            ]
            # sort newest first, take up to 8 distinct titles
            journal_pubs.sort(key=lambda p: p.get("year", 0) or 0, reverse=True)
            for p in journal_pubs[:8]:
                t = str(p.get("title", "")).strip()
                if t and t not in title_candidates:
                    title_candidates.append(t)
        except Exception as exc:
            print(f"  publications.json read failed: {exc}")

    author_votes: dict[str, dict] = {}  # id -> {votes, name, works, cites}
    for title in title_candidates:
        # Use OpenAlex title search with high specificity
        encoded = urllib.parse.quote(title[:220])
        url = (
            f"https://api.openalex.org/works?"
            f"search={encoded}&per-page=3&mailto={MAILTO}"
        )
        data = _openalex_get(url)
        if not data:
            continue
        # Take only the top hit (best title relevance)
        results = data.get("results") or []
        if not results:
            continue
        top = results[0]
        # Vote for every author of this work
        for ship in top.get("authorships") or []:
            aobj = ship.get("author") or {}
            aid = (aobj.get("id") or "").rsplit("/", 1)[-1]
            if not aid:
                continue
            entry = author_votes.setdefault(aid, {
                "votes": 0,
                "name": aobj.get("display_name", ""),
            })
            entry["votes"] += 1

    if author_votes:
        # Pick author with the most appearances; break ties by lower works count
        best_id = max(author_votes, key=lambda k: author_votes[k]["votes"])
        votes = author_votes[best_id]["votes"]
        name = author_votes[best_id]["name"]
        if votes >= max(2, len(title_candidates) // 3):
            print(f"  OpenAlex: identified '{name}' -> {best_id} "
                  f"via {votes}/{len(title_candidates)} publication matches")
            return best_id
        print(f"  OpenAlex: top vote only {votes}/{len(title_candidates)}; "
              "falling back to name search")

    # Fallback: strict name search
    encoded = urllib.parse.quote(author_name)
    url = (
        f"https://api.openalex.org/authors?"
        f"search={encoded}&per-page=10&mailto={MAILTO}"
    )
    data = _openalex_get(url)
    if not data:
        return None
    candidates = data.get("results", [])
    family = (author_name.split()[-1] or "").lower()
    candidates = [
        c for c in candidates
        if family and family in (c.get("display_name", "") or "").lower()
    ]
    if not candidates:
        return None
    # Among strict matches, pick the most cited
    candidates.sort(key=lambda a: a.get("cited_by_count", 0), reverse=True)
    chosen = candidates[0]
    full_id = chosen.get("id", "")
    short_id = full_id.rsplit("/", 1)[-1] if full_id else None
    if short_id:
        print(f"  OpenAlex: name-search resolved '{author_name}' -> {short_id} "
              f"({chosen.get('display_name', '')}, "
              f"{chosen.get('cited_by_count', 0)} citations)")
    return short_id


def _fetch_openalex_works(author_id: str) -> list[dict]:
    """Page through all works for the author."""
    works: list[dict] = []
    cursor = "*"
    while cursor:
        url = (
            f"https://api.openalex.org/works?"
            f"filter=author.id:{author_id}&per-page=200"
            f"&cursor={cursor}&mailto={MAILTO}"
        )
        data = _openalex_get(url)
        if not data:
            break
        works.extend(data.get("results", []))
        cursor = (data.get("meta") or {}).get("next_cursor")
        if cursor is None or not data.get("results"):
            break
    return works


def _get_explicit_openalex_ids() -> list[str]:
    """Return list of OpenAlex author IDs explicitly configured in config.pi.

    Supports `pi.openalex_ids` (list) or `pi.openalex_id` (single string).
    Returning multiple IDs is useful when OpenAlex has split one author into
    several profiles (e.g. due to affiliation change).
    """
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    pi = config.get("pi") or {}
    ids = pi.get("openalex_ids")
    if isinstance(ids, list):
        return [str(x) for x in ids if x]
    single = pi.get("openalex_id")
    if isinstance(single, str) and single:
        return [single]
    return []


def _aggregate_authors(author_ids: list[str]) -> dict | None:
    """Fetch each author's metadata + works, then merge into one dict."""
    h_index = 0
    i10_index = 0
    citations_total = 0
    citations_history: dict[int, int] = {}
    seen_works: dict[str, dict] = {}  # id -> work (dedupe across authors)

    for aid in author_ids:
        author = _openalex_get(
            f"https://api.openalex.org/authors/{aid}?mailto={MAILTO}"
        )
        if not author:
            print(f"  OpenAlex: failed to fetch author {aid}")
            continue
        summary = author.get("summary_stats") or {}
        # h-index / i10 don't sum cleanly across split profiles; take max
        h_index = max(h_index, int(summary.get("h_index", 0) or 0))
        i10_index = max(i10_index, int(summary.get("i10_index", 0) or 0))
        citations_total += int(author.get("cited_by_count", 0) or 0)
        for c in author.get("counts_by_year") or []:
            y = int(c.get("year", 0) or 0)
            if y:
                citations_history[y] = (
                    citations_history.get(y, 0)
                    + int(c.get("cited_by_count", 0) or 0)
                )
        # Works (deduped by OpenAlex work ID)
        for w in _fetch_openalex_works(aid):
            wid = w.get("id", "") or w.get("doi", "") or w.get("title", "")
            if wid and wid not in seen_works:
                seen_works[wid] = w
        print(f"  OpenAlex: aggregated {aid} -> running total "
              f"{citations_total} cites, {len(seen_works)} works")

    if not seen_works and citations_total == 0:
        return None

    history = sorted(
        ({"year": y, "count": c} for y, c in citations_history.items()),
        key=lambda x: x["year"],
    )
    current_year = time.gmtime().tm_year
    citations_recent5y = sum(
        h["count"] for h in history if h["year"] >= current_year - 4
    )

    papers = [
        {
            "title": w.get("title") or w.get("display_name", ""),
            "year": w.get("publication_year"),
            "citations": int(w.get("cited_by_count", 0) or 0),
            "scholar_link": w.get("doi") or "",
        }
        for w in seen_works.values()
    ]
    # newest-first papers list
    papers.sort(key=lambda p: (p.get("year") or 0), reverse=True)

    return {
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "user_id": "",
        "openalex_id": ",".join(author_ids),
        "citations_total": citations_total,
        "citations_recent5y": citations_recent5y,
        "h_index": h_index,
        "i10_index": i10_index,
        "citations_history": history,
        "papers": papers,
        "_source": "openalex",
    }


def try_openalex(author_name: str) -> dict | None:
    # Prefer explicit IDs from config (most accurate, avoids homonyms /
    # publication-vote pitfalls).
    explicit = _get_explicit_openalex_ids()
    if explicit:
        print(f"  OpenAlex: using explicit ids from config: {explicit}")
        return _aggregate_authors(explicit)

    if not author_name:
        print("  OpenAlex: no author name available, skipping.")
        return None

    author_id = _resolve_openalex_author_id(author_name)
    if not author_id:
        print(f"  OpenAlex: could not resolve author '{author_name}'.")
        return None
    return _aggregate_authors([author_id])


def main() -> None:
    user_id = get_user_id()
    if not user_id:
        print("No scholar user id in config.pi.scholar; skipping.")
        sys.exit(0)

    author_name = get_author_name()
    print(f"Fetching Scholar metrics for user_id={user_id}, name={author_name}")

    result = None

    # Try each strategy in order
    for name, fn in [
        ("SerpAPI", lambda: try_serpapi(user_id)),
        ("scholarly", lambda: try_scholarly(user_id)),
        ("Playwright Scholar", lambda: try_playwright_scholar(user_id)),
        ("OpenAlex", lambda: try_openalex(author_name)),
    ]:
        print(f"Trying {name}...")
        result = fn()
        if result and (result.get("papers") or result.get("citations_total", 0) > 0):
            print(f"  Success via {name}!")
            break
        result = None

    if not result:
        print("All strategies failed. Preserving existing scholar_metrics.json if present.")
        sys.exit(0)

    OUTPUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(result.get('papers', []))} papers, "
          f"total citations {result.get('citations_total', 0)}, "
          f"source: {result.get('_source', 'unknown')}")


if __name__ == "__main__":
    main()
