// Physical slot of each substruct type, matching pokefirered GetSubstruct
// (SUBSTRUCT_CASE arguments: growth, attacks, EVs, miscellaneous).
const SUBSTRUCT_LOCATION = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 3, 1, 2], [0, 2, 3, 1], [0, 3, 2, 1],
  [1, 0, 2, 3], [1, 0, 3, 2], [2, 0, 1, 3], [3, 0, 1, 2], [2, 0, 3, 1], [3, 0, 2, 1],
  [1, 2, 0, 3], [1, 3, 0, 2], [2, 1, 0, 3], [3, 1, 0, 2], [2, 3, 0, 1], [3, 2, 0, 1],
  [1, 2, 3, 0], [1, 3, 2, 0], [2, 1, 3, 0], [3, 1, 2, 0], [2, 3, 1, 0], [3, 2, 1, 0],
];

function u32(bytes, offset) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function writeU16(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function writeU32(bytes, offset, value) {
  const v = value >>> 0;
  bytes[offset] = v & 0xff;
  bytes[offset + 1] = (v >> 8) & 0xff;
  bytes[offset + 2] = (v >> 16) & 0xff;
  bytes[offset + 3] = (v >> 24) & 0xff;
}

export function encodeGen3Text(text, length) {
  const out = new Uint8Array(length).fill(0xff);
  const raw = String(text ?? '').toUpperCase();
  for (let i = 0; i < raw.length && i < length; i++) {
    const code = raw.charCodeAt(i);
    if (code >= 65 && code <= 90) out[i] = 0xbb + (code - 65);
    else if (code >= 48 && code <= 57) out[i] = 0xa1 + (code - 48);
    else out[i] = 0x00;
  }
  return out;
}

export function experienceForLevel(growth, level) {
  const n = level | 0;
  if (n <= 1) return 0;
  const n3 = n * n * n;
  switch (growth) {
    case 0: return n3;
    case 4: return Math.floor((n3 * 4) / 5);
    case 5: return Math.floor((n3 * 5) / 4);
    case 3: return Math.floor((6 * n3) / 5) - 15 * n * n + 100 * n - 140;
    case 1: return erraticExp(n, n3);
    case 2: return fluctuatingExp(n, n3);
    default: return n3;
  }
}

function erraticExp(n, n3) {
  if (n < 50) return Math.floor((n3 * (100 - n)) / 50);
  if (n < 68) return Math.floor((n3 * (150 - n)) / 100);
  if (n < 98) return Math.floor((n3 * Math.floor((1911 - 10 * n) / 3)) / 500);
  return Math.floor((n3 * (160 - n)) / 100);
}

function fluctuatingExp(n, n3) {
  if (n < 15) return Math.floor((n3 * (Math.floor((n + 1) / 3) + 24)) / 50);
  if (n < 36) return Math.floor((n3 * (n + 14)) / 50);
  return Math.floor((n3 * (Math.floor(n / 2) + 32)) / 50);
}

export function isShiny(personality, tid, sid) {
  const ot = (tid ^ sid) & 0xffff;
  const pid = personality >>> 0;
  return ((ot ^ (pid >>> 16) ^ (pid & 0xffff)) & 0xffff) < 8;
}

function natureMultiplier(nature, statIndex) {
  const plus = Math.floor(nature / 5);
  const minus = nature % 5;
  if (plus === minus) return 10;
  if (statIndex === plus) return 11;
  if (statIndex === minus) return 9;
  return 10;
}

function statValue(base, iv, level, nature, statIndex, hp) {
  const core = Math.floor(((2 * base + iv) * level) / 100);
  if (hp) return core + level + 10;
  return Math.floor(((core + 5) * natureMultiplier(nature, statIndex)) / 10);
}

function checksumOf(secure) {
  let sum = 0;
  for (let i = 0; i < 48; i += 2) sum = (sum + (secure[i] | (secure[i + 1] << 8))) & 0xffff;
  return sum;
}

export function substructOrder(personality) {
  return SUBSTRUCT_LOCATION[(personality >>> 0) % 24];
}

function rollPersonality(rng, tid, sid, shinyLocked) {
  for (let i = 0; i < 64; i++) {
    const personality = rng.u32();
    if (!shinyLocked || !isShiny(personality, tid, sid)) return personality >>> 0;
  }
  return rng.u32() >>> 0;
}

function buildSecure(variant, personality, originGame) {
  if (!variant.base) throw new Error('This distribution is missing base stats.');
  const order = substructOrder(personality);
  const slots = [new Uint8Array(12), new Uint8Array(12), new Uint8Array(12), new Uint8Array(12)];
  const level = variant.level;
  const base = variant.base;
  const growth = slots[0];
  writeU16(growth, 0, variant.speciesId);
  writeU16(growth, 2, variant.heldItem ?? 0);
  writeU32(growth, 4, experienceForLevel(base.growth, level));
  growth[8] = 0;
  growth[9] = variant.isEgg ? 0 : (base.friendship ?? 70);
  writeU16(growth, 10, 0);

  const attacks = slots[1];
  const moves = variant.moves ?? [0, 0, 0, 0];
  const pp = variant.movePp ?? [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) writeU16(attacks, i * 2, moves[i] ?? 0);
  for (let i = 0; i < 4; i++) attacks[8 + i] = moves[i] ? (pp[i] ?? 0) : 0;

  const iv = () => Math.floor(Math.random() * 32);
  const ivs = [iv(), iv(), iv(), iv(), iv(), iv()];
  const misc0 = (variant.metLocation & 0xff) << 8
    | ((level & 0x7f) << 16)
    | ((originGame & 0xf) << 23)
    | ((variant.ball & 0xf) << 27);
  const misc1 = (ivs[0] & 31)
    | ((ivs[1] & 31) << 5)
    | ((ivs[2] & 31) << 10)
    | ((ivs[3] & 31) << 15)
    | ((ivs[4] & 31) << 20)
    | ((ivs[5] & 31) << 25)
    | ((variant.isEgg ? 1 : 0) << 30)
    | ((personality & 1) << 31);
  const misc2 = variant.fateful ? 0x80000000 : 0;
  const misc = slots[3];
  writeU32(misc, 0, misc0 >>> 0);
  writeU32(misc, 4, misc1 >>> 0);
  writeU32(misc, 8, misc2 >>> 0);

  const secure = new Uint8Array(48);
  for (let type = 0; type < 4; type++) {
    secure.set(slots[type], order[type] * 12);
  }
  return { secure, ivs, order };
}

export function buildPartyPokemon(variant, options = {}) {
  const rng = options.rng ?? Math;
  const tid = (options.tid ?? variant.tid ?? Math.floor(rng.random() * 65536)) & 0xffff;
  const sid = (options.sid ?? variant.sid ?? 0) & 0xffff;
  const personality = options.personality != null
    ? (options.personality >>> 0)
    : rollPersonality(
      { u32: () => (Math.floor(rng.random() * 0x100000000) >>> 0) },
      tid,
      sid,
      variant.shinyLocked !== false && options.personality == null,
    );
  const originGame = options.originGame ?? 3;
  const { secure, ivs } = buildSecure(variant, personality, originGame);
  const otId = ((sid << 16) | tid) >>> 0;
  const key = (personality ^ otId) >>> 0;
  const sum = checksumOf(secure);
  const encrypted = new Uint8Array(secure);
  for (let i = 0; i < 12; i++) {
    const word = (u32(encrypted, i * 4) ^ key) >>> 0;
    writeU32(encrypted, i * 4, word);
  }

  const mon = new Uint8Array(100);
  writeU32(mon, 0, personality);
  writeU32(mon, 4, otId);
  mon.set(encodeGen3Text(variant.nickname || variant.species, 10), 8);
  mon[18] = variant.language ?? 2;
  mon[19] = 0x02 | (variant.isEgg ? 0x04 : 0);
  mon.set(encodeGen3Text(variant.otName || 'GBLINK', 7), 20);
  mon[27] = 0;
  writeU16(mon, 28, sum);
  writeU16(mon, 30, 0);
  mon.set(encrypted, 32);

  const nature = personality % 25;
  const level = variant.level;
  const base = variant.base;
  const hp = statValue(base.hp, ivs[0], level, nature, 0, true);
  const atk = statValue(base.atk, ivs[1], level, nature, 0, false);
  const def = statValue(base.def, ivs[2], level, nature, 1, false);
  const spe = statValue(base.spe, ivs[3], level, nature, 2, false);
  const spa = statValue(base.spa, ivs[4], level, nature, 3, false);
  const spd = statValue(base.spd, ivs[5], level, nature, 4, false);
  writeU32(mon, 80, 0);
  mon[84] = level;
  mon[85] = 0xff;
  writeU16(mon, 86, hp);
  writeU16(mon, 88, hp);
  writeU16(mon, 90, atk);
  writeU16(mon, 92, def);
  writeU16(mon, 94, spe);
  writeU16(mon, 96, spa);
  writeU16(mon, 98, spd);
  return { bytes: mon, personality, tid, sid, checksum: sum, secure };
}

export function decryptSecure(mon) {
  const personality = u32(mon, 0);
  const otId = u32(mon, 4);
  const key = (personality ^ otId) >>> 0;
  const secure = new Uint8Array(48);
  for (let i = 0; i < 12; i++) writeU32(secure, i * 4, (u32(mon, 32 + i * 4) ^ key) >>> 0);
  return { personality, otId, secure, checksum: mon[28] | (mon[29] << 8), order: substructOrder(personality) };
}

export function readSubstruct(secure, locations, which) {
  const slot = locations[which];
  return secure.subarray(slot * 12, slot * 12 + 12);
}

export function chooseVariant(event) {
  const variants = event.variants?.length ? event.variants : [event];
  const index = Math.floor(Math.random() * variants.length);
  return variants[index];
}
