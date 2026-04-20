"""Fetch Google Scholar metrics and write data/scholar_metrics.json.

Runs in GitHub Actions (see .github/workflows/update-citations.yml).
Uses the `scholarly` library to scrape Google Scholar.
If scholarly is blocked, consider switching to serpapi or OpenAlex.
"""

import json
import pathlib
import re
import sys
import time

from scholarly import scholarly

CONFIG_PATH = pathlib.Path("data/config.json")
OUTPUT_PATH = pathlib.Path("data/scholar_metrics.json")


def main():
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    scholar_url = (config.get("pi") or {}).get("scholar", "")
    m = re.search(r"user=([^&]+)", scholar_url)
    if not m:
        print("No scholar user id in config.pi.scholar; skipping.")
        sys.exit(0)

    user_id = m.group(1)
    print(f"Fetching Scholar profile for user_id={user_id}")

    author = scholarly.search_author_id(user_id)
    author = scholarly.fill(author, sections=["basics", "indices", "counts", "publications"])

    papers = []
    for pub in author.get("publications", []):
        try:
            filled = scholarly.fill(pub)
        except Exception as exc:
            print(f"  Warning: could not fill publication: {exc}")
            filled = pub

        bib = filled.get("bib") or {}
        papers.append({
            "title": bib.get("title", ""),
            "year": bib.get("pub_year"),
            "citations": filled.get("num_citations", 0),
            "scholar_link": (
                f"https://scholar.google.com/citations?"
                f"view_op=view_citation&hl=en&user={user_id}"
                f"&citation_for_view={filled.get('author_pub_id', '')}"
            ),
        })

    cites_per_year = author.get("cites_per_year") or {}
    citations_history = [
        {"year": int(y), "count": int(c)}
        for y, c in sorted(cites_per_year.items())
    ]

    out = {
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "user_id": user_id,
        "citations_total": author.get("citedby", 0),
        "citations_recent5y": author.get("citedby5y", 0),
        "h_index": author.get("hindex", 0),
        "h_index5y": author.get("hindex5y", 0),
        "i10_index": author.get("i10index", 0),
        "i10_index5y": author.get("i10index5y", 0),
        "citations_history": citations_history,
        "papers": papers,
    }

    OUTPUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(papers)} papers, total citations {out['citations_total']}")


if __name__ == "__main__":
    main()
