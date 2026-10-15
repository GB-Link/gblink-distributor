const spriteModules = import.meta.glob('./sprites/*.png', {
  eager: true,
  import: 'default',
});

const SPRITES_BY_SLUG = Object.fromEntries(
  Object.entries(spriteModules).map(([path, url]) => {
    const slug = path.match(/\/([^/]+)\.png$/)?.[1];
    return [slug, url];
  }),
);

export function pokeApiSlug(species) {
  return String(species ?? '')
    .trim()
    .toLowerCase()
    .replace(/♀/g, '-f')
    .replace(/♂/g, '-m')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function speciesSpriteUrl(species) {
  const slug = pokeApiSlug(species);
  if (!slug) return null;
  return SPRITES_BY_SLUG[slug] ?? null;
}
