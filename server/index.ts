import express from "express";
import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRates, type RateSnapshot } from "./scraper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// compiled: dist/server/index.js -> repo root is two levels up; dev: server/index.ts -> one level up
const ROOT = path.resolve(__dirname, process.env.NODE_ENV === "production" ? "../.." : "..");
const DATA_FILE = path.join(ROOT, "data", "rates.json");
const CLIENT_DIR = path.join(ROOT, "dist", "client");
const PORT = Number(process.env.PORT ?? 8000);

let latest: RateSnapshot | null = null;
try {
  latest = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
} catch {
  /* no cached data yet */
}

async function refresh(): Promise<void> {
  try {
    latest = await fetchRates();
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(latest, null, 2));
    console.log(`[${latest.fetchedAt}] rates updated`);
  } catch (err) {
    // keep serving the previous snapshot; the retry timer below tries again
    console.error("fetch failed:", (err as Error).message);
  }
}

const app = express();
app.get("/api/rates", (_req, res) => res.json(latest));
app.use(express.static(CLIENT_DIR));
app.get("*", (_req, res) => res.sendFile(path.join(CLIENT_DIR, "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`Serving on http://0.0.0.0:${PORT}`));

void refresh(); // on startup
cron.schedule("0 6 * * *", () => void refresh()); // then daily at 06:00 server time
setInterval(() => {
  // retry every 15 min if there is no data or it is over 25h old
  if (!latest || Date.now() - Date.parse(latest.fetchedAt) > 25 * 3600_000) void refresh();
}, 15 * 60_000);
