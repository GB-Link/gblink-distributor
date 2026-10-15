import * as gblink from '../link/gblink.js';
import {
  LINK,
  blockExchanges,
  bytesToWords,
  commandExchange,
  linkPlayerBlock,
  payloadBytes,
  trainerCardBlock,
} from './gen3_blocks.js';
import { buildPartyPokemon, chooseVariant } from './gen3_pokemon.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HANDSHAKE_WORD = new Set([0xb9a0, 0x8fff, 0xd15e]);
const CLOSE_CANCEL = 12;
const CLOSE_START_TRADE = 32;
const SEAT_PATH = [
  LINK.KEY_UP,
  LINK.KEY_UP,
  LINK.KEY_LEFT,
  LINK.KEY_UP,
  LINK.KEY_RIGHT,
  LINK.KEY_READY,
];

export class Gen3Trader {
  constructor(event, opts = {}) {
    this.event = event;
    this.opts = opts;
    this.uiPhase = 'idle';
    this._tid = 0;
    this._sid = 0;
    this.delivered = null;
    this.partnerGame = 3;
    this._queue = [];
    this._phase = 'lobby';
    this._blockState = 'needPlayer';
    this._linkType = LINK.TRADE_SETUP;
    this._sentReady = false;
    this._seatIndex = 0;
    this._inRoom = false;
    this._relinkAt = 0;
    this._relinkHandshakeSent = false;
    this._partySliceIndex = 0;
    this._sawVersion = false;
    this._followup = null;
    this._requestQueue = [];
    this._expectRelink = false;
    this._sawHandshakeWord = false;
    this._handshakeWordStreak = 0;
    this._recvSize = 0;
    this._recvPos = 0;
    this._partnerPlayerDone = false;
    this._sentCardRequest = false;
    this._masterReqIndex = 0;
    this._tidLocked = false;
    this._announcedGame = null;
    this._variant = null;
    this._offered = false;
    this._playerPicked = false;
    this._confirmed = false;
    this._selectCmd = 0;
    this._finishSent = false;
    this._finishAt = 0;
    this._tradeComplete = false;
    this._closing = false;
    this._sectionDown = false;
    this._offerAt = 0;
    this._cancelled = false;
    this._needsRestart = false;
    this._awaitTableIdle = false;
    this._leftSeat = false;
    this._closeLinkSent = 0;
    this._exitCancel = false;
    this._statusUntil = 0;
    this._lastBeat = 0;
  }

  setEvent(event) {
    this.event = event;
  }

  reset() {
    this.uiPhase = 'idle';
    this._queue = [];
    this._phase = 'lobby';
    this._blockState = 'needPlayer';
    this._linkType = LINK.TRADE_SETUP;
    this._sentReady = false;
    this._seatIndex = 0;
    this._inRoom = false;
    this._relinkAt = 0;
    this._relinkHandshakeSent = false;
    this._partySliceIndex = 0;
    this._sawVersion = false;
    this._followup = null;
    this._requestQueue = [];
    this._expectRelink = false;
    this._sawHandshakeWord = false;
    this._handshakeWordStreak = 0;
    this._recvSize = 0;
    this._recvPos = 0;
    this._partnerPlayerDone = false;
    this._sentCardRequest = false;
    this._masterReqIndex = 0;
    this._tidLocked = false;
    this._announcedGame = null;
    this._variant = null;
    this.delivered = null;
    this._partyData = null;
    this._sectionDown = false;
    this._offered = false;
    this._offerAt = 0;
    this._playerPicked = false;
    this._cancelled = false;
    this._confirmed = false;
    this._selectCmd = 0;
    this._finishSent = false;
    this._finishAt = 0;
    this._tradeComplete = false;
    this._closing = false;
    this._needsRestart = false;
    this._awaitTableIdle = false;
    this._leftSeat = false;
    this._closeLinkSent = 0;
    this._exitCancel = false;
    this._statusUntil = 0;
    this._lastBeat = 0;
  }

  get tid() {
    return this._tid;
  }

  get partnerGameName() {
    if (!this._sawVersion) return null;
    return ({
      1: 'Sapphire',
      2: 'Ruby',
      3: 'Emerald',
      4: 'FireRed',
      5: 'LeafGreen',
    })[this.partnerGame] ?? null;
  }

  linkIdleOutByte() {
    return 0x00;
  }

  handleByte() {
    return 0x00;
  }

  _phaseChange(phase) {
    this.uiPhase = phase;
    this.opts.onPhaseChange?.(phase);
  }

  _enqueue(words) {
    this._queue.push(words);
  }

  _takePendingBlock() {
    const head = this._queue[0];
    if (!head || head[0] === LINK.SEND_HELD_KEYS) return null;
    return this._drainQueue();
  }

