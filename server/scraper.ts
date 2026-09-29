import * as cheerio from "cheerio";

export const SOURCE_URL = "https://www.esds.co.in/cloud-service-rates";
const WANTED = ["Compute Virtual CPU", "Compute Virtual RAM"];

export interface Rate {
  item: string;
  unit: string;
  price: number | null;
  display: string;
}

export interface RateSnapshot {
  source: string;
  fetchedAt: string;
  rates: Rate[];
}

export async function fetchRates(): Promise<RateSnapshot> {
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 PriceCompare" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ESDS responded with HTTP ${res.status}`);

  const $ = cheerio.load(await res.text());
  const found = new Map<string, Rate>();

  $("tr").each((_, tr) => {
    // cells: [sr no, feature, unit, monthly cost]
    const cells = $(tr)
      .find("td")
      .map((_, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get();
    if (cells.length < 4 || !WANTED.includes(cells[1])) return;
    const num = cells[3].match(/[\d,]+(?:\.\d+)?/);
    found.set(cells[1], {
      item: cells[1],
      unit: cells[2],
      price: num ? parseFloat(num[0].replace(/,/g, "")) : null,
      display: cells[3],
    });
  });

  const missing = WANTED.filter((w) => !found.has(w));
  if (missing.length) {
    throw new Error(`Rows not found on page (layout changed?): ${missing.join(", ")}`);
  }

  return {
    source: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    rates: WANTED.map((w) => found.get(w)!),
  };
}
