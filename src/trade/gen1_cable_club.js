import {
  PKMN_BLANK,
  PKMN_MASTER,
  PKMN_CONNECTED,
  PKMN_TRADE_CENTRE,
  PKMN_BREAK_LINK,
  ITEM_1_HIGHLIGHTED,
} from './gen1_constants.js';

function isLinkNybble(byte) {
  return (byte & 0xf0) === PKMN_CONNECTED;
}

function isReceptionMenuByte(byte) {
  return byte >= ITEM_1_HIGHLIGHTED && byte <= PKMN_TRADE_CENTRE;
}

const TRADE_CENTER_SELECT_STEPS = [
  { out: PKMN_MASTER, match: isLinkNybble, phase: 'connected' },
  { out: PKMN_CONNECTED, match: isReceptionMenuByte, phase: 'handshaking' },
  { out: ITEM_1_HIGHLIGHTED, match: isReceptionMenuByte, phase: 'waiting_cable_club' },
  { out: PKMN_TRADE_CENTRE, match: isLinkNybble, phase: null },
];

export class CableClubAutoSelect {
  constructor(callbacks = {}) {
    this.onPhase = callbacks.onPhase ?? (() => {});
    this.onReady = callbacks.onReady ?? (() => {});
    this.reset();
  }

  reset() {
    this.step = 0;
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
      return PKMN_BREAK_LINK;
    }

    const current = TRADE_CENTER_SELECT_STEPS[this.step];
    if (current && current.match(inByte)) {
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
