import { clean, loadPage, readTable, type Provider } from "./types.js";

const URL = "https://www.ctrls.com/cloud-infrastructure-rate-card/";
const HEADING = "Compute Pricing Section";

export const ctrls: Provider = {
  id: "ctrls",
  async scrape() {
    const $ = await loadPage(URL);

    // Walk headings and tables in document order; take the first table after our heading.
    let seenHeading = false;
    let table: ReturnType<typeof $> | null = null;
    $("h1, h2, h3, h4, table").each((_, el) => {
      if (table) return;
      if (el.tagName === "table") {
        if (seenHeading) table = $(el);
      } else if (clean($(el).text()) === HEADING) {
        seenHeading = true;
      }
    });
    if (!table) throw new Error(`CtrlS: "${HEADING}" table not found (layout changed?)`);

    const { columns, rows } = readTable($, table as ReturnType<typeof $>, "CtrlS");

    return {
      id: "ctrls",
      name: "CtrlS",
      section: HEADING,
      source: URL,
      fetchedAt: new Date().toISOString(),
      columns,
      rows,
    };
  },
};
