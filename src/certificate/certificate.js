import { saveCertificateImage } from './certificate_export.js';
import { speciesSpriteUrl } from '../assets/species_sprites.js';

function speciesThemeFor(speciesKey) {
  const k = speciesKey.toUpperCase();
  if (k === 'MEW') return 'mew';
  if (k === 'PIKACHU') return 'pikachu';
  if (k === 'CELEBI') return 'celebi';
  return 'default';
}

function formatSpeciesName(key) {
  if (!key) return '—';
  const lower = key.toLowerCase().replace(/_/g, ' ');
  return lower.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCertificateTrainerId(tid) {
  return String(tid & 0xffff).padStart(5, '0');
}

export function issuedForTrade(event, trainerId) {
  const shortLabel = event.label
    .replace(/^(USA|Canada|USA\/Canada|Australia|UK\/Ireland|UK|Europe|Mexico)\s*—\s*/, '')
    .replace(/^English\s*—\s*/, '');
  return {
    species: event.species,
    speciesTheme: speciesThemeFor(event.species),
    nickname: event.nickname,
    otName: event.otName,
    trainerId,
    eventLabel: shortLabel,
    transferredAt: new Date(),
    generation: event.generation ?? 1,
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const TITLE_FONT =
  'Arial Rounded MT Bold, Nunito, Trebuchet MS, Segoe UI, sans-serif';
let arcTitleSeq = 0;

const TITLE_GRADIENT = [
  ['0%', '#fff4a8'],
  ['22%', '#ffd836'],
  ['48%', '#ffb347'],
  ['72%', '#c8d4f0'],
  ['100%', '#8eb0e8'],
];
const TITLE_STROKE = '#4a3f6e';
const TITLE_SHADOW = '#3d3558';

function applyTitleFont(text) {
  text.setAttribute('font-family', TITLE_FONT);
  text.setAttribute('font-size', '26');
  text.setAttribute('font-weight', '900');
  text.setAttribute('letter-spacing', '0.5');
}

function createTitleTextPath(arcId, label) {
  const textPath = document.createElementNS(SVG_NS, 'textPath');
  textPath.setAttribute('href', `#${arcId}`);
  textPath.setAttribute('startOffset', '50%');
  textPath.setAttribute('text-anchor', 'middle');
  textPath.textContent = label;
  return textPath;
}

function createSpeciesSprite(src, species) {
  const sprite = document.createElement('img');
  sprite.className = 'certificate-species-sprite';
  sprite.alt = formatSpeciesName(species);
  sprite.decoding = 'async';
  sprite.src = src;
  return sprite;
}

function createSpeciesName(species) {
  const speciesDisplay = document.createElement('p');
  speciesDisplay.className = 'certificate-species-display';
  speciesDisplay.textContent = formatSpeciesName(species);
  return speciesDisplay;
}

function mountSpeciesArt(artSpace, data) {
  const bundled = speciesSpriteUrl(data.species);
  if (!bundled) {
    artSpace.append(createSpeciesName(data.species));
    return Promise.resolve();
  }
  const sprite = createSpeciesSprite(bundled, data.species);
  artSpace.append(sprite);
  return sprite.decode?.().catch(() => {}) ?? Promise.resolve();
}

function createArcTitle() {
  const uid = `cert-title-${++arcTitleSeq}`;
  const wrap = document.createElement('div');
  wrap.className = 'certificate-title-wrap';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'certificate-title-svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('viewBox', '0 8 500 88');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Certificate of Authenticity');
  svg.setAttribute('overflow', 'visible');

  const defs = document.createElementNS(SVG_NS, 'defs');

  const gradient = document.createElementNS(SVG_NS, 'linearGradient');
  gradient.setAttribute('id', `${uid}-fill`);
  gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
  gradient.setAttribute('x1', '250');
  gradient.setAttribute('y1', '28');
  gradient.setAttribute('x2', '250');
  gradient.setAttribute('y2', '78');
  for (const [offset, color] of TITLE_GRADIENT) {
    const stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', offset);
    stop.setAttribute('stop-color', color);
    gradient.appendChild(stop);
  }

  const arc = document.createElementNS(SVG_NS, 'path');
  arc.setAttribute('id', `${uid}-arc`);
  arc.setAttribute('d', 'M 22, 82 C 120, 28 380, 28 478, 82');
  arc.setAttribute('fill', 'none');

  defs.append(gradient, arc);

  const shadowText = document.createElementNS(SVG_NS, 'text');
  shadowText.setAttribute('transform', 'translate(2.5, 3.5)');
  applyTitleFont(shadowText);
  shadowText.setAttribute('fill', TITLE_SHADOW);
  shadowText.appendChild(createTitleTextPath(`${uid}-arc`, 'Certificate of Authenticity'));

  const text = document.createElementNS(SVG_NS, 'text');
  applyTitleFont(text);
  text.setAttribute('stroke', TITLE_STROKE);
  text.setAttribute('stroke-width', '5');
  text.setAttribute('paint-order', 'stroke fill');
  const textPath = createTitleTextPath(`${uid}-arc`, 'Certificate of Authenticity');
  textPath.setAttribute('fill', `url(#${uid}-fill)`);
  text.appendChild(textPath);

  svg.append(defs, shadowText, text);

  const sr = document.createElement('h2');
  sr.className = 'certificate-title-sr';
  sr.textContent = 'Certificate of Authenticity';

  wrap.append(svg, sr);
  return wrap;
}

export function renderCertificate(container, data) {
  container.replaceChildren();

  const article = document.createElement('article');
  article.className = 'certificate-card';
  article.dataset.speciesTheme = data.speciesTheme;

  const frame = document.createElement('div');
  frame.className = 'certificate-frame';

  const inner = document.createElement('div');
  inner.className = 'certificate-inner';

  const title = createArcTitle();

  const artSpace = document.createElement('div');
  artSpace.className = 'certificate-art-space';

  const brandMark = document.createElement('p');
  brandMark.className = 'certificate-brand-mark';
  brandMark.setAttribute('aria-hidden', 'true');
  brandMark.textContent = 'GB-Link';

  artSpace.append(brandMark);
  const artReady = mountSpeciesArt(artSpace, data);

  const idLine = document.createElement('p');
  idLine.className = 'certificate-id-line';

  const idPrefix = document.createElement('span');
  idPrefix.className = 'certificate-id-prefix';
  idPrefix.textContent = 'Your ';

  const speciesSpan = document.createElement('span');
  speciesSpan.className = 'certificate-id-species';
  speciesSpan.textContent = formatSpeciesName(data.species);

  const idMid = document.createElement('span');
  idMid.className = 'certificate-id-mid';
  idMid.textContent = ' I.D. Number ';

  const idValue = document.createElement('span');
  idValue.className = 'certificate-id-value';
  idValue.textContent = formatCertificateTrainerId(data.trainerId);

  idLine.append(idPrefix, speciesSpan, idMid, idValue);

  const meta = document.createElement('p');
  meta.className = 'certificate-meta';
  meta.append(
    document.createTextNode(`OT ${data.otName} · ${data.eventLabel} · GB-Link — `),
  );
  const siteLink = document.createElement('a');
  siteLink.className = 'certificate-meta-link';
  siteLink.href = 'https://gblink.io';
  siteLink.textContent = 'gblink.io';
  siteLink.target = '_blank';
  siteLink.rel = 'noopener noreferrer';
  meta.append(siteLink);

  inner.append(title, artSpace, idLine, meta);
  frame.append(inner);
  article.append(frame);

  const actions = document.createElement('div');
  actions.className = 'certificate-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'certificate-save-btn secondary';
  saveBtn.textContent = 'Download image';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const label = saveBtn.textContent;
    saveBtn.textContent = 'Downloading…';
    try {
      await artReady;
      await saveCertificateImage(frame, data);
    } catch (err) {
      saveBtn.textContent = 'Download failed — retry';
      saveBtn.disabled = false;
      return;
    }
    saveBtn.disabled = false;
    saveBtn.textContent = label;
  });

  actions.append(saveBtn);
  container.append(article, actions);
}
