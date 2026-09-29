import { clean, loadPage, readTable, type Provider, type Snapshot } from "./types.js";

// Linux, INR, Mumbai. Windows/SQL and Spot are separate pages and are left out on purpose
// (licence costs skew a like-for-like comparison, same rule the battle card applies elsewhere).
const BASE = "https://acecloud.ai/pricing/linux/inr/mumbai/";
const HOURS_PER_MONTH = 730;

// A family's own index URL just redirects to /pricing/, so start from its first generation
// and discover the other generations from the links on that page.
const FAMILIES = [
  { path: "standard-instance", label: "Standard Instance", seed: "s2a" },
  { path: "cpu-intensive", label: "CPU Intensive", seed: "c2a" },
  { path: "ram-intensive", label: "RAM Intensive", seed: "m2a" },
];

async function scrapeFamily(f: (typeof FAMILIES)[number]): Promise<Snapshot[]> {
  const seedUrl = `${BASE}${f.path}/${f.seed}/`;
  const $seed = await loadPage(seedUrl);

  // generation slug -> tab label, e.g. "s3a" -> "3rd Gen AMD"
  const gens = new Map<string, string>([[f.seed, ""]]);
  const linkRe = new RegExp(`/pricing/linux/inr/mumbai/${f.path}/([a-z0-9]+)/?$`);
  $seed("a[href]").each((_, a) => {
    const slug = ($seed(a).attr("href") ?? "").match(linkRe)?.[1];
    if (slug) gens.set(slug, clean($seed(a).text()) || gens.get(slug) || "");
  });

  const out: Snapshot[] = [];
  for (const [slug, tab] of gens) {
    const url = `${BASE}${f.path}/${slug}/`;
    const $ = slug === f.seed ? $seed : await loadPage(url);
    const { columns, rows } = readTable($, $("table").first(), `AceCloud ${slug}`);

    // drop the empty-header "Launch Now" button column
    const keep = columns.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    const label = tab || $seed(`a[href$="/${f.path}/${slug}/"]`).first().text();

    // The site's "Monthly" is a discounted monthly plan (~20% under pay-as-you-go). The battle
    // card compares every provider pay-as-you-go, so add hourly x 730 in front of it; the
    // card takes the first Monthly-style column, and the plan price stays visible next to it.
    const cols = keep.map((i) => columns[i]);
    const iH = cols.findIndex((c) => /^hourly/i.test(c));
    const iM = cols.findIndex((c) => /^monthly$/i.test(c));
    if (iH < 0 || iM < 0) throw new Error(`AceCloud ${slug}: Hourly/Monthly columns not found (layout changed?)`);
    const withPayg = <T>(cells: T[], payg: T): T[] => [...cells.slice(0, iM), payg, ...cells.slice(iM)];
    const outCols = withPayg(cols, `Monthly (hourly x ${HOURS_PER_MONTH})`).map((c) => (c === "Monthly" ? "Monthly plan /mo" : c));
    const outRows = rows.map((r) => {
      const cells = keep.map((i) => r[i] ?? "");
      const hourly = Number(cells[iH].replace(/[^0-9.]/g, ""));
      return withPayg(cells, `₹ ${(hourly * HOURS_PER_MONTH).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    });
    out.push({
      id: "acecloud",
      name: "AceCloud",
      section: `${f.label} - ${clean(label) || slug.toUpperCase()} (Linux, Mumbai, INR)`,
      source: url,
      fetchedAt: new Date().toISOString(),
      columns: outCols,
      rows: outRows,
    });
  }
  return out;
}

export const acecloud: Provider = {
  id: "acecloud",
  async scrape() {
    const all: Snapshot[] = [];
    for (const f of FAMILIES) all.push(...(await scrapeFamily(f)));

    // The URL pins INR; refuse anything else so it can't sit next to the other rupee rates.
    const monthly = all[0].columns.findIndex((c) => /^monthly/i.test(c));
    if (monthly < 0 || !all.every((s) => s.rows.every((r) => r[monthly].startsWith("₹")))) {
      throw new Error("AceCloud: prices are not in ₹ or the Monthly column moved (layout changed?)");
    }
    return all;
  },
};
