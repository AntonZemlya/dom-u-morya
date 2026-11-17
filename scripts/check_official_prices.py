#!/usr/bin/env python3
"""Public developer offer audit for ЖК «Дом у моря». No credentials, DB, or POST.

Default is read-only. --apply is deliberately fail-closed when the set of IDs
changes: adding apartments requires validating and importing their exact plans.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import datetime as dt
import html.parser
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT_URL = "https://sadovoe-kolco.ru/projects/mariupol/house-by-the-sea"
PROJECT_ID = "24"
PROJECT_CODE = "house-by-the-sea"
USER_AGENT = "DomUMorya-OfferAudit/1.0 (+https://zhk-dom-umorya.ru/)"
MAX_REQUESTS = 100

class ScriptCollector(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.current_type = None
        self.current_id = None
        self.parts = []
        self.scripts = []
    def handle_starttag(self, tag, attrs):
        if tag == "script":
            attrs = dict(attrs)
            self.current_id = attrs.get("id")
            self.current_type = attrs.get("type")
            self.parts = []
    def handle_data(self, data):
        if self.current_id is not None or self.current_type == "application/ld+json":
            self.parts.append(data)
    def handle_endtag(self, tag):
        if tag == "script" and (self.current_id is not None or self.current_type == "application/ld+json"):
            self.scripts.append((self.current_id, self.current_type, "".join(self.parts)))
            self.current_id = None
            self.current_type = None
            self.parts = []

def load_html(url: str):
    if not url.startswith(PROJECT_URL):
        raise ValueError("URL outside exact developer project scope")
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ru-RU,ru;q=0.9",
        "Cache-Control": "no-cache",
    })
    try:
        with urllib.request.urlopen(req, timeout=32) as response:
            if response.status != 200:
                raise ValueError("Unexpected HTTP " + str(response.status))
            raw = response.read(3_000_001)
            if len(raw) > 3_000_000:
                raise ValueError("Page larger than allowed limit")
            return raw.decode("utf-8")
    except urllib.error.HTTPError:
        raise

def get_scripts(document: str):
    p = ScriptCollector()
    p.feed(document)
    return p.scripts

def fetch_offers():
    scripts = get_scripts(load_html(PROJECT_URL))
    found = [json.loads(data) for id, kind, data in scripts if id == "__NEXT_DATA__"]
    if len(found) != 1:
        raise ValueError("No unique Next data payload")
    redux = found[0].get("props", {}).get("initialReduxState", {})
    entities = redux.get("filter", {}).get("entities", [])
    project = [x for x in redux.get("projectFilter", {}).get("entities", [])
               if str(x.get("id")) == PROJECT_ID and x.get("code") == PROJECT_CODE]
    if len(project) != 1:
        raise ValueError("Project metadata missing or ambiguous")
    expected = project[0].get("flats_cnt")
    selected = [x for x in entities
                if str(x.get("projectId")) == PROJECT_ID and x.get("code") == PROJECT_CODE]
    if not isinstance(expected, int) or not 1 <= expected <= 258:
        raise ValueError("Invalid project inventory count")
    if len(selected) != expected:
        raise ValueError("Incomplete inventory: %s != %s" % (len(selected), expected))
    ids = [str(x.get("id")) for x in selected]
    if len(set(ids)) != len(ids) or len(selected) > MAX_REQUESTS:
        raise ValueError("Duplicate IDs or inventory limit exceeded")
    offers = {}
    for raw in selected:
        id = str(raw["id"])
        if not id.isdigit():
            raise ValueError("Non-numeric apartment ID")
        if not (1_000_000 <= raw.get("price", 0) <= 150_000_000):
            raise ValueError("Invalid price for ID " + id)
        if not (1 <= raw.get("square", 0) <= 200):
            raise ValueError("Invalid area for ID " + id)
        if not (0 <= raw.get("rooms", -1) <= 3):
            raise ValueError("Invalid room count for ID " + id)
        if not (1 <= raw.get("floor", 0) <= raw.get("floorSize", 0) <= 40):
            raise ValueError("Invalid floor for ID " + id)
        offers[id] = {
            "id": id, "number": int(raw["number"]), "price": int(raw["price"]),
            "area_m2": float(raw["square"]), "bedrooms": int(raw["rooms"]),
            "floor": int(raw["floor"]), "building": str(raw["corpus"]),
            "section": str(raw["section"]), "floors_total": int(raw["floorSize"]),
            "features": list(raw.get("props", [])),
            "source_url": PROJECT_URL + "/" + id + "?projectId=1",
        }
    return offers

def fetch_detail(pair):
    id, offer = pair
    document = load_html(offer["source_url"])
    products = []
    for script_id, kind, text in get_scripts(document):
        if kind != "application/ld+json":
            continue
        data = json.loads(text)
        if data.get("@type") == "ItemList":
            products.extend(data.get("itemListElement", []))
    matches = [x for x in products
               if x.get("@type") == "Product"
               and x.get("url", "").split("?")[0].rstrip("/").endswith("/" + id)]
    if len(matches) != 1:
        raise ValueError("Missing/duplicate matching Product schema: " + id)
    p = matches[0]
    m = re.search(r"№\s*(\d+)", p.get("name", ""))
    if not m or int(m.group(1)) != offer["number"]:
        raise ValueError("Wrong apartment number in detail " + id)
    actual = p.get("offers", {})
    if (actual.get("priceCurrency") != "RUB"
            or actual.get("price") != offer["price"]
            or actual.get("availability") != "InStock"):
        raise ValueError("Listing/detail conflict for " + id)
    return id

def compare(snapshot: list, current: dict):
    old = {str(x["id"]): x for x in snapshot}
    if len(old) != len(snapshot):
        raise ValueError("Duplicate IDs in local snapshot")
    shared = sorted(old.keys() & current.keys(), key=int)
    missing = sorted(old.keys() - current.keys(), key=int)
    added = sorted(current.keys() - old.keys(), key=int)
    changed = []
    for id in shared:
        original, fresh = old[id], current[id]
        for k, nk in (("number", "number"), ("floor", "floor"),
                       ("building", "building"), ("section", "section"),
                       ("floors_total", "floors_total"), ("bedrooms", "bedrooms")):
            if str(original[k]) != str(fresh[nk]):
                raise ValueError("Identity mismatch: %s %s" % (id, k))
        if abs(float(original["area_m2"]) - fresh["area_m2"]) > 0.01:
            raise ValueError("Area mismatch: " + id)
        oldprice, price = int(original["price_rub"]), fresh["price"]
        if abs(price / oldprice - 1) > .3:
            raise ValueError("Price change exceeds 30%: " + id)
        if original.get("developer_availability") != "InStock":
            raise ValueError("Availability changed; manual review: " + id)
        changed.append({
            "id": id, "number": fresh["number"], "floor": fresh["floor"],
            "old_price": oldprice, "new_price": price, "delta": price - oldprice,
            "percent": round(100 * (price / oldprice - 1), 3),
            "source_url": fresh["source_url"], "status": "same" if oldprice == price else "price_changed",
        })
    return old, changed, missing, added

def run(args):
    root = pathlib.Path(__file__).resolve().parent.parent
    source = root / "data/apartments.json"
    oldlist = json.loads(source.read_text(encoding="utf8"))
    current = fetch_offers()
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for id in pool.map(fetch_detail, current.items()):
            pass
    old, rows, missing, added = compare(oldlist, current)
    result = {
        "checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "project_url": PROJECT_URL,
        "source_snapshot": sorted({x.get("snapshot_date") for x in oldlist}),
        "old_count": len(oldlist), "official_count": len(current),
        "price_changed": sum(x["delta"] != 0 for x in rows),
        "price_up": sum(x["delta"] > 0 for x in rows),
        "price_down": sum(x["delta"] < 0 for x in rows),
        "removed_ids": missing, "added_ids": added,
        "new_offers": [current[id] for id in added],
        "removed_offers": [{"id": id, "number": old[id]["number"],
                            "old_price": old[id]["price_rub"]} for id in missing],
        "prices": rows,
        "requires_review": bool(missing or added),
    }
    if args.output:
        output = pathlib.Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps({k: v for k, v in result.items() if k not in ("prices", "new_offers", "removed_offers")}, ensure_ascii=False))
    if args.apply:
        if missing or added:
            raise ValueError("Membership changed; refuse automated update: additions/removals require verified plan assets")
        if not result["price_changed"]:
            print("NO_PRICE_CHANGES")
            return 0
        timestamp = result["checked_at"]
        groups_file = root / "data/plan-groups.json"
        server_catalog = root / "api/lead-catalog.php"
        groups = json.loads(groups_file.read_text(encoding="utf8"))
        old_sources = [source.read_bytes(), groups_file.read_bytes(), server_catalog.read_bytes()]
        for row in oldlist:
            fresh = current[str(row["id"])]
            if row["price_rub"] != fresh["price"]:
                row["price_rub"] = fresh["price"]
                row["price_per_m2_rub"] = round(fresh["price"] / fresh["area_m2"])
                row["snapshot_date"] = timestamp[:10]
                row["fetched_at"] = timestamp
                row["price_matches_listing"] = True
        prices = {x["id"]: x["price_rub"] for x in oldlist}
        for group in groups:
            values = [prices[id] for id in group["apartments"]]
            if not values:
                raise ValueError("Empty plan group: " + group["id"])
            group["price_min_rub"] = min(values)
            group["price_max_rub"] = max(values)
        try:
            source.write_text(json.dumps(oldlist, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
            groups_file.write_text(json.dumps(groups, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
            subprocess.run(["node", "scripts/generate-content.mjs"], cwd=root, check=True)
            # A changed catalog must update the server-side lead contract, too.
            subprocess.run(["node", "scripts/smtp-runtime.mjs", "--record"], cwd=root, check=True)
        except Exception:
            source.write_bytes(old_sources[0])
            groups_file.write_bytes(old_sources[1])
            server_catalog.write_bytes(old_sources[2])
            subprocess.run(["node", "scripts/generate-content.mjs"], cwd=root, check=True)
            raise
        print("APPLIED_VALIDATED_PRICES", result["price_changed"])
    if args.check and (result["price_changed"] or missing or added):
        return 2
    return 0

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", help="Write an immutable JSON comparison report")
    parser.add_argument("--check", action="store_true", help="Exit 2 on valid detected changes")
    parser.add_argument("--apply", action="store_true", help="Write price-only if ALL IDs match")
    args = parser.parse_args()
    try:
        sys.exit(run(args))
    except (ValueError, KeyError, TypeError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print("FAIL_CLOSED:", str(exc), file=sys.stderr)
        sys.exit(3)
