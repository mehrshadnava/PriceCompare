import { useEffect, useState } from "react";

interface Rate {
  item: string;
  unit: string;
  price: number | null;
  display: string;
}
interface Snapshot {
  source: string;
  fetchedAt: string;
  rates: Rate[];
}

export default function App() {
  const [data, setData] = useState<Snapshot | null>(null);
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
      <h1>ESDS Cloud Rates</h1>
      {loading && <p>Loading...</p>}
      {!loading && !data && <p>No data yet - first fetch in progress. Refresh in a few seconds.</p>}
      {data && (
        <>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Unit</th>
                <th>Monthly Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.rates.map((r) => (
                <tr key={r.item}>
                  <td>{r.item}</td>
                  <td>{r.unit}</td>
                  <td className="price">{r.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <small>
            Last fetched: {new Date(data.fetchedAt).toLocaleString()} | Source:{" "}
            <a href={data.source}>{data.source}</a> | Refreshes daily
          </small>
        </>
      )}
    </main>
  );
}
