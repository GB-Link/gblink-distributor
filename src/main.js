import * as gblink from './link/gblink.js';
import { createTrader, eventGeneration } from './trade/trade_engine.js';
import {
  deferUntilAnimationEnd,
  TradeTimingRecorder,
} from './trade/trade_timing.js';
import { getEventsForGeneration, getEventById } from './events/index.js';
import { DISTRIBUTION_LINES, getDistributionLine } from './catalog/distribution_catalog.js';
import {
  issuedForTrade,
  renderCertificate,
} from './certificate/certificate.js';

const distributionPicker = document.getElementById('distribution-picker');
const distributionOptions = document.getElementById('distribution-options');
const eventSelect = document.getElementById('event-select');
const statusText = document.getElementById('status-text');
const detailText = document.getElementById('detail-text');
const statusIndicator = document.getElementById('status-indicator');
const instructionBox = document.getElementById('instruction-box');
const instructionText = document.getElementById('instruction-text');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const stepper = document.getElementById('stepper');
const appRoot = document.getElementById('app');
const workflow = document.getElementById('workflow');
const certificatePanel = document.getElementById('certificate-panel');
const certificateMount = document.getElementById('certificate-mount');

let currentPhase = 'idle';
let trader = null;
let polling = false;
let reloadingForDisconnect = false;
let selectedLineId = null;
let selectedEventId = '';

const tradeTiming = new TradeTimingRecorder();
let tradeAnimationStartedAt = 0;
let cancelCompleteDefer = null;
const showTradeTimingDetail = (() => {
  try {
    return new URLSearchParams(window.location.search).get('tradeTiming') === '1';
  } catch {
    return false;
  }
})();

const PHASE_CONFIG = {
  idle: {
    step: -1,
    message: 'Ready to distribute',
    instruction: 'Pick a distribution event, then click "Connect Game Boy".',
    type: 'idle',
  },
  pick_line: {
    step: -1,
    message: 'Choose a Pokémon to distribute',
    instruction: 'Select a Pokémon above. The event list will appear next.',
    type: 'idle',
  },
  connecting: {
    step: 0,
    message: 'Connecting to adapter…',
    instruction: 'Select your GB Link adapter when the browser asks for device access.',
    type: 'active',
  },
  connected: {
    step: 1,
    message: 'Adapter connected — waiting for your Game Boy',
    instruction: 'On your Game Boy: Go to Trade screen → Cable Club → Enter the Cable Club.',
    type: 'active',
  },
  menu_cancelled: {
    step: 0,
    message: 'Adapter connected — ready when you are',
    instruction: 'On your Game Boy: go to Trade screen → Cable Club → enter the Cable Club when you are ready.',
    type: 'idle',
  },
  handshaking: {
    step: 1,
    message: 'Link handshake in progress…',
    instruction: 'Your Game Boy is in the Cable Club. Wait at the Cable Club reception — do not press anything.',
    type: 'active',
  },
  waiting_cable_club: {
    step: 2,
    message: 'Waiting at Trade Center',
    instruction: 'Approach the trade counter and sit down. The trade screen will load automatically.',
    type: 'active',
  },
  data_exchange: {
    step: 2,
    message: 'Exchanging Pokémon data…',
    instruction: 'Hold tight — party and trainer data is being transferred. This takes a few seconds.',
    type: 'active',
  },
  trade_selection: {
    step: 3,
    message: 'Select a Pokémon on your Game Boy',
    instruction: 'Choose any Pokémon from your party. The distributor will send you the event Pokémon in return.',
    type: 'active',
  },
  trade_confirm: {
    step: 3,
    message: 'Confirm the trade',
    instruction: 'Select "Trade" when the game asks if you want to trade.',
    type: 'active',
  },
  trading: {
    step: 3,
    message: 'Trade in progress…',
    instruction: 'Wait for the trade to finish on your Game Boy.',
    type: 'active',
  },
  trade_cancelled: {
    step: 2,
    message: 'Trade cancelled — back at Trade Center',
    instruction: 'Approach the trade counter and sit down again whenever you are ready.',
    type: 'warning',
  },
  complete: {
    step: 4,
    message: 'Trade complete!',
    instruction: 'Check your party — your event Pokémon has been delivered.',
    type: 'success',
  },
  error: {
    step: -1,
    message: 'Something went wrong',
    instruction: '',
    type: 'error',
  },
  disconnected: {
    step: -1,
    message: 'Disconnected',
    instruction: 'Click "Connect Game Boy" to try again.',
    type: 'idle',
  },
};

const STEP_KEYS = ['connect', 'cable-club', 'trade-center', 'trade', 'done'];