  _drainQueue() {
    if (this._queue.length === 0) return null;
    const responses = [];
    for (let i = 0; i < 4; i++) responses.push(this._queue.shift() ?? commandExchange(0));
    return responses;
  }

  _enqueueBlock(payload, size) {
    for (const words of blockExchanges(payload, size)) this._enqueue(words);
  }

  _enqueueCommand(cmd, arg = 0) {
    this._enqueueBlock(commandBytes(cmd, arg), 20);
  }

  _canEmitNegotiateNonzero(incoming) {
    if (this._phase !== 'negotiate') return true;
    if (this._cancelled || this._playerPicked) return true;
    if (incoming[0] === LINK.READY_CLOSE_LINK) return true;
    if (incoming[0] === LINK.INIT_BLOCK || incoming[0] === LINK.CONT_BLOCK) return true;
    return this._nonzeroThisPacket < 1;
  }

  _emitNegotiate(incoming, outgoing) {
    if (!outgoing[0]) return outgoing;
    if (!this._canEmitNegotiateNonzero(incoming)) return commandExchange(0);
    this._nonzeroThisPacket += 1;
    return outgoing;
  }

  _shiftQueuedReply(incoming) {
    if (this._queue.length === 0) return commandExchange(0);
    const head = this._queue[0];
    if (head[0] === LINK.INIT_BLOCK || head[0] === LINK.CONT_BLOCK) {
      this._nonzeroThisPacket += 1;
      return this._queue.shift();
    }
    if (!this._canEmitNegotiateNonzero(incoming)) return commandExchange(0);
    return this._emitNegotiate(incoming, this._queue.shift());
  }

  _nextResponse(incoming) {
    this._observe(incoming);
    if (this._phase === 'negotiate' && !this._offered && this._queue.length > 0) {
      this._queue = [];
      this._requestQueue = [];
    }
    if (this._followup && this._queue.length === 0) {
      const cmd = this._followup;
      this._followup = null;
      this._enqueueCommand(cmd);
    }
    // A block still in the queue would swallow a one-shot request.
    if (this._queue.length > 0) {
      if (incoming[0] === LINK.SEND_BLOCK_REQ) this._requestQueue.push(incoming.slice());
      if (incoming[0] === LINK.READY_EXIT_STANDBY) {
        return this._emitNegotiate(incoming, commandExchange(LINK.READY_EXIT_STANDBY));
      }
      if (incoming[0] === LINK.READY_CLOSE_LINK) {
        this._queue = [];
        this._requestQueue = [];
        return this._onCloseLink(incoming);
      }
      if (incoming[0] === LINK.SEND_HELD_KEYS && incoming[1] === LINK.KEY_EXIT && this._canLeaveSeat()) {
        this._queue = [];
        this._requestQueue = [];
        this._onLeaveSeat();
        return commandExchange(LINK.SEND_HELD_KEYS, LINK.KEY_EXIT);
      }
      const head = this._queue[0];
      const statusBlock = head && (head[0] === LINK.INIT_BLOCK || head[0] === LINK.CONT_BLOCK);
      if (statusBlock && !this._canDrainStatusBlock()) {
        this._dropStaleStatusBlock();
        return this._emitNegotiate(incoming, this._onCommand(incoming));
      }
      return this._shiftQueuedReply(incoming);
    }
    if (this._requestQueue.length > 0) {
      const req = this._requestQueue.shift();
      return this._emitNegotiate(incoming, this._onBlockRequest(req));
    }
    return this._emitNegotiate(incoming, this._onCommand(incoming));
  }

  _observe(words) {
    const cmd = words[0];
    if (HANDSHAKE_WORD.has(cmd)) {
      this._handshakeWordStreak += 1;
      if (this._handshakeWordStreak >= 4) this._sawHandshakeWord = true;
      return;
    }
    this._handshakeWordStreak = 0;
    if (cmd === LINK.INIT_BLOCK) {
      this._recvSize = words[1];
      this._recvPos = 0;
      if (words[1] === 60) this._playerBuf = [];
      return;
    }
    if (cmd !== LINK.CONT_BLOCK || !this._recvSize) return;
    if (this._recvPos === 0 && this._recvSize === 20) {
      this._selectCmd = words[1];
      this._selectArg = words[2];
      if (this._phase === 'negotiate' && !this._cancelled
          && this._selectCmd === LINK.REQUEST_CANCEL) {
        this._cancelled = true;
        this._offered = true;
        this._awaitTableIdle = true;
        this._playerPicked = false;
        this._confirmed = false;
        this._queue = [];
        this._statusUntil = Date.now() + 1000;
        this._enqueueCommand(LINK.REQUEST_CANCEL);
        this._phaseChange('trade_cancelled');
      }
    }
    this._notePlayerBytes(payloadBytes(words));
    this._recvPos += 14;
    if (this._recvPos < this._recvSize) return;
    const size = this._recvSize;
    this._recvSize = 0;
    this._onPartnerBlock(size);
  }

