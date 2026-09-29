# PriceCompare

A battle card putting every Yntraa Cloud VM SKU next to the nearest equivalent from
each competitor, refreshed daily.

| Provider | Source |
|---|---|
| Yntraa Cloud (the anchor) | scraped from yntraacloud.ai |
| CtrlS | scraped from ctrls.com |
| E2E Networks | scraped from e2enetworks.com |
| ESDS | scraped from esds.co.in - a per-vCPU/GB rate card, so every spec is priced exactly |
| AWS, Microsoft Azure, Google Cloud | Vantage Instances API, on-demand Linux, Mumbai regions |

- `server/` - Node + Express + TypeScript. Each provider refreshes independently on
  startup and daily at 06:00, caches to `data/<id>.json`, and serves `/api/rates`
  (raw tables) and `/api/battlecard` (matched comparison).
- `client/` - React + Vite + TypeScript page.

Matching is on vCPU count with RAM within 15%; the cheapest qualifying SKU wins, and
Windows SKUs are excluded so licence costs don't skew the comparison.

## Environment
    VANTAGE_API_KEY   free key from instances-api.vantage.sh. Without it the three
                      hyperscalers are skipped and the rest of the page is unaffected.
    USD_INR           rate used for E2E and the Vantage feeds (default 96).

## Develop
    npm install
    export VANTAGE_API_KEY=...
    npm run dev:server   # API on :8000
    npm run dev:client   # Vite on :5173 (proxies /api)

## Deploy on a VM (Node 20+)
    sudo git clone https://github.com/mehrshadnava/PriceCompare /opt/PriceCompare
    cd /opt/PriceCompare && sudo npm ci && sudo npm run build
    sudo mkdir -p data && sudo chown -R www-data /opt/PriceCompare
    sudo cp pricecompare.service /etc/systemd/system/
    sudo systemctl enable --now pricecompare

Open port 8000 in the VM firewall (or put nginx in front).
