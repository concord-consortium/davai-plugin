import React from "react";
import { observer } from "mobx-react-lite";
import { useAppConfigContext } from "../contexts/app-config-context";
import { useRootStore } from "../contexts/root-store-context";

const fmtTokens = (n: number) => n.toLocaleString("en-US");
const fmtCost = (n?: number) => (n === undefined ? "n/a" : `$${n.toFixed(4)}`);

// Dev-mode-only running estimate of what this session has cost so far, using
// provider-reported usage and the bundled list-price table (caching-aware).
// Deliberately NOT aria-live: a per-turn cost ticker would spam screen readers;
// the element is ordinary focusable text a user can navigate to on demand.
export const SessionCost = observer(() => {
  const appConfig = useAppConfigContext();
  const { assistantStore } = useRootStore();
  const summary = assistantStore.sessionCostSummary;

  if (!appConfig.isDevMode || summary.models.length === 0) return null;

  const perModel = summary.models
    .map((m: any) => `${m.model}: ${fmtCost(m.totalCost)} (${fmtTokens(m.input)} in / ${fmtTokens(m.output)} out)`)
    .join("; ");

  // role="note" makes the aria-label valid (bare divs are name-from-author-prohibited
  // under ARIA 1.2), and the label leads with the session total because aria-label
  // REPLACES the visible text in the accessible name; title is kept for sighted hover.
  const breakdown = `Estimated from list prices as of ${summary.asOf}. ${perModel}`;
  const label = `Estimated session cost ${fmtCost(summary.totals.totalCost)}. ${breakdown}`;
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="session-cost" data-testid="session-cost" tabIndex={0} role="note"
      title={breakdown} aria-label={label}>
      Est. session cost: {fmtCost(summary.totals.totalCost)}{" "}
      ({fmtTokens(summary.totals.input)} in / {fmtTokens(summary.totals.output)} out)
    </div>
  );
});
