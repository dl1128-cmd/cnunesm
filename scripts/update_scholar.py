"""Fetch Google Scholar metrics and write data/scholar_metrics.json.

Runs in GitHub Actions (see .github/workflows/update-citations.yml).

Strategy chain:
1. Try SerpAPI if SERPAPI_KEY secret is set (most reliable).
2. Try scholarly with free proxy (may be blocked by Google).
3. Fallback to OpenAlex API (always works, but citation counts differ from Scholar).

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
# Strategy 3: OpenAlex API (free, always works, no auth)
# ---------------------------------------------------------------------------
def try_openalex(author_name: str) -> dict | None:
    if not author_name:
        print("  OpenAlex: no author name available, skipping.")
        return None

    try:
        encoded = urllib.parse.quote(author_name)
        url = (
            f"https://api.openalex.org/works?"
            f"per-page=200&filter=raw_author_name.search:{encoded}"
            f"&mailto=scholar-bot@users.noreply.github.com"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "scholar-bot/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        results = data.get("results", [])
        papers = [
            {
                "title": w.get("title") or w.get("display_name", ""),
                "year": w.get("publication_year"),
                "citations": w.get("cited_by_count", 0),
                "scholar_link": "",
            }
            for w in results
        ]

        # Aggregate total citations from the results we have
        total_citations = sum(p["citations"] for p in papers)

        return {
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "user_id": "",
            "citations_total": total_citations,
            "citations_recent5y": 0,
            "h_index": 0,
            "i10_index": 0,
            "citations_history": [],
            "papers": papers,
            "_source": "openalex",
        }
    except Exception as exc:
        print(f"  OpenAlex failed: {exc}")
        return None


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
