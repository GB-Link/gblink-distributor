import { Gen1Trader } from './gen1_trade.js';
import { Gen2Trader } from './gen2_trade.js';

export function createTrader(event, opts = {}) {
  if (event.generation === 2) {
    return new Gen2Trader(event, opts);
  }
  return new Gen1Trader(event, opts);
}

export function eventGeneration(event) {
  return event.generation ?? 1;
}
