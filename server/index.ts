import express from "express";
import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esds } from "./scrapers/esds.js";
import { ctrls } from "./scrapers/ctrls.js";
import { e2e } from "./scrapers/e2e.js";
import { yntraa } from "./scrapers/yntraa.js";
import { aws, azure, gcp } from "./scrapers/vantage.js";
import type { Provider, Snapshot } from "./scrapers/types.js";
import { buildBattleCard } from "./battlecard.js";

const PROVIDERS: Provider[] = [yntraa, ctrls, e2e, esds, aws, azure, gcp]; // page order

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// compiled: dist/server/index.js -> repo root is two levels up; dev: server/index.ts -> one level up
const ROOT = path.resolve(__dirname, process.env.NODE_ENV === "production" ? "../.." : "..");
const DATA_DIR = path.join(ROOT, "data");
const CLIENT_DIR = path.join(ROOT, "dist", "client");
const PORT = Number(process.env.PORT ?? 8000);

// A provider may publish several tables, so each entry holds a list.
const latest = new Map<string, Snapshot[]>();
for (const p of PROVIDERS) {
  try {
    const cached = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${p.id}.json`), "utf-8"));
    latest.set(p.id, [cached].flat());
  } catch {
    /* no cached data yet */
  }
}

async function refresh(p: Provider): Promise<void> {
  try {
    const snaps = [await p.scrape()].flat();
    latest.set(p.id, snaps);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, `${p.id}.json`), JSON.stringify(snaps, null, 2));
    console.log(`[${snaps[0].fetchedAt}] ${p.id} updated (${snaps.length} table(s))`);
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
const ORDER = PROVIDERS.map((p) => p.id);
app.get("/api/battlecard", (_req, res) => res.json(buildBattleCard(latest, ORDER)));
app.use(express.static(CLIENT_DIR));
app.get("*", (_req, res) => res.sendFile(path.join(CLIENT_DIR, "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`Serving on http://0.0.0.0:${PORT}`));

refreshAll(); // on startup
cron.schedule("0 6 * * *", refreshAll); // then daily at 06:00 server time
setInterval(() => {
  // retry every 15 min for any provider with no data or data over 25h old
  for (const p of PROVIDERS) {
    const s = latest.get(p.id)?.[0];
    if (!s || Date.now() - Date.parse(s.fetchedAt) > 25 * 3600_000) void refresh(p);
  }
}, 15 * 60_000);
