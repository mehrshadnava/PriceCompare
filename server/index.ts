import express from "express";
import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esds } from "./scrapers/esds.js";
import { ctrls } from "./scrapers/ctrls.js";
import { e2e } from "./scrapers/e2e.js";
import { acecloud } from "./scrapers/acecloud.js";
import { cyfuture } from "./scrapers/cyfuture.js";
import { tata } from "./scrapers/tata.js";
import { airtel } from "./scrapers/airtel.js";
import { yntraa } from "./scrapers/yntraa.js";
import { aws, azure, gcp } from "./scrapers/vantage.js";
import type { Provider, Snapshot } from "./scrapers/types.js";
import { buildBattleCard } from "./battlecard.js";

const PROVIDERS: Provider[] = [yntraa, ctrls, e2e, acecloud, cyfuture, tata, airtel, esds, aws, azure, gcp]; // page order

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

// Last refresh outcome per provider, so a broken scraper is reported rather than hidden.
const failures = new Map<string, string>();
const inflight = new Map<string, Promise<void>>();

function refresh(p: Provider): Promise<void> {
  // one scrape at a time per provider, however many requests arrive together
  const running = inflight.get(p.id);
  if (running) return running;
  const job = (async () => {
    try {
      const snaps = [await p.scrape()].flat();
      latest.set(p.id, snaps);
      failures.delete(p.id);
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, `${p.id}.json`), JSON.stringify(snaps, null, 2));
      console.log(`[${snaps[0].fetchedAt}] ${p.id} updated (${snaps.length} table(s))`);
    } catch (err) {
      // keep serving the previous snapshot, but flag it on the dashboard
      failures.set(p.id, (err as Error).message);
      console.error(`${p.id} fetch failed:`, (err as Error).message);
    } finally {
      inflight.delete(p.id);
    }
  })();
  inflight.set(p.id, job);
  return job;
}

// Each provider refreshes independently, so one site failing never blocks the other.
const refreshAll = () => PROVIDERS.forEach((p) => void refresh(p));

/** Live providers (those with a ttl) are re-scraped when a request finds them stale. */
async function ensureFresh(): Promise<void> {
  const stale = PROVIDERS.filter((p) => {
    if (!p.ttlSeconds) return false;
    const s = latest.get(p.id)?.[0];
    return !s || Date.now() - Date.parse(s.fetchedAt) > p.ttlSeconds * 1000;
  });
  // cap the wait so a slow site can't hang the dashboard; the stale snapshot is served instead
  await Promise.race([
    Promise.all(stale.map(refresh)),
    new Promise((r) => setTimeout(r, 12_000)),
  ]);
}

function warnings(): string[] {
  return [...failures].map(([id, msg]) => {
    const s = latest.get(id)?.[0];
    const shown = s ? `showing data from ${new Date(s.fetchedAt).toLocaleString()}` : "no data yet";
    return `${s?.name ?? id}: latest fetch failed (${msg}) - ${shown}`;
  });
}

const app = express();
app.get("/api/rates", async (_req, res) => {
  await ensureFresh();
  res.json(PROVIDERS.flatMap((p) => latest.get(p.id) ?? []));
});
const ORDER = PROVIDERS.map((p) => p.id);
app.get("/api/battlecard", async (_req, res) => {
  await ensureFresh();
  res.json({ ...buildBattleCard(latest, ORDER), warnings: warnings() });
});
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
