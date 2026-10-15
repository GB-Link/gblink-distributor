const USB_FILTERS = [
  { vendorId: 0x239a },
  { vendorId: 0xcafe },
  { vendorId: 0x2fe3 },
];

const SERIAL_FILTERS = [{ usbVendorId: 0x2fe3 }];

const VSWITCH_PREFIX = new Uint8Array([
  0xca, 0xfe, 0xca, 0xfe, 0xca, 0xfe, 0xca, 0xfe,
  0xca, 0xfe, 0xca, 0xfe, 0xca, 0xfe, 0xca, 0xfe,
  0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
  0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef,
]);

const SERIAL_SYNC0 = 0x47;
const SERIAL_SYNC1 = 0x42;
const SERIAL_CH_CMD = 0x00;
const SERIAL_CH_DATA = 0x01;
const SERIAL_CH_STATUS = 0x02;
const SERIAL_MAX_PAYLOAD = 64;

const GBL_CMD = {
  SET_MODE: 0x00,
  SET_TIMING_CONFIG: 0x30,
  SET_VOLTAGE_3V3: 0x40,
  SET_VOLTAGE_5V: 0x41,
};

const GBL_MODE = {
  GBA_LINK: 0x01,
  GB_LINK: 0x02,
};

function buildVswitchPacket(suffix) {
  const pkt = new Uint8Array(36);
  pkt.set(VSWITCH_PREFIX);
  pkt.set(new TextEncoder().encode(suffix), 32);
  return pkt;
}

const VSWITCH_5V_PACKET = buildVswitchPacket('V5V0');
const VSWITCH_3V3_PACKET = buildVswitchPacket('V3V3');

function fwVersionAtLeast(device, major, minor, patch) {
  const dMaj = device.deviceVersionMajor ?? 0;
  const dMin = device.deviceVersionMinor ?? 0;
  const dPat = device.deviceVersionSubminor ?? 0;
  if (dMaj !== major) return dMaj > major;
  if (dMin !== minor) return dMin > minor;
  return dPat >= patch;
}

let active = null;
let inFlightRead = null;
let pendingStatus = null;
let queuedStatus = null;
let statusGen = 0;
let pendingDataRead = null;
let pendingDataPacket = null;
let dataReadGen = 0;
let adapterDisconnectHandler = null;
let disconnectListenersReady = false;

export function onAdapterDisconnect(handler) {
  adapterDisconnectHandler = handler;
}

function isLinkLostError(err) {
  if (!(err instanceof DOMException)) return false;
  return err.name === 'NetworkError' || err.name === 'NotFoundError';
}

function notifyAdapterDisconnect() {
  const conn = active;
  if (!conn) return;
  active = null;
  inFlightRead = null;
  clearPendingStatus();
  clearPendingDataRead();
  if (conn.kind === 'serial') {
    while (conn.dataWaiters.length > 0) conn.dataWaiters.shift().resolve(null);
    while (conn.statusWaiters.length > 0) conn.statusWaiters.shift().resolve(null);
    try { conn.reader?.cancel(); } catch { }
  }
  adapterDisconnectHandler?.();
}

function setupDisconnectListeners() {
  if (disconnectListenersReady) return;
  disconnectListenersReady = true;
  navigator.usb?.addEventListener?.('disconnect', (e) => {
    if (active?.kind === 'usb' && e.device === active.device) notifyAdapterDisconnect();
  });
  navigator.serial?.addEventListener?.('disconnect', (e) => {
    const port = e.target ?? e.port;
    if (active?.kind === 'serial' && port === active.port) notifyAdapterDisconnect();
  });
}

export function isTransportAvailable() {
  return !!(navigator.usb || navigator.serial);
}

export function isConnected() {
  return active !== null;
}

export async function connect() {
  if (navigator.usb) {
    return connectUsb();
  }
  if (navigator.serial) {
    return connectSerial();
  }
  throw new Error(
    'No supported adapter transport. Use Chrome or Edge (WebUSB) or Firefox 151+ (WebSerial).',
  );
}

