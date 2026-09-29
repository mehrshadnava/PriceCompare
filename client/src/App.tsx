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
        {Math.abs(match.savingPct)}%<span className="arrow">{match.savingPct > 0 ? "↓" : "↑"}</span>
      </td>
    </>
  );
}

function BattleCardTable({ card }: { card: BattleCard }) {
  let family = "";
  return (
    <div className="scroll card">
      <table className="battle">
        <thead>
          <tr className="brands">
            <th colSpan={2} className="brand anchor">
              Yntraa Cloud
            </th>
            {card.competitors.map((c) => (
              <th key={c.id} colSpan={3} className="brand">
                {c.name}
                {c.note && <span className="brand-note">{c.note}</span>}
              </th>
            ))}
          </tr>
          <tr className="labels">
            <th className="anchor">Plans</th>
            <th className="anchor">Price</th>
            {card.competitors.map((c) => [
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
                    <td colSpan={2 + card.competitors.length * 3}>{row.family}</td>
                  </tr>
                )}
                <tr>
                  <YntraaCell row={row} />
                  {card.competitors.map((c) => (
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
  return (
    <section>
      <h3>
        {s.name} <span className="section">{s.section}</span>
      </h3>
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
    </section>
  );
}

export default function App() {
  const [card, setCard] = useState<BattleCard | null>(null);
  const [rates, setRates] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/battlecard").then((r) => r.json()),
      fetch("/api/rates").then((r) => r.json()),
    ])
      .then(([c, r]) => {
        setCard(c);
        setRates(r);
      })
      .catch(() => setCard(null))
      .finally(() => setLoading(false));
  }, []);

  const matched = (id: string) => card?.rows.filter((r) => r.competitors[id]).length ?? 0;

  return (
    <main>
      <header>
        <h1>
          <span className="mark">Yntraa Cloud</span> Battle Card
        </h1>
        <p className="lede">
          Every Yntraa virtual machine SKU, matched to the nearest equivalent from each
          competitor. Where nobody sells the same shape, the row reads N/A.
        </p>
      </header>

      {loading && <p className="status">Loading rate cards...</p>}
      {!loading && !card && <p className="status">No data yet - first fetch in progress. Refresh shortly.</p>}

      {card && (
        <>
          <div className="stats">
            <div className="stat">
              <b>{card.rows.length}</b>
              <span>Yntraa SKUs</span>
            </div>
            {card.competitors.map((c) => (
              <div className="stat" key={c.id}>
                <b>
                  {matched(c.id)}
                  <small>/{card.rows.length}</small>
                </b>
                <span>{c.name} matches</span>
              </div>
            ))}
          </div>
          <BattleCardTable card={card} />
          <p className="foot">
            Monthly recurring charges, matched on vCPU count with RAM within 15%. Windows
            SKUs are excluded so licence costs don't skew the comparison. E2E prices
            converted at ₹{card.usdInr}/USD. Built {new Date(card.generatedAt).toLocaleString()}.
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
