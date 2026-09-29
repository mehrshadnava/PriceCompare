"""ESDS rate fetcher + tiny web server (stdlib only, no dependencies).

- Scrapes the ESDS cloud rate card once a day (and on startup).
- Stores the latest result in rates.json (survives restarts).
- Serves a simple page at /  and the raw data at /api/rates.

Run:  python3 app.py            (env: PORT=8000, HOST=0.0.0.0)
"""
import json
import os
import re
import threading
import time
import urllib.request
from datetime import datetime, timezone
from html import unescape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

URL = "https://www.esds.co.in/cloud-service-rates"
WANTED = ["Compute Virtual CPU", "Compute Virtual RAM"]
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rates.json")
REFRESH_SECONDS = 24 * 60 * 60
RETRY_SECONDS = 15 * 60

ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S)
CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
TAG_RE = re.compile(r"<[^>]+>")

lock = threading.Lock()


def clean(s):
    return " ".join(unescape(TAG_RE.sub("", s)).split())


def fetch_rates():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 PriceCompare"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    found = {}
    for row in ROW_RE.findall(html):
        cells = [clean(c) for c in CELL_RE.findall(row)]
        # cells: [sr no, feature, unit, monthly cost]
        if len(cells) >= 4 and cells[1] in WANTED:
            m = re.search(r"[\d,]+(?:\.\d+)?", cells[3])
            found[cells[1]] = {
                "item": cells[1],
                "unit": cells[2],
                "price": float(m.group().replace(",", "")) if m else None,
                "display": cells[3],
            }
    missing = [w for w in WANTED if w not in found]
    if missing:
        raise RuntimeError(f"Rows not found on page (layout changed?): {missing}")
    return {
        "source": URL,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rates": [found[w] for w in WANTED],
    }


def load():
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def refresher():
    while True:
        try:
            data = fetch_rates()
            with lock:
                with open(DATA_FILE, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
            print(f"[{data['fetched_at']}] rates updated", flush=True)
            time.sleep(REFRESH_SECONDS)
        except Exception as e:  # keep serving old data, retry soon
            print(f"fetch failed: {e}", flush=True)
            time.sleep(RETRY_SECONDS)


def render_page(data):
    if not data:
        body = "<p>No data yet — first fetch in progress. Refresh in a few seconds.</p>"
        stamp = "never"
    else:
        rows = "".join(
            f"<tr><td>{r['item']}</td><td>{r['unit']}</td><td class='p'>{r['display']}</td></tr>"
            for r in data["rates"]
        )
        body = ("<table><tr><th>Item</th><th>Unit</th><th>Monthly Cost</th></tr>"
                f"{rows}</table>")
        stamp = data["fetched_at"].replace("T", " ").replace("+00:00", " UTC")
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESDS Rates</title>
<style>
body{{font-family:system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem;color:#222}}
table{{border-collapse:collapse;width:100%}}
th,td{{padding:.7rem 1rem;border-bottom:1px solid #ddd;text-align:left}}
th{{background:#f4f4f4}} .p{{font-weight:600}}
small{{color:#666}}
</style></head><body>
<h1>ESDS Cloud Rates</h1>
{body}
<p><small>Last fetched: {stamp} · Source: <a href="{URL}">{URL}</a> · Refreshes daily</small></p>
</body></html>""".encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        with lock:
            data = load()
        if self.path.split("?")[0] == "/api/rates":
            body, ctype = json.dumps(data or {}).encode(), "application/json"
        elif self.path.split("?")[0] in ("/", "/index.html"):
            body, ctype = render_page(data), "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    threading.Thread(target=refresher, daemon=True).start()
    host, port = os.environ.get("HOST", "0.0.0.0"), int(os.environ.get("PORT", "8000"))
    print(f"Serving on http://{host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
