import { clean, type Provider, type Snapshot } from "./types.js";

const API = "https://instances-api.vantage.sh/api/v1/virtual-instances";

/**
 * Free key from instances-api.vantage.sh. Kept out of the source on purpose:
 * export VANTAGE_API_KEY=... before starting the server.
 */
const KEY = process.env.VANTAGE_API_KEY ?? "";

interface VantageResponse {
  headers?: string[];
  instances?: Record<string, string[]>;
}

/** Cells come back as HTML-ish strings, e.g. "<span>$0.0864</span>". */
const text = (cell: string) => clean(String(cell ?? "").replace(/<[^>]*>/g, " "));
const num = (cell: string) => {
  const m = text(cell).match(/-?[\d,]*\.?\d+/);
  const n = m ? Number(m[0].replace(/,/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};

const HOURS_PER_MONTH = 730;

interface Spec {
  id: string;
  name: string;
  /** Vantage's own service key - AWS is "ec2", not "aws" */
  service: string;
  region: string;
  /** provider-specific on-demand Linux price column */
  column: string;
}

export const VANTAGE_SPECS: Spec[] = [
  { id: "aws", name: "AWS", service: "ec2", region: "ap-south-1", column: "costOndemand" },
  { id: "azure", name: "Microsoft Azure", service: "azure", region: "west-india", column: "linuxOndemand" },
  { id: "gcp", name: "Google Cloud", service: "gcp", region: "asia-south1", column: "linuxOndemand" },
];

async function fetchCatalogue(spec: Spec): Promise<VantageResponse> {
  if (!KEY) throw new Error(`${spec.id}: VANTAGE_API_KEY is not set`);
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    // Always request USD. Asking for INR comes back HTTP 200 with zero instances
    // rather than an error, so the failure is silent - convert in here instead.
    body: JSON.stringify({
      service: spec.service,
      region: spec.region,
      columns: [
        { key: "instanceType" },
        { key: "vCPU" },
        { key: "memory" },
        { key: spec.column },
      ],
      costDuration: "monthly",
      pricingUnit: "instance",
      currency: "USD",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`${spec.id}: Vantage responded HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as VantageResponse;
}

export function vantageProvider(spec: Spec): Provider {
  return {
    id: spec.id,
    async scrape(): Promise<Snapshot> {
      const body = await fetchCatalogue(spec);
      const instances = Object.values(body.instances ?? {});
      if (instances.length === 0) {
        throw new Error(`${spec.id}: Vantage returned no instances for ${spec.region}`);
      }

      // Vantage returns columns in its own order (e.g. name, memory, vCPUs, price), not the
      // order we asked for, so locate each one by its header rather than by position.
      const heads = (body.headers ?? []).map((h) => text(h));
      const at = (re: RegExp, fallback: number) => {
        const i = heads.findIndex((h) => re.test(h));
        return i >= 0 ? i : fallback;
      };
      const iName = at(/name|type/i, 0);
      const iVcpu = at(/vcpu/i, 1);
      const iRam = at(/memory|ram/i, 2);
      const iPrice = at(/demand|price|cost/i, 3);
      if (new Set([iName, iVcpu, iRam, iPrice]).size !== 4) {
        throw new Error(`${spec.id}: unexpected Vantage headers: ${heads.join(", ")}`);
      }

      const parsed = instances
        .map((cells) => ({
          plan: text(cells[iName]),
          vcpu: num(cells[iVcpu]),
          ram: num(cells[iRam]),
          usd: num(cells[iPrice]),
        }))
        .filter((r) => r.plan && r.vcpu && r.ram && r.usd);
      if (parsed.length === 0) {
        throw new Error(`${spec.id}: no priceable instances in Vantage's reply (shape changed?)`);
      }

      // costDuration is meant to give a monthly figure, but guard against an
      // hourly one slipping through: a real monthly price is tens of dollars
      // per vCPU, an hourly one is a few cents.
      const perVcpu = parsed.map((r) => r.usd! / r.vcpu!).sort((a, b) => a - b);
      const median = perVcpu[Math.floor(perVcpu.length / 2)];
      const hourly = median < 1;
      const basis = hourly ? "hourly x 730" : "monthly";

      const rows = parsed
        .sort((a, b) => a.vcpu! - b.vcpu! || a.ram! - b.ram!)
        .map((r) => {
          const usd = hourly ? r.usd! * HOURS_PER_MONTH : r.usd!;
          return [r.plan, String(r.vcpu), String(r.ram), `$${usd.toFixed(2)}`];
        });

      return {
        id: spec.id,
        name: spec.name,
        section: `On-demand Linux, ${spec.region} (${rows.length} instances, ${basis})`,
        source: "https://instances.vantage.sh/",
        fetchedAt: new Date().toISOString(),
        columns: ["Plan", "vCPUs", "RAM, GB", "Monthly"],
        rows,
      };
    },
  };
}

export const [aws, azure, gcp] = VANTAGE_SPECS.map(vantageProvider);
