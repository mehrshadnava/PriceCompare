import type { Snapshot } from "./scrapers/types.js";

/** E2E and the Vantage feeds quote in USD; the Indian providers quote in rupees.
 *  Override with USD_INR=<rate>. */
export const USD_INR = Number(process.env.USD_INR ?? 96);

export interface Match {
  plan: string;
  price: number;
  /** true when the RAM is close but not identical (e.g. 15 GB against a 16 GB SKU) */
  approx: boolean;
  /** how much cheaper Yntraa is, as a percentage of this competitor's price */
  savingPct: number;
}

export interface BattleRow {
  family: string;
  plan: string;
  vcpu: number;
  ram: number;
  price: number;
  /** keyed by competitor id; null means no equivalent offering */
  competitors: Record<string, Match | null>;
}

export interface Competitor {
  id: string;
  name: string;
  source: string;
  /** set when the plans are derived from a rate card rather than listed as SKUs */
  note?: string;
}

export interface BattleCard {
  generatedAt: string;
  usdInr: number;
  competitors: Competitor[];
  rows: BattleRow[];
}

/** One comparable offering, normalised to monthly rupees. */
interface Offer {
  plan: string;
  vcpu: number;
  ram: number;
  price: number;
}

const findCol = (columns: string[], re: RegExp) => columns.findIndex((c) => re.test(c));

const PLAN_COL = /plan|product name|template size|flavou?r/i;
const VCPU_COL = /vcpus?$/i;
const RAM_COL = /ram/i;
const PRICE_COL = /^(mrc|monthly)/i;

/** "₹ 1,98,400.00" -> 198400 ; "$35.64" -> 35.64 (converted to rupees) */
function parseMoney(cell: string): number | null {
  const n = Number(cell.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  return cell.includes("$") ? n * USD_INR : n;
}

const parseNum = (cell: string) => {
  const n = Number(cell.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Pull offers out of any snapshot that lists a plan with its vCPU, RAM and monthly
 * price — which covers Yntraa, CtrlS and E2E. Tables without those columns (add-ons,
 * storage) yield nothing and are skipped.
 */
function offersFrom(snaps: Snapshot[], skipWindows = false): Offer[] {
  const offers: Offer[] = [];
  for (const s of snaps) {
    // Windows SKUs carry a licence cost, so they'd flatter Yntraa's base VMs unfairly.
    if (skipWindows && /windows/i.test(s.section)) continue;
    const iPlan = findCol(s.columns, PLAN_COL);
    const iVcpu = findCol(s.columns, VCPU_COL);
    const iRam = findCol(s.columns, RAM_COL);
    const iPrice = findCol(s.columns, PRICE_COL);
    if (iPlan < 0 || iVcpu < 0 || iRam < 0 || iPrice < 0) continue;

    for (const row of s.rows) {
      if (row.length < s.columns.length) continue; // note rows spanning the table
      const vcpu = parseNum(row[iVcpu]);
      const ram = parseNum(row[iRam]);
      const price = parseMoney(row[iPrice]);
      if (vcpu === null || ram === null || price === null) continue;
      offers.push({ plan: row[iPlan], vcpu, ram, price });
    }
  }
  return offers;
}

/** ESDS sells vCPU and RAM by the unit, so any spec can be priced exactly. */
function esdsOffer(snaps: Snapshot[], vcpu: number, ram: number): Offer | null {
  const rate = (item: RegExp) => {
    for (const s of snaps) {
      for (const row of s.rows) {
        if (item.test(row[0] ?? "")) return parseMoney(row[row.length - 1]);
      }
    }
    return null;
  };
  const cpu = rate(/virtual cpu/i);
  const mem = rate(/virtual ram/i);
  if (cpu === null || mem === null) return null;
  return {
    plan: `Built to spec (${vcpu} vCPU + ${ram} GB)`,
    vcpu,
    ram,
    price: vcpu * cpu + ram * mem,
  };
}

const RAM_TOLERANCE = 0.15;

/** Cheapest offer with the same vCPU count and the same (or near-enough) RAM. */
function bestMatch(offers: Offer[], vcpu: number, ram: number): { offer: Offer; approx: boolean } | null {
  const sameCpu = offers.filter((o) => o.vcpu === vcpu);
  const exact = sameCpu.filter((o) => o.ram === ram);
  const near = sameCpu.filter((o) => Math.abs(o.ram - ram) / ram <= RAM_TOLERANCE);
  const pool = exact.length ? exact : near;
  if (!pool.length) return null;
  const offer = pool.reduce((a, b) => (b.price < a.price ? b : a));
  return { offer, approx: !exact.length };
}

/** Yntraa is the anchor; ESDS is a rate card rather than a SKU list. */
const ANCHOR = "yntraa";
const RATE_CARD = "esds";

export function buildBattleCard(latest: Map<string, Snapshot[]>, order: string[]): BattleCard {
  const yntraaSnaps = latest.get(ANCHOR) ?? [];
  const esdsSnaps = latest.get(RATE_CARD) ?? [];

  const competitors: Competitor[] = [];
  const offers = new Map<string, Offer[]>();
  for (const id of order) {
    if (id === ANCHOR) continue;
    const snaps = latest.get(id);
    if (!snaps?.length) continue;
    if (id === RATE_CARD) {
      competitors.push({
        id,
        name: snaps[0].name,
        source: snaps[0].source,
        note: "Priced per vCPU/GB, so every spec is matched exactly",
      });
      continue;
    }
    competitors.push({ id, name: snaps[0].name, source: snaps[0].source });
    offers.set(id, offersFrom(snaps, true));
  }

  const rows: BattleRow[] = [];
  for (const s of yntraaSnaps) {
    // "Virtual Machine - General Purpose (Public Cloud Pricing)" -> "General Purpose"
    const family = s.section.replace(/^.*?-\s*/, "").replace(/\s*\(.*\)$/, "");
    for (const o of offersFrom([s])) {
      const competitorCells: Record<string, Match | null> = {};
      for (const c of competitors) {
        const found =
          c.id === RATE_CARD
            ? (() => {
                const e = esdsOffer(esdsSnaps, o.vcpu, o.ram);
                return e ? { offer: e, approx: false } : null;
              })()
            : bestMatch(offers.get(c.id) ?? [], o.vcpu, o.ram);
        competitorCells[c.id] = found && {
          plan: found.offer.plan,
          price: found.offer.price,
          approx: found.approx,
          savingPct: Math.round(((found.offer.price - o.price) / found.offer.price) * 100),
        };
      }
      rows.push({ family, plan: o.plan, vcpu: o.vcpu, ram: o.ram, price: o.price, competitors: competitorCells });
    }
  }

  return { generatedAt: new Date().toISOString(), usdInr: USD_INR, competitors, rows };
}
