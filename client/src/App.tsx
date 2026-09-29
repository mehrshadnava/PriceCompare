import { Fragment, useEffect, useState } from "react";

interface Snapshot {
  id: string;
  name: string;
  section: string;
  source: string;
  fetchedAt: string;
  columns: string[];
  rows: string[][];
}

interface Match {
  plan: string;
  price: number;
  approx: boolean;
  savingPct: number;
}

interface BattleRow {
  family: string;
  plan: string;
  vcpu: number;
  ram: number;
  price: number;
  competitors: Record<string, Match | null>;
}

interface Competitor {
  id: string;
  name: string;
  source: string;
  note?: string;
}

interface BattleCard {
  generatedAt: string;
  usdInr: number;
  competitors: Competitor[];
  rows: BattleRow[];
  /** providers whose latest scrape failed; their last good data is still shown */
  warnings?: string[];
}

const rupees = (n: number) =>
  `₹ ${Math.round(n).toLocaleString("en-IN")}`;

/** Yntraa's own plan, spec and price - the anchor every row is measured against. */
function YntraaCell({ row }: { row: BattleRow }) {
  return (
    <>
      <td className="plan anchor-plan">
        <strong>{row.plan}</strong>
        <span className="spec">
          {row.vcpu} vCPU / {row.ram} GB RAM
        </span>
      </td>
      <td className="price anchor-price">{rupees(row.price)}</td>
    </>
  );
}

function CompetitorCells({ match }: { match: Match | null }) {
  if (!match) {
    return (
      <>
        <td className="plan na">N/A</td>
        <td className="price na">N/A</td>
        <td className="delta na">-</td>
      </>
    );
  }
  return (
    <>
      <td className="plan">
        {match.plan}
        {match.approx && <span className="spec">closest spec</span>}
      </td>
      <td className="price">{rupees(match.price)}</td>
      <td className={`delta ${match.savingPct > 0 ? "cheaper" : "dearer"}`}>
        {Math.abs(match.savingPct)}%
      </td>
    </>
  );
}

function BattleCardTable({ card, competitors }: { card: BattleCard; competitors: Competitor[] }) {
  let family = "";
  return (
    <div className="scroll card">
      <table className="battle">
        <thead>
          <tr className="brands">
            <th colSpan={2} className="brand anchor">
              Yntraa Cloud
            </th>
            {competitors.map((c) => (
              <th key={c.id} colSpan={3} className="brand">
                {c.name}
                {c.note && <span className="brand-note">{c.note}</span>}
              </th>
            ))}
          </tr>
          <tr className="labels">
            <th className="anchor">Plans</th>
            <th className="anchor">Price</th>
            {competitors.map((c) => [
              <th key={`${c.id}-p`}>Plans</th>,
              <th key={`${c.id}-r`}>Price</th>,
              <th key={`${c.id}-d`}>(%)</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {card.rows.map((row, i) => {
            const newFamily = row.family !== family;
            family = row.family;
            return (
              <Fragment key={i}>
                {newFamily && (
                  <tr className="family">
                    <td className="family-name" colSpan={2}>
                      {row.family}
                    </td>
                    {competitors.length > 0 && <td colSpan={competitors.length * 3} />}
                  </tr>
                )}
                <tr>
                  <YntraaCell row={row} />
                  {competitors.map((c) => (
                    <CompetitorCells key={c.id} match={row.competitors[c.id]} />
                  ))}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProviderTable({ s }: { s: Snapshot }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <h3>
        <button
          className={`collapse ${open ? "is-open" : ""}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="title">
            {s.name} <span className="section">{s.section}</span>
          </span>
          <span className="count">{s.rows.length} rows</span>
          <span className="action">
            {open ? "Hide" : "Show"}
            <span className="chev" aria-hidden="true">
              ▾
            </span>
          </span>
        </button>
      </h3>
      {open && (
      <>
      <div className="scroll card">
        <table className="raw">
          <thead>
            <tr>
              {s.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  // a short row (e.g. a note) stretches its last cell across the table
                  <td
                    key={j}
                    colSpan={j === row.length - 1 ? s.columns.length - j : 1}
                    className={/^[₹$]/.test(cell) ? "price" : undefined}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>
        Fetched {new Date(s.fetchedAt).toLocaleString()} ·{" "}
        <a href={s.source}>{s.source}</a>
      </small>
      </>
      )}
    </section>
  );
}

export default function App() {
  const [card, setCard] = useState<BattleCard | null>(null);
  const [rates, setRates] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  // null until the card arrives; then every competitor starts selected
  const [picked, setPicked] = useState<string[] | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/battlecard").then((r) => r.json()),
      fetch("/api/rates").then((r) => r.json()),
    ])
      .then(([c, r]: [BattleCard, Snapshot[]]) => {
        setCard(c);
        setRates(r);
        setPicked(c.competitors.map((x) => x.id));
      })
      .catch(() => setCard(null))
      .finally(() => setLoading(false));
  }, []);

  const matched = (id: string) => card?.rows.filter((r) => r.competitors[id]).length ?? 0;
  const chosen = card?.competitors.filter((c) => picked?.includes(c.id)) ?? [];
  const toggle = (id: string) =>
    setPicked((prev) =>
      prev?.includes(id) ? prev.filter((x) => x !== id) : [...(prev ?? []), id],
    );

  return (
    <main>
      <header>
        <h1>
          <span className="mark">Yntraa Cloud</span> Battle Card
        </h1>
      </header>

      {loading && <p className="status">Loading rate cards...</p>}
      {!loading && !card && <p className="status">No data yet - first fetch in progress. Refresh shortly.</p>}

      {card && (
        <>
          {card.warnings && card.warnings.length > 0 && (
            <div className="warning" role="alert">
              <strong>Some rates may be out of date</strong>
              <ul>
                {card.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="picker">
            <span className="picker-label">Compare against</span>
            {card.competitors.map((c) => {
              const on = picked?.includes(c.id) ?? false;
              return (
                <button
                  key={c.id}
                  className={`chip ${on ? "on" : ""}`}
                  onClick={() => toggle(c.id)}
                  aria-pressed={on}
                >
                  {c.name}
                  <em>
                    {matched(c.id)}/{card.rows.length}
                  </em>
                </button>
              );
            })}
          </div>
          {chosen.length === 0 && (
            <p className="status">Pick at least one competitor to compare against.</p>
          )}
          <BattleCardTable card={card} competitors={chosen} />
          <p className="foot">
            Monthly recurring charges, matched on vCPU count with RAM within 15%. Windows
            SKUs are excluded so licence costs don't skew the comparison. AWS, Azure and
            Google Cloud are on-demand Linux in their Mumbai regions via{" "}
            <a href="https://instances.vantage.sh/">Vantage</a>, and along with E2E are
            converted at ₹{card.usdInr}/USD. Built{" "}
            {new Date(card.generatedAt).toLocaleString()}.
          </p>
        </>
      )}

      {rates.length > 0 && (
        <section className="raw-section">
          <button className="toggle" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Hide" : "Show"} source rate cards ({rates.length})
          </button>
          {showRaw && rates.map((s) => <ProviderTable key={s.id} s={s} />)}
        </section>
      )}
    </main>
  );
}
