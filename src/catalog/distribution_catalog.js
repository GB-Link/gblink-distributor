import { speciesSpriteUrl } from '../assets/species_sprites.js';

export const DISTRIBUTION_LINES = [
  {
    id: 'gen1-mew',
    generation: 1,
    species: 'MEW',
    label: 'Mew',
    hint: 'Gen 1 · Red / Blue / Yellow',
    theme: 'mew',
    sprite: speciesSpriteUrl('MEW'),
  },
  {
    id: 'gen1-surfing-pikachu',
    generation: 1,
    species: 'PIKACHU',
    label: 'Surfing Pikachu',
    hint: 'Gen 1 · Red / Blue / Yellow',
    theme: 'pikachu',
    sprite: speciesSpriteUrl('PIKACHU'),
  },
  {
    id: 'gen2-celebi',
    generation: 2,
    species: 'CELEBI',
    label: 'Celebi',
    hint: 'Gen 2 · Gold / Silver / Crystal',
    theme: 'celebi',
    sprite: speciesSpriteUrl('CELEBI'),
  },
  {
    id: 'gen3-english',
    generation: 3,
    label: 'Gen 3',
    hint: 'Gen 3 · Ruby / Sapphire / Emerald / FireRed / LeafGreen',
    theme: 'gen3',
    sprite: null,
    mark: 'GBA',
  },
];

export function getDistributionLine(id) {
  return DISTRIBUTION_LINES.find((line) => line.id === id);
}
