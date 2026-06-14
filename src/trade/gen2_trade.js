import {
  PKMN_BLANK,
  PKMN_MASTER,
  PKMN_SLAVE,
  PKMN_BREAK_LINK,
  TRADE_CENTRE_WAIT,
  TRADE_SLOT_1,
  TRADE_SLOT_LAST,
  TRADE_DECLINE,
  TRADE_ACCEPT,
  TRADE_CANCEL_SELECT,
  encodeName,
  calcStats,
  resolveTid,
  resolveMove,
} from './gen2_constants.js';
import { Gen2CableClubAutoSelect } from './gen2_cable_club.js';

const NAME_LEN = 11;
const PARTY_HEADER_LEN = 8;
const PLAYER_ID_LEN = 2;
const POKE_SIZE = 48;
const PARTY_SIZE = 6;
const FULL_LEN =
  NAME_LEN + PARTY_HEADER_LEN + PLAYER_ID_LEN
  + POKE_SIZE * PARTY_SIZE + NAME_LEN * PARTY_SIZE + NAME_LEN * PARTY_SIZE;
const DATA_BLOCK_LEN = FULL_LEN + 3;
const PATCH_BLOCK_LEN = 197;
const PATCH_DATA_START = 7;
const MAIL_BLOCK_LEN = 385;
const PATCH_SCAN_START = NAME_LEN + PARTY_HEADER_LEN;

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
  DATA_TX_MAIL: 'DATA_TX_MAIL',
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
  const moves = event.moves.map((k) => resolveMove(k));
  while (moves.length < 4) moves.push({ move: 0, pp: 0 });

  block.set(trainerName, 0);
  block[NAME_LEN] = PARTY_SIZE;
  for (let i = 0; i < PARTY_SIZE; i++) {
    block[NAME_LEN + 1 + i] = stats.species;
  }
  block[NAME_LEN + 7] = 0xff;

  const idOffset = NAME_LEN + PARTY_HEADER_LEN;
  block[idOffset] = (tid >> 8) & 0xff;
  block[idOffset + 1] = tid & 0xff;

  const partyOffset = idOffset + PLAYER_ID_LEN;
  const pm = buildPartyMember(event, stats, tid, moves);
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
  for (let i = PATCH_SCAN_START; i < DATA_BLOCK_LEN; i++) {
    if (block[i] === 0xfe) {
      block[i] = 0xff;
      if (i < 0xfc) {
        list1.push(i - PATCH_SCAN_START + 1);
      } else {
        list2.push(i - 0xfc - PATCH_SCAN_START + 1);
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

  const mailBlock = buildMailBlock();

  return { dataBlock: block, patchBlock, mailBlock };
}

function buildMailBlock() {
  return new Uint8Array(MAIL_BLOCK_LEN);
}

function buildPartyMember(event, stats, tid, moves) {
  const buf = new Uint8Array(POKE_SIZE);
  const { ivs } = stats;
  const evs = event.evs ?? { hp: 0, atk: 0, def: 0, spd: 0, spc: 0 };

  buf[0] = stats.species;
  buf[1] = event.heldItem ?? 0;
  buf[2] = moves[0].move;
  buf[3] = moves[1].move;
  buf[4] = moves[2].move;
  buf[5] = moves[3].move;
  buf[6] = (tid >> 8) & 0xff;
  buf[7] = tid & 0xff;
  const exp = stats.experience;
  buf[8] = (exp >> 16) & 0xff;
  buf[9] = (exp >> 8) & 0xff;
  buf[10] = exp & 0xff;

  buf[11] = (evs.hp >> 8) & 0xff;
  buf[12] = evs.hp & 0xff;
  buf[13] = (evs.atk >> 8) & 0xff;
  buf[14] = evs.atk & 0xff;
  buf[15] = (evs.def >> 8) & 0xff;
  buf[16] = evs.def & 0xff;
  buf[17] = (evs.spd >> 8) & 0xff;
  buf[18] = evs.spd & 0xff;
  buf[19] = (evs.spc >> 8) & 0xff;
  buf[20] = evs.spc & 0xff;

  buf[21] = ((ivs.atk & 0xf) << 4) | (ivs.def & 0xf);
  buf[22] = ((ivs.spd & 0xf) << 4) | (ivs.spc & 0xf);
  buf[23] = moves[0].pp;
  buf[24] = moves[1].pp;
  buf[25] = moves[2].pp;
  buf[26] = moves[3].pp;
  buf[27] = event.happiness ?? 0;
  buf[28] = 0;
  const caught = event.caughtData ?? 0;
  buf[29] = (caught >> 8) & 0xff;
  buf[30] = caught & 0xff;
  buf[31] = stats.level;
  buf[32] = 0;
  buf[33] = 0;
  buf[34] = (stats.maxHp >> 8) & 0xff;
  buf[35] = stats.maxHp & 0xff;
  buf[36] = (stats.maxHp >> 8) & 0xff;
  buf[37] = stats.maxHp & 0xff;
  buf[38] = (stats.attack >> 8) & 0xff;
  buf[39] = stats.attack & 0xff;
  buf[40] = (stats.defense >> 8) & 0xff;
  buf[41] = stats.defense & 0xff;
  buf[42] = (stats.speed >> 8) & 0xff;
  buf[43] = stats.speed & 0xff;
  buf[44] = (stats.specialAtk >> 8) & 0xff;
  buf[45] = stats.specialAtk & 0xff;
  buf[46] = (stats.specialDef >> 8) & 0xff;
  buf[47] = stats.specialDef & 0xff;

  return buf;
}

export class Gen2Trader {
  constructor(event, opts = {}) {
    this.event = event;
    this.onPhaseChange = opts.onPhaseChange ?? (() => {});
    this.tid = resolveTid(event);
    const { dataBlock, patchBlock, mailBlock } = buildDataBlock(event, this.tid);
    this.dataBlock = dataBlock;
    this.patchBlock = patchBlock;
    this.mailBlock = mailBlock;
    this.cableClub = new Gen2CableClubAutoSelect({
      onPhase: (phase) => this.setPhase(phase),
      onReady: () => this.enterTradeCentre(),
    });
    this.reset();
  }

  reset() {
    this.tradeState = TradeState.INIT;
    this.tradeCounter = 0;
    this.tradePokemon = -1;
    this.tradeAccepted = false;
    this.uiPhase = 'idle';
    this.beginCableClub();
  }

  reopenCableClub() {
    this.tradeState = TradeState.INIT;
    this.tradeCounter = 0;
    this.tradePokemon = -1;
    this.tradeAccepted = false;
    this.beginCableClub();
    this.setPhase('menu_cancelled');
  }

  beginCableClub() {
    this.connectionState = ConnectionState.CABLE_CLUB;
    this.cableClub.reset();
  }

  enterTradeCentre() {
    this.connectionState = ConnectionState.TRADE_CENTRE;
    this.tradeState = TradeState.INIT;
    this.setPhase('waiting_cable_club');
  }

  setEvent(event) {
    this.event = event;
    this.tid = resolveTid(event);
    const { dataBlock, patchBlock, mailBlock } = buildDataBlock(event, this.tid);
    this.dataBlock = dataBlock;
    this.patchBlock = patchBlock;
    this.mailBlock = mailBlock;
  }

  linkIdleOutByte() {
    if (this.connectionState === ConnectionState.CABLE_CLUB) {
      return this.cableClub.outboundByte();
    }
    return PKMN_MASTER;
  }

  linkPollDelayMs(inLinkSetup) {
    if (!inLinkSetup) return 4;
    if (this.connectionState === ConnectionState.CABLE_CLUB && this.cableClub.step === 0) {
      return 2;
    }
    return 8;
  }

  handleByte(inputByte) {
    let out = PKMN_MASTER;

    switch (this.connectionState) {
      case ConnectionState.NOT_CONNECTED:
        this.beginCableClub();
        out = this.cableClub.exchange(inputByte);
        break;

      case ConnectionState.CABLE_CLUB:
        if (inputByte === PKMN_BREAK_LINK) {
          out = PKMN_BREAK_LINK;
          this.reopenCableClub();
          break;
        }
        out = this.cableClub.exchange(inputByte);
        break;

      case ConnectionState.TRADE_CENTRE:
        if (inputByte === PKMN_BREAK_LINK) {
          out = PKMN_BREAK_LINK;
          this.reopenCableClub();
        } else {
          out = this.handleTradeCentre(inputByte);
        }
        break;

      default:
        out = inputByte;
        break;
    }

    return out & 0xff;
  }

  handleTradeCentre(inputByte) {
    if (this.uiPhase === 'complete') {
      return inputByte;
    }

    let out = inputByte;

    switch (this.tradeState) {
      case TradeState.INIT:
        if (inputByte === PKMN_MASTER || inputByte === PKMN_SLAVE) {
          this.beginCableClub();
          out = PKMN_MASTER;
        } else if ((inputByte & 0xf0) === 0xd0) {
          out = inputByte;
        } else if (inputByte === 0x00) {
          this.tradeCounter = 0;
          this.tradeState = TradeState.READY;
          out = 0x00;
        } else if (inputByte === 0x75) {
          out = 0x75;
        } else if (inputByte === 0x76) {
          out = 0x76;
        }
        break;

      case TradeState.READY:
        if (inputByte === TRADE_CENTRE_WAIT) {
          this.tradeState = TradeState.DETECTED;
          out = TRADE_CENTRE_WAIT;
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
        } else {
          out = inputByte;
        }
        break;

      case TradeState.DATA_TX_WAIT:
        if (inputByte === TRADE_CENTRE_WAIT) {
          out = 0x00;
        } else {
          out = this.dataBlock[0];
          this.tradeState = TradeState.DATA_TX;
          this.tradeCounter = 1;
          this.setPhase('data_exchange');
        }
        break;

      case TradeState.DATA_TX:
        out = this.dataBlock[this.tradeCounter];
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
            this.tradeState = TradeState.DATA_TX_MAIL;
            this.tradeCounter = 0;
          }
        }
        break;

      case TradeState.DATA_TX_MAIL:
        if (inputByte === TRADE_CENTRE_WAIT) {
          out = TRADE_CENTRE_WAIT;
        } else if (this.tradeCounter === 0 && inputByte === 0x20) {
          out = 0x20;
        } else {
          out = this.mailBlock[this.tradeCounter];
          this.tradeCounter++;
          if (this.tradeCounter === MAIL_BLOCK_LEN) {
            this.tradeState = TradeState.TRADE_WAIT;
            this.tradePokemon = -1;
            if (this.tradeAccepted) {
              this.setPhase('post_trade_party');
            } else {
              this.setPhase('trade_selection');
            }
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
          this.setPhase('trade_selection');
        } else if (inputByte === 0x00) {
          out = 0x00;
          if (this.tradePokemon >= 0) {
            this.tradeState = TradeState.TRADE_DONE;
            this.setPhase('trade_confirm');
          }
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
          this.tradeAccepted = true;
          this.setPhase('trading');
        }
        break;

      case TradeState.DONE:
        if (inputByte === 0x00 && this.uiPhase === 'trading') {
          out = 0x00;
          this.tradeState = TradeState.INIT;
        }
        break;

      default:
        break;
    }

    return out;
  }

  setPhase(phase) {
    if (this.uiPhase === 'complete') return;
    if (this.uiPhase === 'trading' && phase !== 'post_trade_party') return;
    if (this.uiPhase !== phase) {
      this.uiPhase = phase;
      this.onPhaseChange(phase);
    }
  }
}
