import { type Provider, type Snapshot } from "./types.js";

// Airtel Cloud's estimator is a React app backed by a public JSON gateway (no login):
//   GET  /filters  -> the full tree of services -> vCPUs -> RAM -> SKU (no prices)
//   POST /quote    -> the price of one SKU for a plan type
// So the rate card is built the way the page builds a price: walk the VM tree, ask for a quote
// per SKU and plan.
const API = "https://openapi.airtel.in/gateway/airtel-xchange/cloud-bff/price-calculator";
const SOURCE = "https://estimator.cloud.airtel.in/calculator/";
// North and South quote the same price (checked); the calculator only offers these two.
const REGION = "North";
const HOURS_PER_MONTH = 730;
const CONCURRENCY = 8; // SKUs in flight; each fires 4 quotes, so ~32 requests (~35 ms each)
const HEADERS = {
  "User-Agent": "Mozilla/5.0 PriceCompare",
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: "https://estimator.cloud.airtel.in",
  Referer: "https://estimator.cloud.airtel.in/",
};

interface Node {
  skuDescription?: string;
  actualServiceSubCategory?: string;
  subData?: Record<string, Node>;
}
interface Sku {
  category: string; // General Compute, High Performance, ...
  family: string; // Compute Dense, Memory Extreme, ...
  core: string;
  ram: string;
  description: string; // "ccd.Med_1vCPU, 1Gb RAM"
}

/** Tree shape: Virtual Machine -> category -> vCPUs -> RAM -> SKU leaf. */
function collectSkus(vm: Record<string, Node>): Sku[] {
  const skus: Sku[] = [];
  for (const [category, catNode] of Object.entries(vm)) {
    for (const [core, coreNode] of Object.entries(catNode.subData ?? {})) {
      for (const [ram, leaf] of Object.entries(coreNode.subData ?? {})) {
        if (!leaf.skuDescription) continue;
        skus.push({
          category,
          family: leaf.actualServiceSubCategory ?? category,
          core,
          ram,
          description: leaf.skuDescription,
        });
      }
    }
  }
  return skus;
}

async function quote(sku: Sku, planType: "hourly" | "monthly" | "1Year" | "3Year"): Promise<number> {
  const res = await fetch(`${API}/quote`, {
    method: "POST",
    headers: HEADERS,
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      segmentId: "1",
      label: "Compute 1",
      pageId: "Compute Engine",
      region: REGION,
      price: 0,
      priceDto: [
        {
          id: "provisioningValue",
          planType,
          instances: 1,
          usageTime: HOURS_PER_MONTH, // a full month of hours; monthly/reserved plans ignore it
          price: 0,
          serviceName: "Virtual Machine",
          serviceSubCategory: sku.family,
          core: sku.core,
          ram: sku.ram,
          skuDescription: sku.description,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`quote HTTP ${res.status}`);
  return Number(((await res.json()) as { total?: number }).total ?? 0);
}

/** Run jobs with a fixed number in flight. */
async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const inr = (n: number) => `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const airtel: Provider = {
  id: "airtel",
  ttlSeconds: 3600, // ~360 quotes per refresh, so hourly rather than every few minutes
  async scrape() {
    const res = await fetch(`${API}/filters`, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Airtel: /filters responded HTTP ${res.status}`);
    const tree = (await res.json()) as Record<string, Node>;
    const vm = tree["Compute Engine"]?.subData?.["Virtual Machine"]?.subData;
    if (!vm) throw new Error("Airtel: Virtual Machine section not found in /filters (API changed?)");

    const skus = collectSkus(vm);
    if (skus.length === 0) throw new Error("Airtel: no VM SKUs found (API changed?)");

    const priced = await pool(skus, CONCURRENCY, async (sku) => {
      try {
        const [hourly, monthly, y1, y3] = await Promise.all([
          quote(sku, "hourly"),
          quote(sku, "monthly"),
          quote(sku, "1Year"),
          quote(sku, "3Year"),
        ]);
        return { sku, hourly, monthly, y1, y3 };
      } catch {
        return { sku, hourly: 0, monthly: 0, y1: 0, y3: 0 };
      }
    });

    // A SKU with no price is dropped; if many are, the API has changed and we say so.
    const good = priced.filter((p) => p.hourly > 0);
    if (good.length < skus.length * 0.8) {
      throw new Error(`Airtel: only ${good.length} of ${skus.length} SKUs returned a price (API changed?)`);
    }

    const byCategory = new Map<string, typeof good>();
    for (const p of good) byCategory.set(p.sku.category, [...(byCategory.get(p.sku.category) ?? []), p]);

    const now = new Date().toISOString();
    const snaps: Snapshot[] = [];
    for (const [category, list] of byCategory) {
      snaps.push({
        id: "airtel",
        name: "Airtel Cloud",
        section: `Virtual Machine - ${category} (${REGION}, INR)`,
        source: SOURCE,
        fetchedAt: now,
        columns: [
          "Plan",
          "Family",
          "vCPUs",
          "RAM (GB)",
          "Hourly",
          `Monthly (hourly x ${HOURS_PER_MONTH})`,
          "Monthly plan /mo",
          "Reserved 1-yr /mo",
          "Reserved 3-yr /mo",
        ],
        rows: list.map(({ sku, hourly, monthly, y1, y3 }) => [
          sku.description.split(",")[0],
          sku.family,
          sku.core,
          sku.ram,
          inr(hourly / HOURS_PER_MONTH),
          inr(hourly),
          monthly ? inr(monthly) : "",
          y1 ? inr(y1) : "",
          y3 ? inr(y3) : "",
        ]),
      });
    }
    return snaps;
  },
};
