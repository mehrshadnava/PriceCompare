import { clean, loadPage, readTable, type Provider, type Snapshot } from "./types.js";

const URL = "https://yntraacloud.ai/pricing/";
const HEADING = "Virtual Machine";
/** The section is split across outer tabs; we take the public-cloud one. */
const OUTER_TAB = "Public Cloud Pricing";

const slug = (s: string) =>
  `yntraa-${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

export const yntraa: Provider = {
  id: "yntraa",
  async scrape() {
    const $ = await loadPage(URL);

    const section = $("h3.table-title")
      .filter((_, el) => clean($(el).text()) === HEADING)
      .first()
      .next(".new-table-container");
    if (!section.length) throw new Error(`Yntraa: "${HEADING}" section not found (layout changed?)`);

    // Outer tabs (pricing model) wrap inner tabs (instance family), each holding one table.
    const outer = section.children(".comm-tab-wrap").first();
    const outerLabels = outer
      .children(".comm-tab-box")
      .find("li")
      .map((_, li) => clean($(li).text()))
      .get();
    const tabIndex = outerLabels.indexOf(OUTER_TAB);
    if (tabIndex < 0) throw new Error(`Yntraa: "${OUTER_TAB}" tab not found (layout changed?)`);

    const pane = outer.children(".tab_container").children(".tab_content").eq(tabIndex);
    const inner = pane.find(".inner-tabs").first();
    const families = inner
      .children(".comm-tab-box")
      .find("li")
      .map((_, li) => clean($(li).text()))
      .get();
    const panes = inner.children(".tab_container").children(".tab_content");

    const fetchedAt = new Date().toISOString();
    const snapshots: Snapshot[] = [];
    families.forEach((family, i) => {
      const table = panes.eq(i).find("table").first();
      if (!table.length) return;
      const { columns, rows } = readTable($, table, `Yntraa ${family}`);
      snapshots.push({
        id: slug(family),
        name: "Yntraa Cloud",
        section: `${HEADING} - ${family} (${OUTER_TAB})`,
        source: URL,
        fetchedAt,
        columns,
        rows,
      });
    });

    if (snapshots.length === 0) {
      throw new Error(`Yntraa: no tables under "${HEADING}" (layout changed?)`);
    }
    return snapshots;
  },
};