function updateStepper(activeStep) {
  const stepEls = stepper.querySelectorAll('.stepper-step');
  const lineEls = stepper.querySelectorAll('.stepper-line');

  stepEls.forEach((el, i) => {
    if (activeStep < 0) {
      el.removeAttribute('data-state');
    } else if (i < activeStep) {
      el.dataset.state = 'done';
    } else if (i === activeStep) {
      el.dataset.state = i === STEP_KEYS.length - 1 ? 'complete' : 'active';
    } else {
      el.removeAttribute('data-state');
    }
  });

  lineEls.forEach((el, i) => {
    if (activeStep > i + 1) {
      el.dataset.state = 'done';
    } else {
      el.removeAttribute('data-state');
    }
  });
}

function setStatus(phase, detail = '') {
  currentPhase = phase;
  updateTimingCalibrationButton();
  const cfg = PHASE_CONFIG[phase] ?? PHASE_CONFIG.idle;

  statusText.textContent = cfg.message;
  statusText.dataset.type = cfg.type;

  statusIndicator.dataset.type = cfg.type;

  detailText.textContent = detail;

  if (cfg.instruction) {
    instructionBox.classList.remove('hidden');
    instructionBox.dataset.type = cfg.type === 'success' ? 'success' : 'default';
    instructionText.textContent = cfg.instruction;
  } else {
    instructionBox.classList.add('hidden');
  }

  updateStepper(cfg.step);
}

const REGION_PREFIX_RE =
  /^(USA|Canada|USA\/Canada|Australia|UK\/Ireland|UK|Europe|Mexico)\s*—\s*/;

function regionOf(label) {
  const m = label.match(REGION_PREFIX_RE);
  return m ? m[1] : 'Other';
}

function selectedLine() {
  return selectedLineId ? getDistributionLine(selectedLineId) : undefined;
}

function eventsForSelectedLine() {
  const line = selectedLine();
  if (!line) return [];
  return getEventsForGeneration(line.generation);
}

function gameLabelForGeneration(generation) {
  return generation === 2 ? 'GSC' : 'RBY';
}

function groupOf(ev) {
  return regionOf(ev.label);
}

function setWorkflowVisible(visible) {
  workflow.classList.toggle('hidden', !visible);
}

function applyDistributionTheme(theme) {
  if (theme) {
    appRoot.dataset.theme = theme;
  } else {
    delete appRoot.dataset.theme;
  }
}

function hideCertificate() {
  certificatePanel.classList.add('hidden');
  certificateMount.replaceChildren();
}

function showIssuedCertificate(event, trainerId) {
  certificatePanel.classList.remove('hidden');
  renderCertificate(certificateMount, issuedForTrade(event, trainerId));
}

function clearCompleteDefer() {
  if (cancelCompleteDefer) {
    cancelCompleteDefer();
    cancelCompleteDefer = null;
  }
}

function reloadForAdapterDisconnect() {
  if (reloadingForDisconnect) return;
  reloadingForDisconnect = true;
  polling = false;
  clearCompleteDefer();
  window.location.reload();
}

gblink.onAdapterDisconnect(reloadForAdapterDisconnect);

function finishTradeComplete(event, trainerId) {
  tradeTiming.markUiComplete();
  hideTimingCalibrationButton();
  const genNum = eventGeneration(event);
  const report = tradeTiming.buildReport(genNum);
  if (report) {
    console.info('[trade-timing]', tradeTiming.formatReport(report), report);
  }

  const gen = genNum === 2 ? 'GSC' : 'RBY';
  const detail = showTradeTimingDetail && report
    ? `${event.label} · OT ${event.otName} · ${gen} · ${tradeTiming.formatReport(report)}`
    : `${event.label} · OT ${event.otName} · ${gen}`;
  setStatus('complete', detail);
  lockPickers(false);
  if (trainerId != null) {
    showIssuedCertificate(event, trainerId);
  }
}

let timingCalibrationBtn = null;

function ensureTimingCalibrationButton() {
  if (!showTradeTimingDetail || timingCalibrationBtn) return;
  timingCalibrationBtn = document.createElement('button');
  timingCalibrationBtn.type = 'button';
  timingCalibrationBtn.id = 'timing-calibration-btn';
  timingCalibrationBtn.className = 'secondary hidden';
  timingCalibrationBtn.textContent = 'GB animation finished (calibrate timing)';
  timingCalibrationBtn.addEventListener('click', () => {
    const genNum = eventGeneration(getSelectedEvent());
    const sample = tradeTiming.markManualAnimationEnd();
    if (!sample) return;
    console.info(
      '[trade-timing] Manual calibration — set TRADE_ANIMATION_MS[%s] = %s (observed %sms)',
      genNum,
      sample.suggestedMs,
      sample.durationMs,
    );
    detailText.textContent =
      `Calibrated: GB animation ${sample.durationMs}ms · suggest TRADE_ANIMATION_MS[${genNum}] = ${sample.suggestedMs}`;
  });
  document.querySelector('.actions')?.appendChild(timingCalibrationBtn);
}

