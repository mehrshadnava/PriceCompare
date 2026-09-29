import * as cheerio from "cheerio";

/** A raw table scraped from one provider's rate card. */
export interface Snapshot {
  id: string;
  name: string;
  section: string;
  source: string;
  fetchedAt: string;
  columns: string[];
  rows: string[][];
}

export interface Provider {
  id: string;
  /** One site can yield several tables (e.g. one per instance series). */
  scrape: () => Promise<Snapshot | Snapshot[]>;
}

export const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export async function loadPage(url: string): Promise<cheerio.CheerioAPI> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 PriceCompare" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url} responded with HTTP ${res.status}`);
  return cheerio.load(await res.text());
}

/** Read a <table> element into a header row plus body rows. */
export function readTable(
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<any>,
  label: string,
): { columns: string[]; rows: string[][] } {
  const grid: string[][] = table
    .find("tr")
    .map((_, tr) => [
      $(tr)
        .find("th, td")
        .map((_, c) => clean($(c).text()))
        .get(),
    ])
    .get();

  const [columns, ...rows] = grid.filter((r) => r.length > 0);
  if (!columns || rows.length === 0) throw new Error(`${label}: table is empty`);
  return { columns, rows };
}
