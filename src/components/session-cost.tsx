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

  // Deliberately focusable plain text (not aria-live) so a screen-reader user can tab
  // to the per-model cost breakdown in the title on demand, without any per-turn
  // announcement.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="session-cost" data-testid="session-cost" tabIndex={0}
      title={`Estimated from list prices as of ${summary.asOf}. ${perModel}`}>
      Est. session cost: {fmtCost(summary.totals.totalCost)}{" "}
      ({fmtTokens(summary.totals.input)} in / {fmtTokens(summary.totals.output)} out)
    </div>
  );
});
