import { clean, loadPage, type Provider, type Snapshot } from "./types.js";

// Cyfuture publishes no rate-card file. Two live sources, both read on every refresh:
//  1. /pricing    - the published VM plans (hourly, monthly offer, struck-out list price)
//  2. /calculator - its price constants, taken straight from the calculator's own script so
//                   a change there shows up here instead of going unnoticed.
const PRICING_URL = "https://cyfuture.cloud/pricing";
const CALC_URL = "https://cyfuture.cloud/calculator";

const HOURS_PER_MONTH = 730;
const num = (s: string) => Number(s.replace(/[^0-9.]/g, ""));
const inr = (n: number) => `₹ ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

async function scrapePlans(): Promise<Snapshot> {
  const $ = await loadPage(PRICING_URL);
  const rows: string[][] = [];

  $("#industry-accordion li").each((_, li) => {
    const spec = (re: RegExp) => {
      const t = $(li)
        .find(".specdic")
        .map((_, e) => clean($(e).text()))
        .get()
        .find((s) => re.test(s));
      return t ? String(num(t)) : "";
    };
    const hourly = clean($(li).find("h3").first().text()).replace(/\s*\/hr$/i, "");
    const offer = clean($(li).find(".priru").text() + $(li).find(".pripri").text());
    const list = clean($(li).find(".oldprice").text()).replace(/\s*\/mo$/i, "");
    const vcpu = spec(/vcpu/i);
    const ram = spec(/\bram\b/i);
    if (!vcpu || !ram || !list) return;
    // The battle card compares everyone pay-as-you-go: hourly x 730. That lands on the offer
    // price (checked: 0.99x), while the struck-out "list" price is ~2x what the hourly rate
    // implies, so list is shown for reference only. This column must come first: the card
    // takes the first Monthly-style column.
    const payg = num(hourly) * HOURS_PER_MONTH;
    const paygText = `₹ ${payg.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    rows.push([`${vcpu}vCPU / ${ram}GB`, vcpu, ram, spec(/ssd/i), hourly, paygText, list, offer]);
  });

  if (rows.length === 0) throw new Error("Cyfuture: no plans found on /pricing (layout changed?)");
  return {
    id: "cyfuture",
    name: "Cyfuture Cloud",
    section: "Cloud plans (/pricing) - offer price is marked /mo*",
    source: PRICING_URL,
    fetchedAt: new Date().toISOString(),
    columns: ["Plan", "vCPUs", "RAM", "SSD (GB)", "Hourly", `Monthly (hourly x ${HOURS_PER_MONTH})`, "List /mo (struck out)", "Offer /mo*"],
    rows,
  };
}

async function scrapeCalculator(): Promise<Snapshot> {
  const $ = await loadPage(CALC_URL);

  // The compute estimate lives in one inline script; look only inside its pricing lines.
  const script = $("script")
    .map((_, s) => $(s).html() ?? "")
    .get()
    .find((s) => s.includes("compute_custom_vcpu") && s.includes("ipv4_price"));
  if (!script) throw new Error("Cyfuture calculator: compute script not found (page changed?)");
  const js = script.replace(/\s+/g, " ");

  const from = js.indexOf("let ipv4_price");
  const to = js.indexOf("let sum", from);
  const calc = from >= 0 && to > from ? js.slice(from, to) : "";
  const need = (re: RegExp, src: string, what: string) => {
    const m = src.match(re);
    if (!m) throw new Error(`Cyfuture calculator: could not read ${what} (formula changed?)`);
    return m;
  };

  const vcpu = Number(need(/core \* ([\d.]+)/, calc, "vCPU rate")[1]);
  const ram = Number(need(/\(?ram \* ([\d.]+)/, calc, "RAM rate")[1]);
  const boot = Number(need(/compute_boot \* ([\d.]+)/, calc, "boot-disk rate")[1]);
  const ip = need(/ipv4_cal \* ([\d.]+)\) \* (\d+)/, calc, "IPv4 rate");
  const ipv4 = Number(ip[1]) * Number(ip[2]); // per hour x hours per month

  const afterSum = js.slice(to, to + 3000);
  const fx = Number(need(/current_currency == 1\) \{ sum = parseFloat\(sum \* (\d+)\)/, afterSum, "USD-INR rate")[1]);
  const disc = (label: string) =>
    Number(
      need(new RegExp(`== ['"]${label}['"]\\) \\{ sum = sum - \\(sum \\* (\\d+) / 100\\)`), afterSum, `${label} discount`)[1],
    );

  const rows: string[][] = [
    ["Compute vCPU", "Per vCPU / month", `$${vcpu}`, inr(vcpu * fx)],
    ["Compute RAM", "Per GB / month", `$${ram}`, inr(ram * fx)],
    ["Boot disk", "Per GB / month", `$${boot}`, inr(boot * fx)],
    ["Public IPv4", "Per address / month", `$${ipv4.toFixed(2)}`, inr(ipv4 * fx)],
    ["1-year commitment", "Discount", `${disc("1 Year")}%`, `${disc("1 Year")}%`],
    ["3-year commitment", "Discount", `${disc("3 Year")}%`, `${disc("3 Year")}%`],
  ];

  // OS licence add-ons: <select id="compute_os"> option values are USD per VM per month.
  $("#compute_os option").each((_, o) => {
    const v = $(o).attr("value");
    const label = clean($(o).text());
    if (!v || Number.isNaN(Number(v)) || Number(v) === 0) return;
    rows.push([`OS licence: ${label}`, "Per VM / month", `$${v}`, inr(Number(v) * fx)]);
  });

  return {
    id: "cyfuture",
    name: "Cyfuture Cloud",
    section: `Calculator rates (live from the calculator's script, x${fx} USD-INR)`,
    source: CALC_URL,
    fetchedAt: new Date().toISOString(),
    columns: ["Item", "Unit", "Calculator value", "In INR"],
    rows,
  };
}

export const cyfuture: Provider = {
  id: "cyfuture",
  ttlSeconds: 300, // live: refreshed on demand when the dashboard is opened
  async scrape() {
    // Both must succeed: a half-updated snapshot would hide a broken source.
    return Promise.all([scrapePlans(), scrapeCalculator()]);
  },
};
