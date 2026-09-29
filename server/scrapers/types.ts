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
  scrape: () => Promise<Snapshot>;
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
