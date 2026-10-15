import * as gblink from './gblink.js';

const BATCH_WORDS = 14;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function spi32(value) {
  const tx = new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
  await gblink.writeData(tx);
  const rx = await gblink.readData(4);
  if (!rx || rx.length < 4) return 0;
  return ((rx[0] << 24) | (rx[1] << 16) | (rx[2] << 8) | rx[3]) >>> 0;
}

async function spi32Batch(values) {
  const tx = new Uint8Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const value = values[i] >>> 0;
    tx[i * 4] = (value >>> 24) & 0xff;
    tx[i * 4 + 1] = (value >>> 16) & 0xff;
    tx[i * 4 + 2] = (value >>> 8) & 0xff;
    tx[i * 4 + 3] = value & 0xff;
  }
  await gblink.writeData(tx);
  const expected = values.length * 4;
  const received = new Uint8Array(expected);
  let got = 0;
  while (got < expected) {
    const chunk = await gblink.readData(expected - got);
    if (!chunk || chunk.length === 0) return null;
    received.set(chunk.subarray(0, expected - got), got);
    got += Math.min(chunk.length, expected - got);
  }
  const results = [];
  for (let i = 0; i < values.length; i++) {
    results.push(((received[i * 4] << 24) | (received[i * 4 + 1] << 16)
      | (received[i * 4 + 2] << 8) | received[i * 4 + 3]) >>> 0);
  }
  return results;
}

export async function sendMultiboot(romData, log = () => {}) {
  const fdata = romData instanceof Uint8Array ? romData : new Uint8Array(romData);
  let fsize = fdata.length;
  if (fsize > 0x40000) throw new Error('Multiboot image is larger than 256KB.');
  if (fdata.length < 0xc0 || fdata[0xb2] !== 0x96) throw new Error('This is not a GBA multiboot client.');

  const padded = new Uint8Array(fsize + 0x10);
  padded.set(fdata);
  await gblink.prepareMultiboot();
  log('Waiting for the Game Boy Advance. Hold Start and Select while powering on.');

  let attempts = 0;
  let recv = 0;
  do {
    const raw = await spi32(0x6202);
    recv = raw >>> 16;
    await delay(10);
    attempts++;
    if (attempts > 6000) throw new Error('The Game Boy Advance did not answer the multiboot handshake.');
  } while (recv !== 0x7202);

  log('Game Boy Advance detected. Sending the distribution.');
  await spi32(0x6102);

  const headerWords = [];
  for (let i = 0; i < 0xc0; i += 2) headerWords.push(padded[i] | (padded[i + 1] << 8));
  for (let i = 0; i < headerWords.length; i += BATCH_WORDS) {
    const results = await spi32Batch(headerWords.slice(i, i + BATCH_WORDS));
    if (!results) throw new Error('The multiboot header was not accepted.');
  }

  await spi32(0x6200);
  await spi32(0x6202);
  await spi32(0x63d1);
  const token = await spi32(0x63d1);
  if ((token >>> 24) !== 0x73) throw new Error('The multiboot handshake failed.');

  let crcA = (token >>> 16) & 0xff;
  let seed = (0xffff00d1 | (crcA << 8)) >>> 0;
  crcA = (crcA + 0x0f) & 0xff;
  await spi32(0x6400 | crcA);

  fsize = (fsize + 0x0f) & ~0x0f;
  const token2 = await spi32(((fsize - 0x190) / 4) >>> 0);
  const crcB = (token2 >>> 16) & 0xff;
  let crcC = 0xc387;

  for (let i = 0xc0; i < fsize;) {
    const wordsInBatch = Math.min(BATCH_WORDS, (fsize - i) / 4);
    const batch = [];
    for (let w = 0; w < wordsInBatch; w++) {
      const offset = i + w * 4;
      let dat = (padded[offset]
        | (padded[offset + 1] << 8)
        | (padded[offset + 2] << 16)
        | (padded[offset + 3] << 24)) >>> 0;
      let tmp = dat;
      for (let b = 0; b < 32; b++) {
        const bit = (crcC ^ tmp) & 1;
        crcC = (crcC >>> 1) ^ (bit ? 0xc37b : 0);
        tmp >>>= 1;
      }
      seed = Number((BigInt(seed) * 0x6f646573n + 1n) & 0xffffffffn);
      dat = (seed ^ dat ^ ((0xfe000000 - offset) >>> 0) ^ 0x43202f2f) >>> 0;
      batch.push(dat);
    }
    const responses = await spi32Batch(batch);
    if (!responses) throw new Error(`Multiboot stopped at byte ${i}.`);
    for (let w = 0; w < wordsInBatch; w++) {
      const offset = i + w * 4;
      const chk = (responses[w] >>> 16) & 0xffff;
      if (chk !== (offset & 0xffff)) {
        throw new Error(`Multiboot checksum failed at byte ${offset}.`);
      }
    }
    i += wordsInBatch * 4;
    const progress = Math.floor(((i - 0xc0) / (fsize - 0xc0)) * 100);
    log(`${progress}%`);
  }

  let tmp = (0xffff0000 | (crcB << 8) | crcA) >>> 0;
  for (let b = 0; b < 32; b++) {
    const bit = (crcC ^ tmp) & 1;
    crcC = (crcC >>> 1) ^ (bit ? 0xc37b : 0);
    tmp >>>= 1;
  }
  await spi32(0x0065);
  do {
    recv = (await spi32(0x0065)) >>> 16;
    await delay(10);
  } while (recv !== 0x0075);
  await spi32(0x0066);
  await spi32(crcC & 0xffff);
  await delay(1000);
  return true;
}

export async function loadClient(path) {
  const response = await fetch(new URL(path, `${document.baseURI}`), { cache: 'no-store' });
  if (!response.ok) throw new Error('The distribution client could not be loaded.');
  return new Uint8Array(await response.arrayBuffer());
}
