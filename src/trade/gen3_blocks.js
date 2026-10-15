export const LINK = {
  SEND_LINK_TYPE: 0x2222,
  READY_EXIT_STANDBY: 0x2ffe,
  SEND_HELD_KEYS: 0xcafe,
  READY_CLOSE_LINK: 0x5fff,
  INIT_BLOCK: 0xbbbb,
  CONT_BLOCK: 0x8888,
  SEND_BLOCK_REQ: 0xcccc,
  START_TRADE: 0xccdd,
  SET_MONS_TO_TRADE: 0xdddd,
  READY_TO_TRADE: 0xaabb,
  READY_FINISH_TRADE: 0xabcd,
  CONFIRM_FINISH_TRADE: 0xdcba,
  REQUEST_CANCEL: 0xeeaa,
  BOTH_CANCEL_TRADE: 0xeebb,
  PARTNER_CANCEL_TRADE: 0xeecc,
  READY_CANCEL_TRADE: 0xbbcc,
  PLAYER_CANCEL_TRADE: 0xddee,
  TRADE: 0x1111,
  TRADE_CONNECTING: 0x1122,
  TRADE_SETUP: 0x1133,
  TRADE_DISCONNECTED: 0x1144,
  BLOCK_REQ_200: 1,
  BLOCK_REQ_100: 2,
  BLOCK_REQ_220: 3,
  BLOCK_REQ_40: 4,
  KEY_EMPTY: 0x11,
  KEY_UP: 0x13,
  KEY_LEFT: 0x14,
  KEY_RIGHT: 0x15,
  KEY_READY: 0x16,
  KEY_EXIT: 0x17,
};

const MAGIC = [0x47, 0x61, 0x6d, 0x65, 0x46, 0x72, 0x65, 0x61, 0x6b, 0x20, 0x69, 0x6e, 0x63, 0x2e, 0x00, 0x00];

export function wordsToBytes(words) {
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    out[i * 2] = words[i] & 0xff;
    out[i * 2 + 1] = (words[i] >> 8) & 0xff;
  }
  return out;
}

export function bytesToWords(bytes, offset = 0) {
  const words = new Array(8);
  for (let i = 0; i < 8; i++) {
    words[i] = bytes[offset + i * 2] | (bytes[offset + i * 2 + 1] << 8);
  }
  return words;
}

export function blockExchanges(payload, maxSize) {
  const src = payload ?? new Uint8Array(0);
  const exchanges = [[LINK.INIT_BLOCK, maxSize, 0x0080, 0, 0, 0, 0, 0]];
  let pos = 0;
  let srcLeft = src.length;
  let left = maxSize;
  while (left > 0) {
    const chunk = new Uint8Array(14);
    const take = Math.min(14, srcLeft);
    if (take > 0) chunk.set(src.subarray(pos, pos + take));
    const words = [LINK.CONT_BLOCK, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 14; i++) {
      const at = 2 + i;
      const wi = at >> 1;
      if (at & 1) words[wi] |= chunk[i] << 8;
      else words[wi] = chunk[i];
    }
    words[0] = LINK.CONT_BLOCK;
    exchanges.push(words);
    pos += take;
    srcLeft -= take;
    left -= Math.min(14, left);
  }
  return exchanges;
}

export function commandExchange(cmd, arg = 0) {
  const words = new Array(8).fill(0);
  words[0] = cmd;
  words[1] = arg;
  return words;
}

export function linkPlayerBlock(options) {
  const player = new Uint8Array(28);
  const version = 0x4000 | (options.game & 0xff);
  player[0] = version & 0xff;
  player[1] = (version >> 8) & 0xff;
  player[2] = 0x00;
  player[3] = 0x80;
  player[4] = options.tid & 0xff;
  player[5] = (options.tid >> 8) & 0xff;
  player[6] = options.sid & 0xff;
  player[7] = (options.sid >> 8) & 0xff;
  const rubySapphire = options.game === 1 || options.game === 2;
  const name = options.name ?? 'GBLink';
  if (rubySapphire) {
    player[2] = 0;
    player[3] = 0;
    const encoded = encodeName(name, 11);
    player.set(encoded, 8);
    player[0x13] = 0;
  } else {
    const encoded = encodeName(name, 8);
    player.set(encoded, 8);
    player[0x10] = 0x1f;
    player[0x11] = 0;
    player[0x12] = 0x1f;
    player[0x13] = 0;
  }
  const linkType = options.linkType ?? LINK.TRADE_SETUP;
  player[0x14] = linkType & 0xff;
  player[0x15] = (linkType >> 8) & 0xff;
  player[0x18] = 0;
  player[0x1a] = 2;
  const block = new Uint8Array(60);
  block.set(MAGIC, 0);
  block.set(player, 16);
  block.set(MAGIC, 44);
  return block;
}

function encodeName(name, length) {
  const out = new Uint8Array(length).fill(0xff);
  const raw = String(name);
  for (let i = 0; i < raw.length && i < length; i++) {
    const code = raw.charCodeAt(i);
    if (code >= 65 && code <= 90) out[i] = 0xbb + (code - 65);
    else if (code >= 97 && code <= 122) out[i] = 0xd5 + (code - 97);
  }
  return out;
}

export function trainerCardBlock(options) {
  const card = new Uint8Array(0x64);
  card[0] = 0;
  card[1] = 4;
  card[2] = 1;
  card[0x0e] = options.tid & 0xff;
  card[0x0f] = (options.tid >> 8) & 0xff;
  const name = encodeName('GBLink', 8);
  card.set(name, 0x30);
  card[0x38] = options.game & 0xff;
  return card;
}

export function payloadBytes(words) {
  const bytes = wordsToBytes(words);
  return bytes.subarray(2, 16);
}
