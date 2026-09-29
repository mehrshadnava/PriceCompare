import { useEffect, useState } from "react";

interface Snapshot {
  id: string;
  name: string;
  section: string;
  source: string;
  fetchedAt: string;
  columns: string[];
  rows: string[][];
}

function ProviderTable({ s }: { s: Snapshot }) {
  return (
    <section>
      <h2>{s.name}</h2>
      <p className="section">{s.section}</p>
      <div className="scroll">
        <table>
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
                    className={/^₹/.test(cell) ? "price" : undefined}
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
        Last fetched: {new Date(s.fetchedAt).toLocaleString()} | Source:{" "}
        <a href={s.source}>{s.source}</a>
      </small>
    </section>
  );
}

export default function App() {
  const [data, setData] = useState<Snapshot[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/rates")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main>
      <h1>Cloud Rate Comparison</h1>
      {loading && <p>Loading...</p>}
      {!loading && (!data || data.length === 0) && (
        <p>No data yet - first fetch in progress. Refresh in a few seconds.</p>
      )}
      {data?.map((s) => <ProviderTable key={s.id} s={s} />)}
      <small>Rates refresh daily.</small>
    </main>
  );
}
