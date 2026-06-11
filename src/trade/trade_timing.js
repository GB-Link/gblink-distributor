export const TRADE_ANIMATION_MS = {
  1: 15_000,
  2: 22_000,
};

export class TradeTimingRecorder {
  constructor() {
    this.reset();
  }

  reset() {
    this.phases = {};
    this.generation = null;
  }

  startSession(generation) {
    this.reset();
    this.generation = generation;
  }

  mark(phase) {
    if (this.phases[phase] != null) return;
    this.phases[phase] = performance.now();
  }

  animationBudgetMs(generation) {
    return TRADE_ANIMATION_MS[generation] ?? TRADE_ANIMATION_MS[1];
  }

  buildReport(generation) {
    const tradingAt = this.phases.trading;
    if (tradingAt == null) return null;

    const linkDoneAt = this.phases.complete;
    const uiDoneAt = this.phases.ui_complete;
    const tradingToLinkDoneMs = linkDoneAt != null
      ? Math.round(linkDoneAt - tradingAt)
      : null;
    const budget = this.animationBudgetMs(generation);
    const waitedMs = uiDoneAt != null && linkDoneAt != null
      ? Math.max(0, Math.round(uiDoneAt - linkDoneAt))
      : null;

    let suggestedBudgetMs = null;
    if (tradingToLinkDoneMs != null) {
      suggestedBudgetMs = Math.max(budget, tradingToLinkDoneMs + 500);
      suggestedBudgetMs = Math.ceil(suggestedBudgetMs / 500) * 500;
    }

    return {
      generation,
      tradingToLinkDoneMs,
      animationBudgetMs: budget,
      suggestedBudgetMs,
      waitedMs,
    };
  }

  formatReport(report) {
    if (!report) return '';
    const genLabel = report.generation === 2 ? 'Gen 2' : 'Gen 1';
    const parts = [`${genLabel} trade timing`];
    if (report.tradingToLinkDoneMs != null) {
      parts.push(`link DONE ${report.tradingToLinkDoneMs}ms after confirm`);
    }
    parts.push(`animation budget ${report.animationBudgetMs}ms`);
    if (report.waitedMs != null && report.waitedMs > 0) {
      parts.push(`UI deferred ${report.waitedMs}ms`);
    }
    if (report.suggestedBudgetMs != null
      && report.suggestedBudgetMs > report.animationBudgetMs) {
      parts.push(`suggest TRADE_ANIMATION_MS[${report.generation}] = ${report.suggestedBudgetMs}`);
    }
    return parts.join(' · ');
  }

  markUiComplete() {
    this.mark('ui_complete');
  }

  markManualAnimationEnd() {
    const tradingAt = this.phases.trading;
    if (tradingAt == null) return null;
    const durationMs = Math.round(performance.now() - tradingAt);
    const suggestedMs = Math.ceil(durationMs / 500) * 500;
    this.phases.manual_animation_end = performance.now();
    return { durationMs, suggestedMs };
  }
}

export function deferUntilAnimationEnd(generation, tradingStartedAt, onReady) {
  const budget = TRADE_ANIMATION_MS[generation] ?? TRADE_ANIMATION_MS[1];
  const elapsed = performance.now() - tradingStartedAt;
  const remaining = Math.max(0, budget - elapsed);
  const timer = setTimeout(onReady, remaining);
  return () => clearTimeout(timer);
}