  _onPartnerBlock(size) {
    if (size === 60) this._partnerPlayerDone = true;
  }

  _onCommand(words) {
    const cmd = words[0];
    if (this._phase === 'negotiate') {
      if (cmd === LINK.READY_CLOSE_LINK) return this._onCloseLink(words);
      if (cmd === LINK.READY_EXIT_STANDBY) return commandExchange(LINK.READY_EXIT_STANDBY);
      return this._negotiate(words, cmd);
    }
    if (cmd === LINK.SEND_LINK_TYPE) return this._onSendLinkType(words);
    if (cmd === LINK.SEND_BLOCK_REQ) return this._onBlockRequest(words);
    if (cmd === LINK.INIT_BLOCK && this._blockState === 'needPlayer' && words[1] === 60) {
      this._beginSession(this._linkType);
      return this._queue.shift() ?? commandExchange(0);
    }
    if (cmd === LINK.READY_CLOSE_LINK) return this._onCloseLink(words);
    if (cmd === LINK.READY_EXIT_STANDBY) return commandExchange(LINK.READY_EXIT_STANDBY);
    if (this._selectCmd === LINK.READY_FINISH_TRADE && !this._finishSent) {
      this._selectCmd = 0;
      this._sendFinishTrade();
      return this._queue.shift() ?? commandExchange(0);
    }
    if (this._selectCmd === LINK.CONFIRM_FINISH_TRADE) {
      this._selectCmd = 0;
      this._tradeComplete = true;
      this._phaseChange('post_trade_party');
    }
    if (cmd === 0 && this._blockState === 'needPlayer') {
      return commandExchange(LINK.SEND_LINK_TYPE, this._linkType);
    }
    if (this._phase === 'lobby') return this._lobby(words, cmd);
    if (this._phase === 'party') return this._party(words, cmd);
    if (this._phase === 'animating') return this._animate();
    if (this._phase === 'negotiate') return this._negotiate(words, cmd);
    return this._queue.shift() ?? commandExchange(0);
  }

  _lockIdentity() {
    if (this._tidLocked) return;
    const variant = chooseVariant(this.event);
    this._variant = variant;
    this._tid = (variant.tid ?? Math.floor(Math.random() * 65536)) & 0xffff;
    this._sid = (variant.sid ?? 0) & 0xffff;
    this._tidLocked = true;
    this.delivered = {
      ...this.event,
      species: variant.species,
      nickname: variant.nickname,
      otName: variant.otName,
      speciesId: variant.speciesId,
    };
  }

  _beginSession(linkType) {
    if (linkType) this._linkType = linkType;
    this._lockIdentity();
    if (this._announcedGame == null) this._announcedGame = this.partnerGame;
    this._enqueueBlock(this._playerBlock(this._linkType), 60);
    if (this._linkType === LINK.TRADE_CONNECTING) {
      this._phase = 'party';
      this._blockState = 'awaitRequest';
      this._partySliceIndex = 0;
      this._partyData = null;
      this._sentCardRequest = false;
      this._phaseChange('data_exchange');
    } else if (this._linkType === LINK.TRADE) {
      this._phase = 'lobby';
      this._blockState = 'done';
      this._sentReady = false;
      this._seatIndex = 0;
      this._inRoom = false;
      this._phaseChange('waiting_cable_club');
    } else if (this._linkType === LINK.TRADE_DISCONNECTED) {
      this._phase = 'animating';
      this._blockState = 'done';
      this._finishSent = false;
      this._finishAt = 0;
      this._tradeComplete = true;
      this._phaseChange('trading');
    } else {
      this._phase = 'lobby';
      this._blockState = 'done';
      this._sentReady = false;
      this._seatIndex = 0;
      this._inRoom = false;
      this._awaitTableIdle = false;
    }
  }

  _onSendLinkType(words) {
    const announced = words[1];
    if (announced && announced !== this._linkType && this._blockState !== 'needPlayer') {
      this._linkType = announced;
      this._queue = [];
      this._requestQueue = [];
      this._partySliceIndex = 0;
      this._partyData = null;
      this._recvSize = 0;
      this._recvPos = 0;
      this._blockState = 'needPlayer';
    } else if (announced) {
      this._linkType = announced;
    }
    if (this._blockState === 'needPlayer' && this._queue.length === 0 && this._partySliceIndex === 0) {
      this._beginSession(this._linkType);
    }
    return this._queue.shift() ?? commandExchange(LINK.SEND_LINK_TYPE, this._linkType);
  }