async function connectUsb() {
  setupDisconnectListeners();

  try {
    const existing = await navigator.usb.getDevices();
    for (const dev of existing) {
      if (dev.opened) {
        try { await dev.close(); } catch { }
      }
    }
  } catch { }

  const device = await navigator.usb.requestDevice({ filters: USB_FILTERS });

  await device.open();

  if (device.reset) {
    try {
      await device.reset();
    } catch { }
  }

  await device.selectConfiguration(1);

  const isNewFirmware = device.vendorId === 0x2fe3;

  let ifNum = 0;
  let epIn = 1;
  let epOut = 1;
  let cmdEpOut = 1;
  let cmdEpIn = 1;

  for (const iface of device.configuration.interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass === 0xff) {
        ifNum = iface.interfaceNumber;

        const inEps = alt.endpoints
          .filter((e) => e.direction === 'in')
          .sort((a, b) => a.endpointNumber - b.endpointNumber);
        const outEps = alt.endpoints
          .filter((e) => e.direction === 'out')
          .sort((a, b) => a.endpointNumber - b.endpointNumber);

        if (isNewFirmware && outEps.length >= 2 && inEps.length >= 2) {
          cmdEpOut = outEps[0].endpointNumber;
          cmdEpIn = inEps[0].endpointNumber;
          epOut = outEps[outEps.length - 1].endpointNumber;
          epIn = inEps[inEps.length - 1].endpointNumber;
        } else {
          if (outEps.length > 0) epOut = outEps[outEps.length - 1].endpointNumber;
          if (inEps.length > 0) epIn = inEps[inEps.length - 1].endpointNumber;
          cmdEpOut = epOut;
        }
      }
    }
  }

  await device.claimInterface(ifNum);
  await device.selectAlternateInterface(ifNum, 0);

  if (isNewFirmware) {
    await device.transferOut(cmdEpOut, new Uint8Array([GBL_CMD.SET_MODE, GBL_MODE.GB_LINK]));
    await device.transferOut(cmdEpOut, new Uint8Array([GBL_CMD.SET_VOLTAGE_5V]));
    await new Promise((r) => setTimeout(r, 500));
  } else {
    try {
      await device.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: 0x22,
        value: 0x01,
        index: ifNum,
      });
    } catch { }

    if (fwVersionAtLeast(device, 1, 0, 6)) {
      await device.transferOut(epOut, VSWITCH_5V_PACKET);
      try {
        await Promise.race([
          device.transferIn(epIn, 64),
          new Promise((_, rej) => setTimeout(() => rej(new Error('ack timeout')), 500)),
        ]);
      } catch { }
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  active = { kind: 'usb', device, epIn, epOut, cmdEpOut, cmdEpIn, isNewFirmware };
  inFlightRead = null;
  clearPendingStatus();
  clearPendingDataRead();
  return active;
}

function createSerialRxState() {
  return {
    state: 'sync1',
    channel: 0,
    len: 0,
    buf: null,
    pos: 0,
  };
}

function dispatchSerialDataFrame(conn, frame) {
  const waiter = conn.dataWaiters.shift();
  if (waiter) waiter.resolve(frame);
  else conn.dataQueue.push(frame);
}

function dispatchSerialStatusFrame(conn, frame) {
  const waiter = conn.statusWaiters.shift();
  if (waiter) waiter.resolve(frame);
  else conn.statusQueue.push(frame);
}

function feedSerialByte(conn, b) {
  const rx = conn.rx;
  switch (rx.state) {
    case 'sync1':
      if (b === SERIAL_SYNC0) rx.state = 'sync2';
      break;
    case 'sync2':
      if (b === SERIAL_SYNC1) rx.state = 'channel';
      else if (b === SERIAL_SYNC0) rx.state = 'sync2';
      else rx.state = 'sync1';
      break;
    case 'channel':
      rx.channel = b;
      rx.state = 'lenLo';
      break;
    case 'lenLo':
      rx.len = b;
      rx.state = 'lenHi';
      break;
    case 'lenHi':
      rx.len |= b << 8;
      if (rx.len > SERIAL_MAX_PAYLOAD) {
        rx.state = 'sync1';
        break;
      }
      rx.pos = 0;
      rx.buf = new Uint8Array(rx.len);
      if (rx.len === 0) {
        if (rx.channel === SERIAL_CH_DATA) dispatchSerialDataFrame(conn, rx.buf);
        else if (rx.channel === SERIAL_CH_STATUS) dispatchSerialStatusFrame(conn, rx.buf);
        rx.state = 'sync1';
      } else {
        rx.state = 'payload';
      }
      break;
    case 'payload':
      rx.buf[rx.pos++] = b;
      if (rx.pos >= rx.len) {
        if (rx.channel === SERIAL_CH_DATA) dispatchSerialDataFrame(conn, rx.buf);
        else if (rx.channel === SERIAL_CH_STATUS) dispatchSerialStatusFrame(conn, rx.buf);
        rx.state = 'sync1';
      }
      break;
    default:
      rx.state = 'sync1';
      break;
  }
}

