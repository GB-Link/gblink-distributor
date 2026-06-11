import { toPng } from 'html-to-image';

function fixClonedSvgReferences(clonedRoot) {
  for (const svg of clonedRoot.querySelectorAll('svg')) {
    const remap = new Map();

    svg.querySelectorAll('[id]').forEach((el) => {
      const next = `${el.id}-export`;
      remap.set(el.id, next);
      el.id = next;
    });

    svg.querySelectorAll('*').forEach((el) => {
      for (const attr of el.getAttributeNames()) {
        const value = el.getAttribute(attr);
        if (!value) continue;

        if (attr === 'href' || attr.endsWith(':href')) {
          if (value.startsWith('#')) {
            const oldId = value.slice(1);
            if (remap.has(oldId)) {
              el.setAttribute(attr, `#${remap.get(oldId)}`);
            }
          }
          continue;
        }

        const match = value.match(/^url\(#([^)]+)\)$/);
        if (match && remap.has(match[1])) {
          el.setAttribute(attr, `url(#${remap.get(match[1])})`);
        }
      }
    });
  }
}

function certificateFilename(data) {
  const species = data.species.toLowerCase().replace(/_/g, '-');
  const tid = data.trainerId & 0xffff;
  return `gblink-certificate-${species}-${tid}.png`;
}

export async function saveCertificateImage(frameEl, data) {
  await document.fonts.ready;

  const filename = certificateFilename(data);

  const dataUrl = await toPng(frameEl, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    cacheBust: true,
    skipFonts: false,
    includeQueryParams: true,
    onclone: (_doc, clonedNode) => {
      fixClonedSvgReferences(clonedNode);
    },
  });

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