  _onCloseLink(words = []) {
    const closeType = words[1] ?? 0;
    if (this._phase === 'party' && this._blockState === 'cmd' && closeType !== CLOSE_CANCEL && !this._cancelled) {
      this._queue = [];
      this._requestQueue = [];
      this._phase = 'negotiate';
      this._offerAt = 0;
      this._phaseChange('trade_selection');
      return commandExchange(LINK.READY_CLOSE_LINK, closeType);
    }
    if (this._expectRelink) return commandExchange(LINK.READY_CLOSE_LINK, closeType || CLOSE_CANCEL);
    if (this._leftSeat && !this._tradeComplete && closeType !== CLOSE_START_TRADE) {
      this._linkType = LINK.TRADE_SETUP;
      this._tradeComplete = false;
      this._awaitTableIdle = false;
      this._leftSeat = false;
      this._exitCancel = false;
      this._cancelled = false;
      this._phaseChange('connected');
    } else if (this._cancelled || this._exitCancel || closeType === CLOSE_CANCEL) {
      this._linkType = LINK.TRADE;
      this._tradeComplete = false;
      this._awaitTableIdle = true;
      this._cancelled = false;
      this._exitCancel = false;
      this._closeLinkSent = 0;
      this._phaseChange('trade_cancelled');
    } else if (this._linkType === LINK.TRADE_DISCONNECTED && this._tradeComplete) {
      this._awaitTableIdle = false;
      this._linkType = LINK.TRADE_CONNECTING;
    } else if (closeType === CLOSE_START_TRADE || this._linkType === LINK.TRADE_CONNECTING) {
      this._linkType = LINK.TRADE_DISCONNECTED;
    } else if (this._linkType === LINK.TRADE_SETUP || this._linkType === LINK.TRADE) {
      this._linkType = LINK.TRADE_CONNECTING;
    }
    this._expectRelink = true;
    this._closing = true;
    this._sectionDown = false;
    this._relinkAt = 0;
    this._relinkHandshakeSent = false;
    this._phase = 'lobby';
    this._blockState = 'needPlayer';
    this._queue = [];
    this._requestQueue = [];
    this._sentReady = false;
    this._seatIndex = this._linkType === LINK.TRADE || this._linkType === LINK.TRADE_SETUP
      ? 0
      : SEAT_PATH.length;
    this._inRoom = false;
    this._sentCardRequest = false;
    this._partnerPlayerDone = false;
    this._masterReqIndex = 0;
    this._partySliceIndex = 0;
    this._partyData = null;
    this._recvSize = 0;
    this._recvPos = 0;
    this._offered = false;
    this._offerAt = 0;
    this._playerPicked = false;
    this._confirmed = false;
    this._selectCmd = 0;
    this._finishSent = false;
    this._finishAt = 0;
    this._announcedGame = this._sawVersion ? this.partnerGame : null;
    return commandExchange(LINK.READY_CLOSE_LINK, closeType || CLOSE_CANCEL);
  }

  _onBlockRequest(words) {
    if (this._phase === 'negotiate' || this._phase === 'animating') {
      return commandExchange(0);
    }
    this._enqueuePayload(words[1]);
    return this._queue.shift() ?? commandExchange(0);
  }

  _enqueuePayload(kind) {
    this._lockIdentity();
    if (this._blockState === 'needPlayer') this._blockState = 'awaitRequest';
    if (kind === LINK.BLOCK_REQ_100) {
      if (this._sentCardRequest) return;
      this._sentCardRequest = true;
      this._enqueueBlock(trainerCardBlock({
        tid: this._tid,
        game: this._announcedGame ?? this.partnerGame,
      }), 0x64);
      this._blockState = 'done';
      return;
    }
    if (!this._partyData) this._partyData = this._buildParty();
    let payload;
    let size;
    if (kind === LINK.BLOCK_REQ_220) {
      payload = new Uint8Array(0);
      size = 220;
    } else if (kind === LINK.BLOCK_REQ_40) {
      payload = new Uint8Array(0);
      size = 40;
      this._blockState = 'cmd';
    } else {
      const start = this._partySliceIndex * 200;
      payload = this._partyData.slice(start, start + 200);
      size = 200;
      this._partySliceIndex += 1;
    }
    this._phase = 'party';
    this._enqueueBlock(payload, size);
    this._phaseChange('data_exchange');
  }

  _queueHeldKey(key, count = 20) {
    for (let i = 0; i < count; i++) this._enqueue(commandExchange(LINK.SEND_HELD_KEYS, key));
  }