function runSerialReadLoop(conn) {
  (async () => {
    try {
      while (active === conn && conn.reader) {
        const { value, done } = await conn.reader.read();
        if (done) {
          if (active === conn) notifyAdapterDisconnect();
          break;
        }
        if (!value?.length) continue;
        for (let i = 0; i < value.length; i++) feedSerialByte(conn, value[i]);
      }
    } catch (err) {
      if (active === conn) {
        if (isLinkLostError(err)) notifyAdapterDisconnect();
      }
    }
  })();
}

async function writeSerialFrame(conn, channel, payload) {
  if (!conn.writer) throw new Error('GB-Link not connected.');
  if (payload.length > SERIAL_MAX_PAYLOAD) throw new Error('Serial payload too large');
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = SERIAL_SYNC0;
  frame[1] = SERIAL_SYNC1;
  frame[2] = channel;
  frame[3] = payload.length & 0xff;
  frame[4] = (payload.length >> 8) & 0xff;
  frame.set(payload, 5);
  try {
    await conn.writer.write(frame);
  } catch (err) {
    if (isLinkLostError(err)) notifyAdapterDisconnect();
    throw err;
  }
}

async function sendSerialCommand(conn, bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  await writeSerialFrame(conn, SERIAL_CH_CMD, buf);
}

async function connectSerial() {
  setupDisconnectListeners();

  const port = await navigator.serial.requestPort({ filters: SERIAL_FILTERS });
  port.addEventListener?.('disconnect', () => {
    if (active?.kind === 'serial' && active.port === port) notifyAdapterDisconnect();
  });
  await port.open({ baudRate: 115200 });

  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  const conn = {
    kind: 'serial',
    port,
    writer,
    reader,
    dataQueue: [],
    dataWaiters: [],
    statusQueue: [],
    statusWaiters: [],
    isNewFirmware: true,
    rx: createSerialRxState(),
  };

  active = conn;
  inFlightRead = null;
  clearPendingStatus();
  clearPendingDataRead();
  runSerialReadLoop(conn);

  await sendSerialCommand(conn, new Uint8Array([GBL_CMD.SET_MODE, GBL_MODE.GB_LINK]));
  await sendSerialCommand(conn, new Uint8Array([GBL_CMD.SET_VOLTAGE_5V]));
  await new Promise((r) => setTimeout(r, 500));

  return conn;
}

export async function disconnect() {
  const a = active;
  active = null;
  inFlightRead = null;
  clearPendingStatus();
  clearPendingDataRead();
  if (!a) return;

  if (a.kind === 'usb') {
    try { await a.device.close(); } catch { }
    return;
  }

  while (a.dataWaiters.length > 0) {
    const waiter = a.dataWaiters.shift();
    waiter.resolve(null);
  }
  while (a.statusWaiters?.length > 0) {
    a.statusWaiters.shift().resolve(null);
  }

  try { await a.reader?.cancel(); } catch { }
  try { a.reader?.releaseLock(); } catch { }
  try { a.writer?.releaseLock(); } catch { }
  try { await a.port?.close(); } catch { }
}

export async function sendByte(byte) {
  if (!active) throw new Error('GB-Link not connected.');
  try {
    if (active.kind === 'usb') {
      await active.device.transferOut(active.epOut, new Uint8Array([byte & 0xff]));
      return;
    }
    await writeSerialFrame(active, SERIAL_CH_DATA, new Uint8Array([byte & 0xff]));
  } catch (err) {
    if (isLinkLostError(err)) {
      notifyAdapterDisconnect();
    }
    throw err;
  }
}

function waitSerialDataFrame(conn, timeoutMs = 0) {
  if (conn.dataQueue.length > 0) return Promise.resolve(conn.dataQueue.shift());
  if (!timeoutMs) {
    return new Promise((resolve) => {
      conn.dataWaiters.push({ resolve });
    });
  }
  return new Promise((resolve) => {
    let done = false;
    const waiter = {
      resolve(frame) {
        if (done) {
          if (frame) conn.dataQueue.unshift(frame);
          return;
        }
        done = true;
        resolve(frame);
      },
    };
    conn.dataWaiters.push(waiter);
    delay(timeoutMs).then(() => {
      if (done) return;
      done = true;
      const index = conn.dataWaiters.indexOf(waiter);
      if (index >= 0) conn.dataWaiters.splice(index, 1);
      resolve(null);
    });
  });
}

