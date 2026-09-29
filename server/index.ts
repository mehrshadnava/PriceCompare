import express from "express";
import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esds } from "./scrapers/esds.js";
import { ctrls } from "./scrapers/ctrls.js";
import type { Provider, Snapshot } from "./scrapers/types.js";

const PROVIDERS: Provider[] = [esds, ctrls]; // page order

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// compiled: dist/server/index.js -> repo root is two levels up; dev: server/index.ts -> one level up
const ROOT = path.resolve(__dirname, process.env.NODE_ENV === "production" ? "../.." : "..");
const DATA_DIR = path.join(ROOT, "data");
const CLIENT_DIR = path.join(ROOT, "dist", "client");
const PORT = Number(process.env.PORT ?? 8000);

const latest = new Map<string, Snapshot>();
for (const p of PROVIDERS) {
  try {
    latest.set(p.id, JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${p.id}.json`), "utf-8")));
  } catch {
    /* no cached data yet */
  }
}

async function refresh(p: Provider): Promise<void> {
  try {
    const snap = await p.scrape();
    latest.set(p.id, snap);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, `${p.id}.json`), JSON.stringify(snap, null, 2));
    console.log(`[${snap.fetchedAt}] ${p.id} updated`);
  } catch (err) {
    // keep serving the previous snapshot; the retry timer below tries again
    console.error(`${p.id} fetch failed:`, (err as Error).message);
  }
}

// Each provider refreshes independently, so one site failing never blocks the other.
const refreshAll = () => PROVIDERS.forEach((p) => void refresh(p));

const app = express();
app.get("/api/rates", (_req, res) =>
  res.json(PROVIDERS.flatMap((p) => latest.get(p.id) ?? [])),
);
app.use(express.static(CLIENT_DIR));
app.get("*", (_req, res) => res.sendFile(path.join(CLIENT_DIR, "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`Serving on http://0.0.0.0:${PORT}`));

refreshAll(); // on startup
cron.schedule("0 6 * * *", refreshAll); // then daily at 06:00 server time
setInterval(() => {
  // retry every 15 min for any provider with no data or data over 25h old
  for (const p of PROVIDERS) {
    const s = latest.get(p.id);
    if (!s || Date.now() - Date.parse(s.fetchedAt) > 25 * 3600_000) void refresh(p);
  }
}, 15 * 60_000);