  _canLeaveSeat() {
    if (this._expectRelink || this._closing) return false;
    if (this._linkType === LINK.TRADE_CONNECTING || this._linkType === LINK.TRADE_DISCONNECTED) return false;
    if (this._phase !== 'lobby') return false;
    return true;
  }

  _onLeaveSeat() {
    this._needsRestart = false;
    this._awaitTableIdle = false;
    this._cancelled = false;
    this._exitCancel = false;
    this._expectRelink = false;
    this._closing = false;
    this._sentReady = false;
    this._seatIndex = 0;
    this._inRoom = false;
    this._linkType = LINK.TRADE_SETUP;
    this._leftSeat = true;
    this._phase = 'lobby';
    this._blockState = 'done';
    this._offered = false;
    this._offerAt = 0;
    this._phaseChange('connected');
  }

  _beginSeatStep() {
    if (this._linkType !== LINK.TRADE_SETUP) return false;
    if (!this._inRoom || this._phase !== 'lobby' || this._blockState !== 'done') return false;
    if (this._seatIndex >= SEAT_PATH.length || this._queue.length > 0) return false;
    const key = SEAT_PATH[this._seatIndex];
    this._seatIndex += 1;
    this._queueHeldKey(key);
    if (key === LINK.KEY_READY) {
      this._sentReady = true;
      this._leftSeat = false;
    }
    if (this._seatIndex === 1) this._phaseChange('waiting_cable_club');
    return true;
  }

  _lobbyReadyKey() {
    if (this._sentReady) return commandExchange(LINK.SEND_HELD_KEYS, LINK.KEY_READY);
    this._sentReady = true;
    this._leftSeat = false;
    this._queueHeldKey(LINK.KEY_READY);
    this._phaseChange('waiting_cable_club');
    return this._queue.shift();
  }

  _lobby(words, cmd) {
    if (cmd === LINK.INIT_BLOCK) return commandExchange(0);
    if (cmd === LINK.SEND_HELD_KEYS) {
      this._inRoom = true;
      if (this._expectRelink) {
        this._expectRelink = false;
        this._sectionDown = false;
        this._relinkAt = 0;
      }
      if (words[1] === LINK.KEY_EXIT) {
        if (this._canLeaveSeat()) this._onLeaveSeat();
        return commandExchange(LINK.SEND_HELD_KEYS, LINK.KEY_EXIT);
      }
      if (this._awaitTableIdle) {
        if (words[1] !== LINK.KEY_READY) this._awaitTableIdle = false;
        else return commandExchange(LINK.SEND_HELD_KEYS, LINK.KEY_EMPTY);
      }
      if (this._linkType === LINK.TRADE && words[1] === LINK.KEY_READY) {
        return this._lobbyReadyKey();
      }
      if (this._beginSeatStep()) return this._queue.shift();
      if (this._sentReady) return commandExchange(LINK.SEND_HELD_KEYS, LINK.KEY_READY);
      return commandExchange(LINK.SEND_HELD_KEYS, LINK.KEY_EMPTY);
    }
    if (cmd === LINK.READY_EXIT_STANDBY) return commandExchange(LINK.READY_EXIT_STANDBY);
    return commandExchange(0);
  }

  _party(words, cmd) {
    if (this._blockState === 'cmd' && this._queue.length === 0) {
      this._queue = [];
      this._requestQueue = [];
      this._phase = 'negotiate';
      this._offerAt = 0;
      this._phaseChange('trade_selection');
      return this._negotiate(words, cmd);
    }
    return commandExchange(0);
  }

  _armOffer() {
    if (this._cancelled || this._awaitTableIdle || this._offered || this._phase !== 'negotiate') return;
    if (this._linkType !== LINK.TRADE_CONNECTING) return;
    if (this._queue.length > 0 || this._recvSize) return;
    if (!this._offerAt) this._offerAt = Date.now() + 200;
    if (Date.now() < this._offerAt) return;
    this._offered = true;
    this._offerAt = 0;
    this._statusUntil = Date.now() + 1000;
    this._enqueueCommand(LINK.READY_TO_TRADE, 0);
    this._phaseChange('trade_selection');
  }

  _canDrainStatusBlock() {
    if (this._phase !== 'negotiate') return true;
    if (this._cancelled || this._playerPicked || this._exitCancel || this._offered) return true;
    return !!this._statusUntil && Date.now() < this._statusUntil;
  }

  _dropStaleStatusBlock() {
    while (this._queue.length > 0) {
      const head = this._queue[0];
      if (head[0] !== LINK.INIT_BLOCK && head[0] !== LINK.CONT_BLOCK) break;
      this._queue.shift();
    }
  }

  _takeSelectCmd() {
    const cmd = this._selectCmd;
    this._selectCmd = 0;
    return cmd;
  }

