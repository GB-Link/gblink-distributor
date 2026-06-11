export const PKMN_BLANK = 0x00;
export const PKMN_MASTER = 0x01;
export const PKMN_SLAVE = 0x02;
export const PKMN_CONNECTED = 0x60;
export const ITEM_1_HIGHLIGHTED = 0xd0;
export const ITEM_2_HIGHLIGHTED = 0xd1;
export const ITEM_3_HIGHLIGHTED = 0xd2;
export const PKMN_TRADE_CENTRE = 0xd4;
export const PKMN_BREAK_LINK = 0xd6;
export const TRADE_CENTRE_WAIT = 0xfd;
export const TRADE_SLOT_1 = 0x60;
export const TRADE_SLOT_LAST = 0x65;
export const TRADE_DECLINE = 0x61;
export const TRADE_ACCEPT = 0x62;
export const TRADE_CANCEL_SELECT = 0x6f;
export const STOP_BYTE = 0x50;
export const NULL_POKEMON = 0xff;

export const SPECIES = {
  MEW: 0x15,
  PIKACHU: 0x54,
  NULL_POKEMON: 0xff,
};

export const MOVES = {
  POUND: 0x01,
  SURF: 0x39,
  FLY: 0x13,
  TELEPORT: 0x64,
  PSYWAVE: 0x95,
  PSYCHIC: 0x5e,
};

export const TYPES = {
  NORMAL: 0x00,
  PSYCHIC_TYPE: 0x18,
  ELECTRIC: 0x17,
  WATER: 0x15,
};

export const MOVE_PP = {
  POUND: 35,
  SURF: 15,
  FLY: 15,
  TELEPORT: 20,
  PSYWAVE: 15,
  PSYCHIC: 10,
};

export const BASE_STATS = {
  MEW: [100, 100, 100, 100, 100],
  PIKACHU: [35, 55, 30, 90, 50],
};

const EXP_MEDIUM_SLOW_BY_LEVEL = {
  1: 0, 2: 27, 3: 48, 4: 77, 5: 135, 6: 216, 7: 316, 8: 446, 9: 606, 10: 796,
  11: 1016, 12: 1256, 13: 1516, 14: 1796, 15: 2096, 16: 2416, 17: 2756, 18: 3116, 19: 3496, 20: 3896,
  21: 4316, 22: 4756, 23: 5216, 24: 5696, 25: 6196, 26: 6716, 27: 7256, 28: 7816, 29: 8396, 30: 8996,
  31: 9616, 32: 10256, 33: 10916, 34: 11596, 35: 12296, 36: 13016, 37: 13756, 38: 14516, 39: 15296, 40: 16096,
  41: 16916, 42: 17756, 43: 18616, 44: 19496, 45: 20396, 46: 21316, 47: 22256, 48: 23216, 49: 24196, 50: 25196,
  51: 26216, 52: 27256, 53: 28316, 54: 29396, 55: 30496, 56: 31616, 57: 32756, 58: 33916, 59: 35096, 60: 36296,
  61: 37516, 62: 38756, 63: 40016, 64: 41296, 65: 42596, 66: 43916, 67: 45256, 68: 46616, 69: 47996, 70: 49396,
  71: 50816, 72: 52256, 73: 53716, 74: 55196, 75: 56696, 76: 58216, 77: 59756, 78: 61316, 79: 62896, 80: 64496,
  81: 66116, 82: 67756, 83: 69416, 84: 71096, 85: 72796, 86: 74516, 87: 76256, 88: 78016, 89: 79796, 90: 81596,
  91: 83416, 92: 85256, 93: 87116, 94: 88996, 95: 90896, 96: 92816, 97: 94756, 98: 96716, 99: 98696, 100: 1059860,
};

function experienceForLevel(level) {
  if (level in EXP_MEDIUM_SLOW_BY_LEVEL) {
    return EXP_MEDIUM_SLOW_BY_LEVEL[level];
  }
  return EXP_MEDIUM_SLOW_BY_LEVEL[100];
}

const CHARSET = {
  ' ': 0x7f,
  A: 0x80, B: 0x81, C: 0x82, D: 0x83, E: 0x84, F: 0x85, G: 0x86,
  H: 0x87, I: 0x88, J: 0x89, K: 0x8a, L: 0x8b, M: 0x8c, N: 0x8d,
  O: 0x8e, P: 0x8f, Q: 0x90, R: 0x91, S: 0x92, T: 0x93, U: 0x94,
  V: 0x95, W: 0x96, X: 0x97, Y: 0x98, Z: 0x99,
  '(': 0x9a, ')': 0x9b, ':': 0x9c, ';': 0x9d, '[': 0x9e, ']': 0x9f,
  a: 0xa0, b: 0xa1, c: 0xa2, d: 0xa3, e: 0xa4, f: 0xa5, g: 0xa6,
  h: 0xa7, i: 0xa8, j: 0xa9, k: 0xaa, l: 0xab, m: 0xac, n: 0xad,
  o: 0xae, p: 0xaf, q: 0xb0, r: 0xb1, s: 0xb2, t: 0xb3, u: 0xb4,
  v: 0xb5, w: 0xb6, x: 0xb7, y: 0xb8, z: 0xb9,
};

export function encodeName(text) {
  const out = new Uint8Array(11);
  const chars = text.slice(0, 10).split('');
  let i = 0;
  for (const ch of chars) {
    const code = CHARSET[ch] ?? CHARSET[ch.toUpperCase?.()] ?? CHARSET[' '];
    out[i++] = code;
  }
  out[i] = STOP_BYTE;
  for (let j = i + 1; j < 11; j++) out[j] = STOP_BYTE;
  return out;
}

function deriveHpIv(ivs) {
  const a = ivs.atk & 1;
  const d = ivs.def & 1;
  const s = ivs.spd & 1;
  const c = ivs.spc & 1;
  return a * 8 + d * 4 + s * 2 + c;
}

function evTerm(ev) {
  return Math.floor(Math.sqrt(ev) / 4);
}

export function calcStats(event) {
  const species = SPECIES[event.species] ?? 0x15;
  const bases = BASE_STATS[event.species] ?? [40, 40, 40, 40, 40];
  const ivs = { ...event.ivs };
  const hpIv = deriveHpIv(ivs);
  const evs = event.evs ?? { hp: 0, atk: 0, def: 0, spd: 0, spc: 0 };
  const level = event.level;

  const hp = Math.floor(
    ((bases[0] + hpIv) * 2 + evTerm(evs.hp)) * level / 100,
  ) + level + 10;

  const stat = (base, iv, ev) =>
    Math.floor(((base + iv) * 2 + evTerm(ev)) * level / 100) + 5;

  return {
    species,
    level,
    hp,
    maxHp: hp,
    attack: stat(bases[1], ivs.atk, evs.atk),
    defense: stat(bases[2], ivs.def, evs.def),
    speed: stat(bases[3], ivs.spd, evs.spd),
    special: stat(bases[4], ivs.spc, evs.spc),
    hpIv,
    ivs,
    experience: event.experience ?? experienceForLevel(level),
    type1: event.type1 ?? TYPES.PSYCHIC_TYPE,
    type2: event.type2 ?? event.type1 ?? TYPES.PSYCHIC_TYPE,
  };
}

export function resolveTid(event) {
  if (event.tidMode === 'fixed' && event.tid != null) {
    return event.tid & 0xffff;
  }
  return Math.floor(Math.random() * 65535) + 1;
}

export function resolveMove(moveKey) {
  const move = MOVES[moveKey] ?? MOVES.POUND;
  const pp = MOVE_PP[moveKey] ?? 20;
  return { move, pp };
}
