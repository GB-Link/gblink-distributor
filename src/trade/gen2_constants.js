export const PKMN_BLANK = 0x00;
export const PKMN_MASTER = 0x01;
export const PKMN_SLAVE = 0x02;
export const PKMN_CONNECTED = 0x60;
export const PKMN_TRADE_CENTRE = 0xd4;
export const PKMN_BREAK_LINK = 0xd6;
export const TRADE_CENTRE_WAIT = 0xfd;
export const STOP_BYTE = 0x50;

export const TRADE_SLOT_1 = 0x70;
export const TRADE_SLOT_LAST = 0x75;
export const TRADE_DECLINE = 0x71;
export const TRADE_ACCEPT = 0x72;
export const TRADE_CANCEL_SELECT = 0x7f;

export const SPECIES = {
  CELEBI: 0xfb,
};

export const MOVES = {
  LEECH_SEED: 0x49,
  CONFUSION: 0x5d,
  HEAL_BELL: 0xd7,
  RECOVER: 0x69,
};

export const MOVE_PP = {
  LEECH_SEED: 10,
  CONFUSION: 25,
  HEAL_BELL: 5,
  RECOVER: 20,
};

export const BASE_STATS = {
  CELEBI: [100, 100, 100, 100, 100, 100],
};

const EXP_MEDIUM_SLOW_BY_LEVEL = {
  1: 0, 2: 27, 3: 48, 4: 77, 5: 135, 6: 216, 7: 316, 8: 446, 9: 606, 10: 796,
  11: 1016, 12: 1256, 13: 1516, 14: 1796, 15: 2096, 16: 2416, 17: 2756, 18: 3116, 19: 3496, 20: 3896,
};

function experienceForLevel(level) {
  return EXP_MEDIUM_SLOW_BY_LEVEL[level] ?? EXP_MEDIUM_SLOW_BY_LEVEL[20];
}

const CHARSET = {
  ' ': 0x7f,
  A: 0x80, B: 0x81, C: 0x82, D: 0x83, E: 0x84, F: 0x85, G: 0x86,
  H: 0x87, I: 0x88, J: 0x89, K: 0x8a, L: 0x8b, M: 0x8c, N: 0x8d,
  O: 0x8e, P: 0x8f, Q: 0x90, R: 0x91, S: 0x92, T: 0x93, U: 0x94,
  V: 0x95, W: 0x96, X: 0x97, Y: 0x98, Z: 0x99,
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

function evTerm(ev) {
  return Math.ceil(Math.sqrt(ev)) / 4 | 0;
}

function deriveHpIv(ivs) {
  const a = ivs.atk & 1;
  const d = ivs.def & 1;
  const s = ivs.spd & 1;
  const c = ivs.spc & 1;
  return a * 8 + d * 4 + s * 2 + c;
}

function randomIv15() {
  return Math.floor(Math.random() * 16);
}

function rollIvs(event) {
  if (event.ivMode === 'fixed' && event.ivs) {
    return { ...event.ivs };
  }
  return {
    atk: randomIv15(),
    def: randomIv15(),
    spd: randomIv15(),
    spc: randomIv15(),
  };
}

export function calcStats(event) {
  const species = SPECIES[event.species] ?? 0xfb;
  const bases = BASE_STATS[event.species] ?? [40, 40, 40, 40, 40, 40];
  const ivs = rollIvs(event);
  const hpIv = deriveHpIv(ivs);
  const evs = event.evs ?? { hp: 0, atk: 0, def: 0, spd: 0, spc: 0 };
  const level = event.level ?? 5;

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
    specialAtk: stat(bases[4], ivs.spc, evs.spc),
    specialDef: stat(bases[5], ivs.spc, evs.spc),
    ivs,
    experience: event.experience ?? experienceForLevel(level),
  };
}

export function resolveTid(event) {
  if (event.tidMode === 'fixed' && event.tid != null) {
    return event.tid & 0xffff;
  }
  const cap = event.tidMax ?? 0;
  if (cap > 0) {
    return Math.floor(Math.random() * cap) & 0xffff;
  }
  return Math.floor(Math.random() * 65536) & 0xffff;
}

export function resolveMove(moveKey) {
  const move = MOVES[moveKey] ?? MOVES.LEECH_SEED;
  const pp = MOVE_PP[moveKey] ?? 20;
  return { move, pp };
}