  _negotiate(words = [], cmd = 0) {
    if (cmd === LINK.READY_EXIT_STANDBY) return commandExchange(LINK.READY_EXIT_STANDBY);
    if (cmd === LINK.READY_CLOSE_LINK) return this._onCloseLink(words);
    const selected = this._takeSelectCmd();
    if (selected === LINK.REQUEST_CANCEL) {
      if (!this._cancelled) {
        this._cancelled = true;
        this._offered = true;
        this._awaitTableIdle = true;
        this._playerPicked = false;
        this._confirmed = false;
        this._queue = [];
        this._statusUntil = Date.now() + 1000;
        this._enqueueCommand(LINK.REQUEST_CANCEL);
        this._phaseChange('trade_cancelled');
      }
    } else if (selected === LINK.BOTH_CANCEL_TRADE) {
      this._cancelled = true;
      this._exitCancel = true;
      this._awaitTableIdle = true;
      this._closeLinkSent = 0;
      this._queue = [];
      this._linkType = LINK.TRADE;
      this._phaseChange('trade_cancelled');
      return this._nextCloseLinkReply();
    } else if (selected === LINK.PLAYER_CANCEL_TRADE) {
      this._cancelled = true;
      this._exitCancel = false;
      this._awaitTableIdle = true;
      this._playerPicked = false;
      this._confirmed = false;
      this._offered = true;
      this._closeLinkSent = 0;
      this._queue = [];
      this._statusUntil = Date.now() + 1000;
      this._enqueueCommand(LINK.REQUEST_CANCEL);
      this._phaseChange('trade_cancelled');
    } else if (selected === LINK.PARTNER_CANCEL_TRADE) {
      this._cancelled = false;
      this._exitCancel = false;
      this._awaitTableIdle = false;
      this._playerPicked = false;
      this._confirmed = false;
      this._offered = false;
      this._closeLinkSent = 0;
      this._queue = [];
      this._phaseChange('trade_selection');
      this._armOffer();
    } else if (selected === LINK.READY_CANCEL_TRADE) {
      this._confirmed = false;
      this._offered = false;
      this._playerPicked = false;
      this._offerAt = 0;
      this._queue = [];
      this._enqueueCommand(LINK.READY_CANCEL_TRADE);
      this._phaseChange('trade_selection');
    } else {
      if (selected === LINK.READY_TO_TRADE && this._offered && !this._playerPicked) {
        this._playerPicked = true;
        this._queue = [];
        this._phaseChange('trade_confirm');
        this._confirmed = true;
        this._statusUntil = Date.now() + 1000;
        this._enqueueCommand(LINK.SET_MONS_TO_TRADE, this._selectArg || 0);
        this._enqueueCommand(LINK.INIT_BLOCK);
      } else if (selected === LINK.SET_MONS_TO_TRADE) {
        this._playerPicked = true;
        this._phaseChange('trade_confirm');
        if (this._queue.length === 0) {
          this._confirmed = true;
          this._statusUntil = Date.now() + 1000;
          this._enqueueCommand(LINK.INIT_BLOCK);
        }
      } else if (selected === LINK.INIT_BLOCK) {
        this._playerPicked = true;
        this._confirmed = true;
        this._phaseChange('trading');
        if (this._queue.length === 0) {
          this._statusUntil = Date.now() + 1000;
          this._enqueueCommand(LINK.INIT_BLOCK);
        }
      }
      if (selected === LINK.START_TRADE) this._phaseChange('trading');
      this._armOffer();
    }
    if (this._exitCancel) return this._nextCloseLinkReply();
    return this._linkBeat();
  }

  _linkBeat() {
    const frlg = this.partnerGame === 4 || this.partnerGame === 5;
    if (frlg && this._phase === 'negotiate' && !this._playerPicked && !this._exitCancel && !this._cancelled) {
      if (this._lastBeat && Date.now() - this._lastBeat < 32) return commandExchange(0);
    }
    this._lastBeat = Date.now();
    return commandExchange(LINK.SEND_HELD_KEYS, LINK.KEY_EMPTY);
  }

  _wantsCloseEcho() {
    if (this._sectionDown) return false;
    return this._exitCancel;
  }

  _nextCloseLinkReply() {
    if (!this._wantsCloseEcho()) return commandExchange(0);
    this._closeLinkSent += 1;
    return commandExchange(LINK.READY_CLOSE_LINK, CLOSE_CANCEL);
  }

  _sendFinishTrade() {
    if (this._finishSent) return;
    this._finishSent = true;
    this._enqueueCommand(LINK.READY_FINISH_TRADE, 0);
  }

