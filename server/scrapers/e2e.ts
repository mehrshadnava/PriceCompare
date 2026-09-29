import { clean, loadPage, readTable, type Provider, type Snapshot } from "./types.js";

const URL = "https://www.e2enetworks.com/pricing";
const HEADING = "CPU instances";

/** "High-Performance Computing SSD Series C3" -> "e2e-high-performance-computing-ssd-series-c3" */
const slug = (s: string) =>
  `e2e-${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

export const e2e: Provider = {
  id: "e2e",
  async scrape() {
    const $ = await loadPage(URL);
    const fetchedAt = new Date().toISOString();
    const snapshots: Snapshot[] = [];

    // The page lists each instance series as an <h4> followed by its table, all under
    // the "CPU instances" <h3>. Walk in document order and stop at the next <h3>
    // (the section that follows is "Storage Solutions", which we don't want).
    let inSection = false;
    let series = "";
    $("h3, h4, table").each((_, el) => {
      if (el.tagName === "h3") {
        inSection = clean($(el).text()) === HEADING;
        series = "";
      } else if (!inSection) {
        return;
      } else if (el.tagName === "h4") {
        series = clean($(el).text());
      } else if (series) {
        const { columns, rows } = readTable($, $(el), `E2E ${series}`);
        snapshots.push({
          id: slug(series),
          name: "E2E Networks",
          section: series,
          source: URL,
          fetchedAt,
          columns,
          rows,
        });
        series = "";
      }
    });

    if (snapshots.length === 0) {
      throw new Error(`E2E: no tables under "${HEADING}" (layout changed?)`);
    }
    return snapshots;
  },
};
