import {
  PKMN_MASTER,
  TRADE_CENTRE_WAIT,
  TRADE_SLOT_1,
  TRADE_SLOT_LAST,
  TRADE_DECLINE,
  TRADE_ACCEPT,
  TRADE_CANCEL_SELECT,
  TYPES,
  encodeName,
  calcStats,
  resolveTid,
  resolveMove,
} from './gen1_constants.js';
import { CableClubAutoSelect } from './gen1_cable_club.js';

const NAME_LEN = 11;
const SELP_LEN = 8;
const POKE_SIZE = 44;
const PARTY_SIZE = 6;
const FULL_LEN = NAME_LEN + SELP_LEN + POKE_SIZE * PARTY_SIZE + NAME_LEN * PARTY_SIZE + NAME_LEN * PARTY_SIZE;
const DATA_BLOCK_LEN = FULL_LEN + 3;
const PATCH_BLOCK_LEN = 197;
const PATCH_DATA_START = 7;

const ConnectionState = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  CABLE_CLUB: 'CABLE_CLUB',
  TRADE_CENTRE: 'TRADE_CENTRE',
};

const TradeState = {
  INIT: 'INIT',
  READY: 'READY',
  DETECTED: 'DETECTED',
  DATA_TX: 'DATA_TX',
  DATA_TX_WAIT: 'DATA_TX_WAIT',
  DATA_TX_RANDOM: 'DATA_TX_RANDOM',
  DATA_TX_PATCH: 'DATA_TX_PATCH',
  TRADE_WAIT: 'TRADE_WAIT',
  TRADE_DONE: 'TRADE_DONE',
  DONE: 'DONE',
};

function buildDataBlock(event, tid) {
  const block = new Uint8Array(DATA_BLOCK_LEN);
  const stats = calcStats(event);
  const trainerName = encodeName('GBLink');
  const otName = encodeName(event.otName);
  const nickName = encodeName(event.nickname);

  block.set(trainerName, 0);

  block[NAME_LEN] = PARTY_SIZE;
  for (let i = 0; i < PARTY_SIZE; i++) {
    block[NAME_LEN + 1 + i] = stats.species;
  }
  block[NAME_LEN + 7] = 0xff;

  const type1 = TYPES[event.type1] ?? stats.type1;
  const type2 = TYPES[event.type2] ?? stats.type2;
  const moves = event.moves.map((k) => resolveMove(k));
  while (moves.length < 4) moves.push({ move: 0, pp: 0 });

  const partyOffset = NAME_LEN + SELP_LEN;
  const pm = buildPartyMember(event, stats, tid, type1, type2, moves);

  for (let slot = 0; slot < PARTY_SIZE; slot++) {
    block.set(pm, partyOffset + slot * POKE_SIZE);
  }

  const otOffset = partyOffset + POKE_SIZE * PARTY_SIZE;
  const nickOffset = otOffset + NAME_LEN * PARTY_SIZE;

  for (let slot = 0; slot < PARTY_SIZE; slot++) {
    block.set(otName, otOffset + slot * NAME_LEN);
    block.set(nickName, nickOffset + slot * NAME_LEN);
  }

  block[FULL_LEN] = 0;
  block[FULL_LEN + 1] = 0;
  block[FULL_LEN + 2] = 0;

  const list1 = [];
  const list2 = [];

  for (let i = 19; i < DATA_BLOCK_LEN; i++) {
    if (block[i] === 0xfe) {
      block[i] = 0xff;
      if (i < 0xfc) {
        list1.push(i - 19 + 1);
      } else {
        list2.push(i - 0xfc - 19 + 1);
      }
    }
  }

  list1.push(0xff);
  list2.push(0xff);

  const patchBlock = new Uint8Array(PATCH_BLOCK_LEN);
  let pos = PATCH_DATA_START;
  for (const b of list1) {
    if (pos >= PATCH_BLOCK_LEN) break;
    patchBlock[pos++] = b;
  }
  for (const b of list2) {
    if (pos >= PATCH_BLOCK_LEN) break;
    patchBlock[pos++] = b;
  }

  return { dataBlock: block, patchBlock };
}

