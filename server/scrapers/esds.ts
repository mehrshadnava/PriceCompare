import { clean, loadPage, type Provider } from "./types.js";

const URL = "https://www.esds.co.in/cloud-service-rates";
const WANTED = ["Compute Virtual CPU", "Compute Virtual RAM"];

export const esds: Provider = {
  id: "esds",
  async scrape() {
    const $ = await loadPage(URL);
    const found = new Map<string, string[]>();

    $("tr").each((_, tr) => {
      // cells: [sr no, feature, unit, monthly cost]
      const cells = $(tr)
        .find("td")
        .map((_, td) => clean($(td).text()))
        .get();
      if (cells.length >= 4 && WANTED.includes(cells[1])) found.set(cells[1], cells.slice(1, 4));
    });

    const missing = WANTED.filter((w) => !found.has(w));
    if (missing.length) {
      throw new Error(`ESDS rows not found (layout changed?): ${missing.join(", ")}`);
    }

    return {
      id: "esds",
      name: "ESDS",
      section: "Compute Virtual CPU & RAM",
      source: URL,
      fetchedAt: new Date().toISOString(),
      columns: ["Item", "Unit", "Monthly Cost"],
      rows: WANTED.map((w) => found.get(w)!),
    };
  },
};