function updateTimingCalibrationButton() {
  ensureTimingCalibrationButton();
  if (!timingCalibrationBtn) return;
  timingCalibrationBtn.classList.toggle('hidden', currentPhase !== 'trading');
}

function hideTimingCalibrationButton() {
  timingCalibrationBtn?.classList.add('hidden');
}

function populateDistributionPicker() {
  distributionOptions.innerHTML = '';
  for (const line of DISTRIBUTION_LINES) {
    const label = document.createElement('label');
    label.className = 'distribution-option';
    label.dataset.lineTheme = line.theme;

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'distribution-line';
    input.value = line.id;

    const body = document.createElement('span');
    body.className = 'distribution-option-body';

    const title = document.createElement('span');
    title.className = 'distribution-option-title';
    title.textContent = line.label;

    const hint = document.createElement('span');
    hint.className = 'distribution-option-hint';
    hint.textContent = line.hint;

    body.append(title, hint);
    label.append(input, body);
    distributionOptions.appendChild(label);
  }
}

function populateEventSelect() {
  const events = eventsForSelectedLine();
  eventSelect.innerHTML = '';

  if (events.length === 0) {
    selectedEventId = '';
    return;
  }

  const groups = new Map();
  for (const ev of events) {
    const key = groupOf(ev);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  for (const [region, regionEvents] of groups) {
    const grp = document.createElement('optgroup');
    grp.label = region;
    for (const ev of regionEvents) {
      const opt = document.createElement('option');
      opt.value = ev.id;
      opt.textContent = ev.label.replace(REGION_PREFIX_RE, '');
      grp.appendChild(opt);
    }
    eventSelect.appendChild(grp);
  }

  if (!events.some((e) => e.id === selectedEventId)) {
    selectedEventId = events[0].id;
  }
  eventSelect.value = selectedEventId;
}

function lockPickers(locked) {
  for (const input of distributionPicker.querySelectorAll('input[type="radio"]')) {
    input.disabled = locked;
  }
  eventSelect.disabled = locked;
}

function getSelectedEvent() {
  const events = eventsForSelectedLine();
  const found = events.find((e) => e.id === eventSelect.value);
  return found ?? events[0] ?? getEventById(eventSelect.value);
}

function onDistributionLineChange(lineId) {
  const line = getDistributionLine(lineId);
  if (!line) return;

  selectedLineId = lineId;
  applyDistributionTheme(line.theme);
  setWorkflowVisible(true);
  populateEventSelect();
  trader = null;

  if (!gblink.isTransportAvailable()) {
    setStatus('error', 'No adapter transport available. Use Chrome or Edge (WebUSB) or Firefox 151+ (WebSerial).');
    connectBtn.disabled = true;
  } else {
    connectBtn.disabled = false;
    setStatus('idle', `${line.label} · ${gameLabelForGeneration(line.generation)}`);
  }
  hideCertificate();
}

function ensureTrader() {
  const event = getSelectedEvent();
  const phaseHandler = {
    onPhaseChange: (phase) => {
      if (!gblink.isConnected()) return;

      const ev = getSelectedEvent();
      const genNum = eventGeneration(ev);
      const gen = genNum === 2 ? 'GSC' : 'RBY';
      const detail = `${ev.label} · OT ${ev.otName} · ${gen}`;

      tradeTiming.mark(phase);

      if (phase === 'trading') {
        tradeAnimationStartedAt = performance.now();
        updateTimingCalibrationButton();
      }

      if (phase === 'menu_cancelled') {
        clearCompleteDefer();
        tradeAnimationStartedAt = 0;
        hideCertificate();
        setStatus(phase, detail);
        lockPickers(false);
        return;
      }

      if (phase === 'complete') {
        const tid = trader?.tid;
        clearCompleteDefer();
        if (genNum === 1) {
          finishTradeComplete(ev, tid);
        } else {
          cancelCompleteDefer = deferUntilAnimationEnd(
            genNum,
            tradeAnimationStartedAt,
            () => {
              cancelCompleteDefer = null;
              finishTradeComplete(ev, tid);
            },
          );
        }
        return;
      }

      setStatus(phase, detail);
      if (phase !== 'idle' && phase !== 'disconnected') {
        lockPickers(true);
      }
    },
  };

  if (!trader || eventGeneration(event) !== eventGeneration(trader.event ?? event)) {
    trader = createTrader(event, phaseHandler);
  } else {
    trader.setEvent(event);
  }
  return trader;
}

async function pollLoop() {
  polling = true;
  const t = ensureTrader();

  let toSend = 0x01;

  while (polling && gblink.isConnected()) {
    try {
      const inLinkSetup = t.connectionState === 'NOT_CONNECTED'
        || t.connectionState === 'CABLE_CLUB';
      await sleep(inLinkSetup ? 1 : 4);

      await gblink.sendByte(toSend);
      const received = await gblink.receiveByte();
      if (!polling) break;

      if (received !== null) {
        if (received === 0xff && inLinkSetup) continue;
        toSend = t.handleByte(received);
      } else if (inLinkSetup && typeof t.linkIdleOutByte === 'function') {
        toSend = t.linkIdleOutByte();
      }
    } catch (err) {
      if (!polling) break;
      if (!gblink.isConnected()) {
        reloadForAdapterDisconnect();
        break;
      }
      console.warn('[trade] poll error:', err);
      await sleep(50);
      toSend = 0x01;
    }
  }
  polling = false;
  if (!gblink.isConnected()) {
    reloadForAdapterDisconnect();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function onConnect() {
  if (!selectedLineId) {
    setStatus('pick_line');
    return;
  }
  try {
    hideCertificate();
    clearCompleteDefer();
    tradeTiming.reset();
    tradeAnimationStartedAt = 0;
    lockPickers(true);
    setStatus('connecting');
    connectBtn.disabled = true;
    await gblink.connect();
    ensureTrader();
    tradeTiming.startSession(eventGeneration(getSelectedEvent()));
    disconnectBtn.disabled = false;
    const ev = getSelectedEvent();
    const gen = eventGeneration(ev) === 2 ? 'GSC' : 'RBY';
    setStatus('connected', `${ev.label} · ${gen}`);
    pollLoop();
  } catch (err) {
    lockPickers(false);
    connectBtn.disabled = false;
    setStatus('error', err instanceof Error ? err.message : String(err));
  }
}

async function onDisconnect() {
  polling = false;
  await gblink.disconnect();
  reloadForAdapterDisconnect();
}

distributionPicker.addEventListener('change', (e) => {
  const target = e.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'radio' || !target.checked) {
    return;
  }
  onDistributionLineChange(target.value);
});

eventSelect.addEventListener('change', () => {
  selectedEventId = eventSelect.value;
  if (trader && !polling) {
    trader.setEvent(getSelectedEvent());
  }
  if (!polling) {
    hideCertificate();
  }
});

connectBtn.addEventListener('click', onConnect);
disconnectBtn.addEventListener('click', onDisconnect);

function mountLauncherReturn() {
  if (document.getElementById('gblink-launcher-return')) return;
  const a = document.createElement('a');
  a.id = 'gblink-launcher-return';
  a.href = 'https://launcher.gblink.io';
  a.setAttribute('aria-label', 'Return to the GB Link launcher');
  a.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="19" y1="12" x2="5" y2="12"></line>' +
    '<polyline points="12 19 5 12 12 5"></polyline></svg>' +
    '<span>Launcher</span>';
  a.style.cssText = [
    'position:fixed', 'top:12px', 'left:12px', 'z-index:2147483647',
    'display:inline-flex', 'align-items:center', 'gap:6px',
    'padding:7px 12px', 'box-sizing:border-box',
    'font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    'color:#fff', 'text-decoration:none', 'white-space:nowrap',
    'background:rgba(20,22,30,0.78)', 'border:1px solid rgba(255,255,255,0.18)',
    'border-radius:9px', 'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)', 'box-shadow:0 2px 10px rgba(0,0,0,0.35)',
    'cursor:pointer', 'transition:background 0.15s ease',
  ].join(';');
  a.onmouseenter = () => { a.style.background = 'rgba(40,44,58,0.92)'; };
  a.onmouseleave = () => { a.style.background = 'rgba(20,22,30,0.78)'; };
  document.body.appendChild(a);
}

try {
  if (new URLSearchParams(window.location.search).get('from') === 'gblink-launcher') {
    mountLauncherReturn();
  }
} catch {
}

populateDistributionPicker();
setWorkflowVisible(false);

if (!gblink.isTransportAvailable()) {
  connectBtn.disabled = true;
}