function buildPartyMember(event, stats, tid, type1, type2, moves) {
  const buf = new Uint8Array(POKE_SIZE);
  const { ivs } = stats;

  buf[0] = stats.species;
  buf[1] = (stats.hp >> 8) & 0xff;
  buf[2] = stats.hp & 0xff;
  buf[3] = stats.level;
  buf[4] = 0;
  buf[5] = type1;
  buf[6] = type2;
  buf[7] = event.catchRate ?? 0xff;
  buf[8] = moves[0].move;
  buf[9] = moves[1].move;
  buf[10] = moves[2].move;
  buf[11] = moves[3].move;
  buf[12] = (tid >> 8) & 0xff;
  buf[13] = tid & 0xff;
  const exp = stats.experience;
  buf[14] = (exp >> 16) & 0xff;
  buf[15] = (exp >> 8) & 0xff;
  buf[16] = exp & 0xff;

  const evs = event.evs ?? { hp: 0, atk: 0, def: 0, spd: 0, spc: 0 };
  buf[17] = (evs.hp >> 8) & 0xff;
  buf[18] = evs.hp & 0xff;
  buf[19] = (evs.atk >> 8) & 0xff;
  buf[20] = evs.atk & 0xff;
  buf[21] = (evs.def >> 8) & 0xff;
  buf[22] = evs.def & 0xff;
  buf[23] = (evs.spd >> 8) & 0xff;
  buf[24] = evs.spd & 0xff;
  buf[25] = (evs.spc >> 8) & 0xff;
  buf[26] = evs.spc & 0xff;

  buf[27] = ((ivs.atk & 0xf) << 4) | (ivs.def & 0xf);
  buf[28] = ((ivs.spd & 0xf) << 4) | (ivs.spc & 0xf);
  buf[29] = moves[0].pp;
  buf[30] = moves[1].pp;
  buf[31] = moves[2].pp;
  buf[32] = moves[3].pp;
  buf[33] = stats.level;
  buf[34] = (stats.maxHp >> 8) & 0xff;
  buf[35] = stats.maxHp & 0xff;
  buf[36] = (stats.attack >> 8) & 0xff;
  buf[37] = stats.attack & 0xff;
  buf[38] = (stats.defense >> 8) & 0xff;
  buf[39] = stats.defense & 0xff;
  buf[40] = (stats.speed >> 8) & 0xff;
  buf[41] = stats.speed & 0xff;
  buf[42] = (stats.special >> 8) & 0xff;
  buf[43] = stats.special & 0xff;

  return buf;
}

export class Gen1Trader {
  constructor(event, opts = {}) {
    this.event = event;
    this.onPhaseChange = opts.onPhaseChange ?? (() => {});
    this.tid = resolveTid(event);
    const { dataBlock, patchBlock } = buildDataBlock(event, this.tid);
    this.dataBlock = dataBlock;
    this.patchBlock = patchBlock;
    this.inputBlock = new Uint8Array(DATA_BLOCK_LEN);
    this.cableClub = new CableClubAutoSelect({
      onPhase: (phase) => this.setPhase(phase),
      onReady: () => this.enterTradeCentre(),
    });
    this.reset();
  }

  reset() {
    this.connectionState = ConnectionState.NOT_CONNECTED;
    this.tradeState = TradeState.INIT;
    this.tradeCounter = 0;
    this.tradePokemon = -1;
    this.cableClub.reset();
    this.uiPhase = 'idle';
  }

  setEvent(event) {
    this.event = event;
    this.tid = resolveTid(event);
    const { dataBlock, patchBlock } = buildDataBlock(event, this.tid);
    this.dataBlock = dataBlock;
    this.patchBlock = patchBlock;
  }

  enterTradeCentre() {
    this.connectionState = ConnectionState.TRADE_CENTRE;
    this.tradeState = TradeState.INIT;
    this.setPhase('waiting_cable_club');
  }

  linkIdleOutByte() {
    if (this.connectionState === ConnectionState.CABLE_CLUB) {
      return this.cableClub.outboundByte();
    }
    return PKMN_MASTER;
  }

