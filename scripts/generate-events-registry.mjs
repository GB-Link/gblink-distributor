import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export async function generateEventsRegistry(root = path.resolve(import.meta.dirname, '..')) {
  const eventsDir = path.join(root, 'src/events');
  const manifestPath = path.join(eventsDir, 'manifest.json');
  const outPath = path.join(eventsDir, 'registry.js');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const events = [];
  for (const rel of manifest) {
    const file = path.join(eventsDir, rel);
    if (!fs.existsSync(file)) {
      throw new Error(`Event file missing: ${rel}`);
    }
    const mod = await import(`${pathToFileURL(file).href}?registry=${Date.now()}`);
    events.push(mod.default);
  }

  fs.writeFileSync(outPath, `export const ALL_EVENTS = ${JSON.stringify(events, null, 2)};\n`);
  return outPath;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  generateEventsRegistry().then((out) => {
    console.log(`Wrote ${out}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
