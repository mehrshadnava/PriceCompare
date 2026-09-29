# PriceCompare

Fetches ESDS **Compute Virtual CPU** and **Compute Virtual RAM** rates from
https://www.esds.co.in/cloud-service-rates daily and shows them on a React page.

- `server/` - Node + Express + TypeScript: scrapes with cheerio, refreshes on startup and daily at 06:00, caches to `data/rates.json`, serves `/api/rates` and the built React app.
- `client/` - React + Vite + TypeScript page.

## Develop
    npm install
    npm run dev:server   # API on :8000
    npm run dev:client   # Vite on :5173 (proxies /api)

## Deploy on a VM (Node 20+)
    sudo git clone https://github.com/mehrshadnava/PriceCompare /opt/PriceCompare
    cd /opt/PriceCompare && sudo npm ci && sudo npm run build
    sudo mkdir -p data && sudo chown -R www-data /opt/PriceCompare
    sudo cp pricecompare.service /etc/systemd/system/
    sudo systemctl enable --now pricecompare

Open port 8000 in the VM firewall (or put nginx in front).
