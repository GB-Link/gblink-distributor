import {
  PKMN_BLANK,
  PKMN_MASTER,
  PKMN_SLAVE,
  PKMN_CONNECTED,
  PKMN_TRADE_CENTRE,
  PKMN_BREAK_LINK,
} from './gen2_constants.js';

const PKMN_CONNECTED_GEN2 = 0x61;

function isClockByte(byte) {
  return byte === PKMN_MASTER || byte === PKMN_SLAVE;
}

const TRADE_CENTER_SELECT_STEPS = [
  { out: PKMN_MASTER, match: (b) => b === PKMN_CONNECTED_GEN2, phase: 'connected' },
  { out: PKMN_CONNECTED, match: (b) => b === PKMN_CONNECTED_GEN2, phase: 'waiting_cable_club' },
];

export class Gen2CableClubAutoSelect {
  constructor(callbacks = {}) {
    this.onPhase = callbacks.onPhase ?? (() => {});
    this.onReady = callbacks.onReady ?? (() => {});
    this.reset();
  }

  reset() {
    this.step = 0;
    this.sawClock = false;
  }

  done() {
    return this.step >= TRADE_CENTER_SELECT_STEPS.length;
  }

  outboundByte() {
    if (this.done()) {
      return PKMN_MASTER;
    }
    return TRADE_CENTER_SELECT_STEPS[this.step].out;
  }

  exchange(inByte) {
    if (inByte === PKMN_BLANK) {
      return PKMN_BLANK;
    }
    if (inByte === PKMN_BREAK_LINK) {
      this.reset();
      return PKMN_BREAK_LINK;
    }

    if (isClockByte(inByte)) {
      this.sawClock = true;
      if (this.step > 0) {
        this.step = 0;
      }
      return PKMN_MASTER;
    }

    const current = TRADE_CENTER_SELECT_STEPS[this.step];
    if (current && current.match(inByte)) {
      if (this.step === 0 && !this.sawClock) {
        return this.outboundByte();
      }
      if (current.phase) {
        this.onPhase(current.phase);
      }
      this.step += 1;
      if (this.done()) {
        this.onReady();
        return PKMN_TRADE_CENTRE;
      }
      return TRADE_CENTER_SELECT_STEPS[this.step].out;
    }

    return this.outboundByte();
  }
}
