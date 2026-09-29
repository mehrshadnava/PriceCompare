import { clean, type Provider, type Snapshot } from "./types.js";

// Tata Communications Vayu Cloud. The calculator is a Laravel app that fills its dropdowns from a
// JSON API guarded by a session cookie + CSRF token, so we do what the page does:
//   GET  /                     -> session cookie + <meta name="csrf-token">
//   GET  /get-vm-series        -> the series (A, B, C ...) for a country
//   POST /get-vm-flavours      -> every flavour of a series, with its rates
const BASE = "https://explore.tatacommunications.com/cloud-pricing-calculator/public/index.php";
const PAGE = "https://explore.tatacommunications.com/cloud-pricing-calculator/public/index.php";
const COUNTRY = "India";
// Rates are identical in Delhi / Mumbai / Bangalore / Chennai (checked), so one region is enough.
const REGION = "Mumbai";
// Linux without a paid licence, the like-for-like base. Windows, RHEL and SUSE add licence cost.
const OS_NAME = /ubuntu/i;
const HOURS_PER_MONTH = 730;
const UA = { "User-Agent": "Mozilla/5.0 PriceCompare" };

interface Flavour {
  flavour_name: string;
  v_cpu: number;
  ram: number;
  root_storage: number;
  hourly_rate: number;
  reserved_1_year_per_month_rate: number;
  reserved_3_year_per_month_rate: number;
}
interface Series {
  id: number;
  series_name: string;
}

/**
 * A reserved rate is a discount, so it can't exceed pay-per-use. A handful of Tata flavours
 * (flagged is_updated) carry the whole 12- or 36-month total in the "per month" field
 * (D2: 21,987.60 = 12 x 1,832.30). Show those as unavailable instead of a wrong price.
 */
function reserved(perMonth: number, hourly: number): string {
  const v = Number(perMonth);
  return v > hourly * HOURS_PER_MONTH ? "n/a (Tata data)" : inr(v);
}

const inr = (n: number) => `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function openSession() {
  const res = await fetch(PAGE, { headers: UA, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Tata: calculator page responded HTTP ${res.status}`);
  const html = await res.text();
  const token = html.match(/<meta name="csrf-token" content="([^"]+)"/)?.[1];
  if (!token) throw new Error("Tata: CSRF token not found (page changed?)");

  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const osSelect = html.match(/id="operating_system-1"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
  const os = [...osSelect.matchAll(/<option[^>]*value="?(\d+)"?[^>]*>([\s\S]*?)<\/option>/g)]
    .map((m) => ({ id: Number(m[1]), name: clean(m[2]) }))
    .find((o) => OS_NAME.test(o.name));
  if (!os) throw new Error("Tata: Ubuntu not found in the operating-system list (page changed?)");

  const call = async <T>(path: string, form?: Record<string, string | number>): Promise<T> => {
    const r = await fetch(BASE + path, {
      method: form ? "POST" : "GET",
      headers: {
        ...UA,
        Cookie: cookie,
        "X-CSRF-TOKEN": token,
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? new URLSearchParams({ ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)])), _token: token }) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`Tata: ${path} responded HTTP ${r.status}`);
    return (await r.json()) as T;
  };
  return { os, call };
}

export const tata: Provider = {
  id: "tata",
  ttlSeconds: 900, // live: refreshed on demand when the dashboard is opened
  async scrape() {
    const { os, call } = await openSession();
    const { series } = await call<{ series?: Series[] }>(`/get-vm-series?location=${COUNTRY}`);
    if (!series?.length) throw new Error("Tata: no VM series returned (API changed?)");

    const out: Snapshot[] = [];
    const tables = await Promise.all(
      series.map(async (s) => {
        const { vmFlavours } = await call<{ vmFlavours?: Flavour[] }>("/get-vm-flavours", {
          series_id: s.id,
          os_id: os.id,
          region: REGION,
        });
        return { s, flavours: vmFlavours ?? [] };
      }),
    );

    for (const { s, flavours } of tables) {
      if (!flavours.length) continue;
      const rows = flavours.map((f) => {
        // The calculator rounds the hourly rate to 2 decimals before multiplying by the hours
        // (D1: 1.41 x 730 = 1,029.30, not 1.4124 x 730 = 1,031.04), so do the same to match it.
        const hourly = Number(Number(f.hourly_rate).toFixed(2));
        return [
          f.flavour_name.split(" ")[0], // "A1 (1 vCPU 1 vRAM)" -> "A1"
          s.series_name,
          String(f.v_cpu),
          String(f.ram),
          inr(hourly),
          inr(hourly * HOURS_PER_MONTH),
          reserved(f.reserved_1_year_per_month_rate, hourly),
          reserved(f.reserved_3_year_per_month_rate, hourly),
        ];
      });
      out.push({
        id: "tata",
        name: "Tata Communications",
        section: `Vayu Cloud - ${os.name}, Series ${s.series_name} (${COUNTRY} / ${REGION}, INR)`,
        source: PAGE,
        fetchedAt: new Date().toISOString(),
        columns: [
          "Plan",
          "Series",
          "vCPUs",
          "RAM (GB)",
          "Hourly",
          `Monthly (hourly x ${HOURS_PER_MONTH})`,
          "Reserved 1-yr /mo",
          "Reserved 3-yr /mo",
        ],
        rows,
      });
    }
    if (!out.length) throw new Error("Tata: no flavours returned for any series (API changed?)");
    return out;
  },
};