export function receiveByte() {
  if (!active) return Promise.resolve(null);

  if (inFlightRead) return inFlightRead;

  if (active.kind === 'usb') {
    const dev = active.device;
    const epIn = active.epIn;

    inFlightRead = dev
      .transferIn(epIn, 64)
      .then((result) => {
        inFlightRead = null;
        if (!result?.data?.byteLength) return null;
        return result.data.getUint8(0);
      })
      .catch((err) => {
        inFlightRead = null;
        if (isLinkLostError(err)) {
          notifyAdapterDisconnect();
          return null;
        }
        return null;
      });

    return inFlightRead;
  }

  inFlightRead = waitSerialDataFrame(active)
    .then((frame) => {
      inFlightRead = null;
      if (!frame?.length) return null;
      return frame[0];
    })
    .catch((err) => {
      inFlightRead = null;
      if (isLinkLostError(err)) {
        notifyAdapterDisconnect();
        return null;
      }
      return null;
    });

  return inFlightRead;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendCommandBytes(bytes) {
  if (!active) throw new Error('GB-Link not connected.');
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (active.kind === 'usb') {
    await active.device.transferOut(active.cmdEpOut, payload);
    return;
  }
  await sendSerialCommand(active, payload);
}

export async function setMode(mode) {
  await sendCommandBytes([GBL_CMD.SET_MODE, mode & 0xff]);
}

export async function setVoltage(mode) {
  if (!active) throw new Error('GB-Link not connected.');
  if (active.isNewFirmware) {
    const cmd = mode === '5v' ? GBL_CMD.SET_VOLTAGE_5V : GBL_CMD.SET_VOLTAGE_3V3;
    await sendCommandBytes([cmd]);
    return;
  }
  if (!fwVersionAtLeast(active.device, 1, 0, 6)) return;
  const packet = mode === '5v' ? VSWITCH_5V_PACKET : VSWITCH_3V3_PACKET;
  await active.device.transferOut(active.epOut, packet);
  try {
    await Promise.race([
      active.device.transferIn(active.epIn, 64),
      delay(500).then(() => null),
    ]);
  } catch { }
}

export async function setTimingConfig(usBetweenTransfer, bytesPerTransfer) {
  if (!active) throw new Error('GB-Link not connected.');
  if (active.isNewFirmware) {
    await sendCommandBytes([
      GBL_CMD.SET_TIMING_CONFIG,
      usBetweenTransfer & 0xff,
      (usBetweenTransfer >> 8) & 0xff,
      (usBetweenTransfer >> 16) & 0xff,
      bytesPerTransfer & 0xff,
    ]);
    return;
  }
  const config = new Uint8Array(36);
  config.set(VSWITCH_PREFIX);
  config[32] = usBetweenTransfer & 0xff;
  config[33] = (usBetweenTransfer >> 8) & 0xff;
  config[34] = (usBetweenTransfer >> 16) & 0xff;
  config[35] = bytesPerTransfer & 0xff;
  await active.device.transferOut(active.epOut, config);
}

export async function prepareMultiboot() {
  if (!active) throw new Error('GB-Link not connected.');
  await setVoltage('3v3');
  if (active.isNewFirmware) {
    await setMode(GBL_MODE.GB_LINK);
    await delay(100);
  }
  await setTimingConfig(36, 4);
  if (!active.isNewFirmware) await drainData();
}

export async function prepareGen3Trade() {
  if (!active) throw new Error('GB-Link not connected.');
  if (!active.isNewFirmware) {
    throw new Error('Cable Club trade needs a GB-Link adapter with current firmware.');
  }
  clearPendingStatus();
  clearPendingDataRead();
  await setVoltage('3v3');
  await setMode(GBL_MODE.GBA_LINK);
  await delay(100);
  // The Game Boy clocks the cable. It only counts a partner that is already
  // sending the slave handshake when the attendant opens the link.
  await sendCommandBytes([0x11]);
  await delay(150);
  await sendCommandBytes([0x12]);
}

async function drainData() {
  const until = Date.now() + 80;
  while (Date.now() < until && active?.kind === 'usb') {
    try {
      await Promise.race([
        active.device.transferIn(active.epIn, 64),
        delay(15).then(() => null),
      ]);
    } catch {
      break;
    }
  }
}

export async function writeData(bytes) {
  if (!active) throw new Error('GB-Link not connected.');
  const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (active.kind === 'usb') {
    await active.device.transferOut(active.epOut, payload);
    return;
  }
  await writeSerialFrame(active, SERIAL_CH_DATA, payload);
}

function clearPendingDataRead() {
  dataReadGen += 1;
  pendingDataRead = null;
  pendingDataPacket = null;
}

function beginDataRead(length) {
  if (pendingDataRead || pendingDataPacket || !active || active.kind !== 'usb') return;
  const gen = dataReadGen;
  const dev = active.device;
  const epIn = active.epIn;
  pendingDataRead = dev.transferIn(epIn, Math.max(64, length)).then((result) => {
    if (gen !== dataReadGen) return;
    pendingDataRead = null;
    if (!result?.data?.byteLength) {
      pendingDataPacket = new Uint8Array(0);
      return;
    }
    pendingDataPacket = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
  }).catch((err) => {
    if (gen !== dataReadGen) return;
    pendingDataRead = null;
    pendingDataPacket = new Uint8Array(0);
    if (isLinkLostError(err)) notifyAdapterDisconnect();
  });
}

export async function readData(length, timeoutMs = 0) {
  if (!active) return null;
  if (active.kind === 'serial') {
    return waitSerialDataFrame(active, timeoutMs);
  }
  if (pendingDataPacket) {
    const packet = pendingDataPacket;
    pendingDataPacket = null;
    return packet.byteLength ? packet : null;
  }
  beginDataRead(length);
  if (!pendingDataRead && !pendingDataPacket) return null;
  if (timeoutMs > 0 && pendingDataRead) {
    const timed = await Promise.race([
      pendingDataRead.then(() => 'ready'),
      delay(timeoutMs).then(() => 'timeout'),
    ]);
    if (timed === 'timeout') return null;
  } else if (pendingDataRead) {
    await pendingDataRead;
  }
  if (!pendingDataPacket) return null;
  const packet = pendingDataPacket;
  pendingDataPacket = null;
  return packet.byteLength ? packet : null;
}

function clearPendingStatus() {
  statusGen += 1;
  pendingStatus = null;
  queuedStatus = null;
}

function ensureStatusRead() {
  if (pendingStatus || queuedStatus != null || !active || active.kind !== 'usb') return;
  const gen = statusGen;
  const dev = active.device;
  const ep = active.cmdEpIn;
  pendingStatus = dev.transferIn(ep, 64).then((result) => {
    if (gen !== statusGen) return;
    pendingStatus = null;
    if (!result?.data || result.data.byteLength < 2) return;
    queuedStatus = result.data.getUint8(0) | (result.data.getUint8(1) << 8);
  }, (err) => {
    if (gen !== statusGen) return;
    pendingStatus = null;
    if (isLinkLostError(err)) notifyAdapterDisconnect();
  });
}

export function takeReadyStatus() {
  if (!active) return null;
  if (active.kind === 'serial') {
    if (active.statusQueue.length === 0) return null;
    const frame = active.statusQueue.shift();
    if (!frame || frame.length < 2) return null;
    return frame[0] | (frame[1] << 8);
  }
  if (active.kind !== 'usb') return null;
  ensureStatusRead();
  if (queuedStatus == null) return null;
  const status = queuedStatus;
  queuedStatus = null;
  ensureStatusRead();
  return status;
}

export async function readStatus(timeoutMs = 1000) {
  if (!active) return null;
  if (active.kind === 'serial') {
    if (active.statusQueue.length > 0) {
      const frame = active.statusQueue.shift();
      if (!frame || frame.length < 2) return null;
      return frame[0] | (frame[1] << 8);
    }
    let waiter;
    const frame = await Promise.race([
      new Promise((resolve) => {
        waiter = { resolve };
        active.statusWaiters.push(waiter);
      }),
      delay(timeoutMs).then(() => null),
    ]);
    if (!frame) {
      const index = active?.statusWaiters?.indexOf(waiter) ?? -1;
      if (index >= 0) active.statusWaiters.splice(index, 1);
      return null;
    }
    if (frame.length < 2) return null;
    return frame[0] | (frame[1] << 8);
  }
  if (queuedStatus != null) {
    const status = queuedStatus;
    queuedStatus = null;
    return status;
  }
  ensureStatusRead();
  if (!pendingStatus) return null;
  if (timeoutMs > 0) {
    const timed = await Promise.race([
      pendingStatus.then(() => 'ready'),
      delay(timeoutMs).then(() => 'timeout'),
    ]);
    if (timed === 'timeout') return null;
  } else {
    await pendingStatus;
  }
  if (queuedStatus == null) return null;
  const status = queuedStatus;
  queuedStatus = null;
  return status;
}