  _armFinishTrade() {
    if (this._phase !== 'animating' || this._finishSent || !this._partnerPlayerDone || this._queue.length > 0) return;
    if (!this._finishAt) this._finishAt = Date.now() + 800;
    if (Date.now() < this._finishAt) return;
    this._sendFinishTrade();
  }

  _animate() {
    return this._queue.shift() ?? commandExchange(0);
  }

  _playerBlock(linkType) {
    this._lockIdentity();
    if (this._announcedGame == null) this._announcedGame = this.partnerGame;
    return linkPlayerBlock({
      game: this._announcedGame,
      tid: this._tid,
      sid: this._sid,
      name: 'GBLink',
      linkType,
    });
  }

  _notePlayerBytes(bytes) {
    if (!this._playerBuf) this._playerBuf = [];
    for (const b of bytes) this._playerBuf.push(b);
    if (this._sawVersion || this._playerBuf.length < 20) return;
    const text = this._playerBuf;
    for (let i = 0; i + 18 < text.length; i++) {
      if (text[i] !== 0x47 || text[i + 1] !== 0x61) continue;
      const version = text[i + 16] | (text[i + 17] << 8);
      const game = version - 0x4000;
      if (game >= 1 && game <= 5) {
        this.partnerGame = game;
        this._sawVersion = true;
        this.opts.onPartnerGame?.(game);
      }
    }
  }

  _buildParty() {
    this._lockIdentity();
    const variant = this._variant;
    const party = new Uint8Array(600);
    for (let slot = 0; slot < 6; slot++) {
      const built = buildPartyPokemon(variant, {
        tid: this._tid,
        sid: this._sid,
        originGame: this.partnerGame,
      });
      party.set(built.bytes, slot * 100);
    }
    return party;
  }

  async run() {
    this.reset();
    this._phaseChange('handshaking');
    await gblink.prepareGen3Trade();
    await this._waitForLink();
    this._lockIdentity();
    this._phaseChange('connected');
    await this._announceLink();
    while (gblink.isConnected() && this._phase !== 'done') {
      if (await this._recoverHandshake()) continue;
      const packet = await gblink.readData(64, 50);
      if (!packet || packet.length < 64) {
        if (!gblink.isConnected()) break;
        if (this._queue.length === 0) {
          this._beginSeatStep();
          this._armFinishTrade();
          this._armOffer();
        }
        if (this._wantsCloseEcho()) {
          const closing = [
            this._nextCloseLinkReply(),
            commandExchange(0),
            commandExchange(0),
            commandExchange(0),
          ];
          await gblink.writeData(packResponses(closing));
          continue;
        }
        if (this._phase === 'negotiate') {
          const head = this._queue[0];
          const statusBlock = head && (head[0] === LINK.INIT_BLOCK || head[0] === LINK.CONT_BLOCK);
          if (statusBlock && !this._canDrainStatusBlock()) {
            this._dropStaleStatusBlock();
          }
          if (this._queue.length > 0 && (!statusBlock || this._canDrainStatusBlock())) {
            const pending = this._drainQueue();
            if (pending) {
              await gblink.writeData(packResponses(pending));
            }
          } else {
            const beat = this._linkBeat();
            const idle = [
              beat,
              commandExchange(0),
              commandExchange(0),
              commandExchange(0),
            ];
            await gblink.writeData(packResponses(idle));
          }
          continue;
        }
        const pending = this._drainQueue();
        if (pending) await gblink.writeData(packResponses(pending));
        continue;
      }
      const responses = [];
      this._nonzeroThisPacket = 0;
      for (let i = 0; i < 4; i++) {
        const incoming = bytesToWords(packet, i * 16);
        responses.push(this._nextResponse(incoming));
      }
      if (this._wantsCloseEcho()) {
        if (!responses[0][0]) responses[0] = this._nextCloseLinkReply();
      } else if (this._phase === 'negotiate' && !this._exitCancel) {
        const sendingBlock = responses.some((words) =>
          words[0] === LINK.INIT_BLOCK || words[0] === LINK.CONT_BLOCK);
        if (!sendingBlock && responses.every((words) => !words[0])) {
          responses[0] = this._linkBeat();
        }
      }
      await gblink.writeData(packResponses(responses));
      this._armOffer();
      if (this._phase === 'negotiate' && this._queue.length > 0 && !this._closing && !this._exitCancel) {
        const head = this._queue[0];
        const statusBlock = head && (head[0] === LINK.INIT_BLOCK || head[0] === LINK.CONT_BLOCK);
        if (statusBlock && !this._canDrainStatusBlock()) {
          this._dropStaleStatusBlock();
        } else if (!statusBlock || this._canDrainStatusBlock()) {
          const pending = this._drainQueue();
          if (pending) {
            await gblink.writeData(packResponses(pending));
          }
        }
      }
      if (this._phase !== 'negotiate') {
        const pending = this._takePendingBlock()
          ?? (this._queue[0]?.[0] === LINK.SEND_HELD_KEYS ? this._drainQueue() : null);
        if (pending) await gblink.writeData(packResponses(pending));
      }
      this._armFinishTrade();
      if (this._phase === 'done') break;
    }
    if (this._phase === 'done') this._phaseChange('post_trade_party');
  }