  handleByte(inputByte) {
    let out = PKMN_MASTER;

    switch (this.connectionState) {
      case ConnectionState.NOT_CONNECTED:
        this.connectionState = ConnectionState.CABLE_CLUB;
        out = this.cableClub.exchange(inputByte);
        break;

      case ConnectionState.CABLE_CLUB:
        out = this.cableClub.exchange(inputByte);
        break;

      case ConnectionState.TRADE_CENTRE:
        out = this.handleTradeCentre(inputByte);
        break;

      default:
        out = inputByte;
        break;
    }

    return out & 0xff;
  }

  handleTradeCentre(inputByte) {
    let out = inputByte;

    switch (this.tradeState) {
      case TradeState.INIT:
        if (inputByte === 0x00) {
          this.tradeCounter = 0;
          this.tradeState = TradeState.READY;
          out = 0x00;
        }
        break;

      case TradeState.READY:
        if (inputByte === TRADE_CENTRE_WAIT) {
          this.tradeState = TradeState.DETECTED;
          out = TRADE_CENTRE_WAIT;
          this.setPhase('handshaking');
        }
        break;

      case TradeState.DETECTED:
        if (inputByte !== TRADE_CENTRE_WAIT) {
          out = inputByte;
          this.tradeState = TradeState.DATA_TX_RANDOM;
        }
        break;

      case TradeState.DATA_TX_RANDOM:
        if (inputByte === TRADE_CENTRE_WAIT) {
          this.tradeState = TradeState.DATA_TX_WAIT;
          out = TRADE_CENTRE_WAIT;
          this.tradeCounter = 0;
        }
        break;

      case TradeState.DATA_TX_WAIT:
        if (inputByte === TRADE_CENTRE_WAIT) {
          out = 0x00;
        } else {
          out = this.dataBlock[0];
          this.inputBlock[0] = inputByte;
          this.tradeState = TradeState.DATA_TX;
          this.tradeCounter = 1;
          this.setPhase('data_exchange');
        }
        break;

      case TradeState.DATA_TX:
        out = this.dataBlock[this.tradeCounter];
        this.inputBlock[this.tradeCounter] = inputByte;
        this.tradeCounter++;
        if (this.tradeCounter === DATA_BLOCK_LEN) {
          this.tradeState = TradeState.DATA_TX_PATCH;
          this.tradeCounter = 0;
        }
        break;

      case TradeState.DATA_TX_PATCH:
        if (inputByte === TRADE_CENTRE_WAIT) {
          this.tradeCounter = 0;
          out = TRADE_CENTRE_WAIT;
        } else {
          out = this.patchBlock[this.tradeCounter];
          this.tradeCounter++;
          if (this.tradeCounter === PATCH_BLOCK_LEN) {
            this.tradeState = TradeState.TRADE_WAIT;
            this.setPhase('trade_selection');
          }
        }
        break;

      case TradeState.TRADE_WAIT:
        if (inputByte === TRADE_CANCEL_SELECT) {
          this.tradeState = TradeState.READY;
          out = TRADE_CANCEL_SELECT;
          this.setPhase('trade_cancelled');
        } else if (inputByte >= TRADE_SLOT_1 && inputByte <= TRADE_SLOT_LAST) {
          out = TRADE_SLOT_1;
          this.tradePokemon = inputByte - TRADE_SLOT_1;
        } else if (inputByte === 0x00) {
          out = 0x00;
          this.tradeState = TradeState.TRADE_DONE;
          this.setPhase('trade_confirm');
        }
        break;

      case TradeState.TRADE_DONE:
        if (inputByte === TRADE_DECLINE) {
          out = TRADE_DECLINE;
          this.tradePokemon = -1;
          this.tradeState = TradeState.TRADE_WAIT;
          this.setPhase('trade_selection');
        } else if (inputByte === TRADE_ACCEPT) {
          out = TRADE_ACCEPT;
          this.tradeState = TradeState.DONE;
          this.setPhase('trading');
        }
        break;

      case TradeState.DONE:
        if (inputByte === 0x00 && this.uiPhase === 'trading') {
          out = 0x00;
          this.setPhase('complete');
          this.tradeState = TradeState.INIT;
          this.connectionState = ConnectionState.NOT_CONNECTED;
          this.cableClub.reset();
        }
        break;

      default:
        out = inputByte;
        break;
    }

    return out;
  }

  setPhase(phase) {
    if (this.uiPhase !== phase) {
      this.uiPhase = phase;
      this.onPhaseChange(phase);
    }
  }
}