  async _armRelinkHandshake() {
    if (this._relinkHandshakeSent) return;
    this._relinkHandshakeSent = true;
    await gblink.sendCommandBytes([0x12]);
  }

  async _restartSession() {
    this._needsRestart = false;
    this._expectRelink = false;
    this._sectionDown = false;
    this._relinkAt = 0;
    this._relinkHandshakeSent = false;
    this._closing = false;
    this._linkType = LINK.TRADE_SETUP;
    this._tradeComplete = false;
    this._awaitTableIdle = false;
    this._leftSeat = false;
    this._resetExchange();
    this._phaseChange('connected');
    await gblink.prepareGen3Trade();
    await this._waitForLink();
    await this._announceLink();
  }

  async _recoverHandshake() {
    const status = gblink.takeReadyStatus();
    if (status === 0xff07) {
      await this._restartSession();
      return true;
    }
    if (status === 0xff06) {
      this._closing = false;
      this._expectRelink = true;
      this._sectionDown = true;
      this._relinkHandshakeSent = false;
      this._relinkAt = Date.now() + 450;
    }
    const ready = this._sectionDown && this._expectRelink;
    const due = ready && this._relinkAt && Date.now() >= this._relinkAt;
    if (ready && (status === 0xff03 || due)) await this._armRelinkHandshake();
    this._sawHandshakeWord = false;
    if (status !== 0xff05 || !this._expectRelink) return false;
    this._expectRelink = false;
    this._sectionDown = false;
    this._relinkAt = 0;
    this._relinkHandshakeSent = false;
    this._resetExchange();
    const nextPhase = this._linkType === LINK.TRADE ? 'trade_cancelled' : 'connected';
    this._phaseChange(nextPhase);
    await this._announceLink();
    return true;
  }

  _resetExchange() {
    this._queue = [];
    this._phase = 'lobby';
    this._blockState = 'needPlayer';
    this._requestQueue = [];
    this._sentReady = false;
    this._inRoom = false;
    this._seatIndex = this._linkType === LINK.TRADE || this._linkType === LINK.TRADE_SETUP
      ? 0
      : SEAT_PATH.length;
    this._relinkAt = 0;
    this._relinkHandshakeSent = false;
    this._sectionDown = false;
    this._sentCardRequest = false;
    this._partnerPlayerDone = false;
    this._masterReqIndex = 0;
    this._partySliceIndex = 0;
    this._partyData = null;
    this._recvSize = 0;
    this._recvPos = 0;
    this._handshakeWordStreak = 0;
    this._offered = false;
    this._offerAt = 0;
    this._playerPicked = false;
    this._cancelled = false;
    this._confirmed = false;
    this._selectCmd = 0;
    this._finishSent = false;
    this._finishAt = 0;
    this._closing = false;
    this._closeLinkSent = 0;
    this._exitCancel = false;
    this._statusUntil = 0;
    this._lastBeat = 0;
    this._announcedGame = this._sawVersion ? this.partnerGame : null;
  }

  async _announceLink() {
    const linkType = commandExchange(LINK.SEND_LINK_TYPE, this._linkType);
    await gblink.writeData(packResponses([linkType, linkType, linkType, linkType]));
  }

  async _waitForLink() {
    const deadline = Date.now() + 120000;
    while (gblink.isConnected() && Date.now() < deadline) {
      const status = await gblink.readStatus(300);
      if (status === 0xff03) await gblink.sendCommandBytes([0x12]);
      if (status === 0xff05) return;
    }
    throw new Error('The Game Boy Advance did not finish the link handshake.');
  }
}

function commandBytes(cmd, arg) {
  const out = new Uint8Array(4);
  out[0] = cmd & 0xff;
  out[1] = (cmd >> 8) & 0xff;
  out[2] = arg & 0xff;
  out[3] = (arg >> 8) & 0xff;
  return out;
}

function packResponses(list) {
  const out = new Uint8Array(64);
  for (let i = 0; i < 4; i++) {
    const words = list[i] ?? commandExchange(0);
    for (let w = 0; w < 8; w++) {
      out[i * 16 + w * 2] = words[w] & 0xff;
      out[i * 16 + w * 2 + 1] = (words[w] >> 8) & 0xff;
    }
  }
  return out;
}
