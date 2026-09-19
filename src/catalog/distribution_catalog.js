import mewSprite from '../assets/sprites/mew.png';
import pikachuSprite from '../assets/sprites/pikachu.png';
import celebiSprite from '../assets/sprites/celebi.png';

export const DISTRIBUTION_LINES = [
  {
    id: 'gen1-mew',
    generation: 1,
    species: 'MEW',
    label: 'Mew',
    hint: 'Gen 1 · Red / Blue / Yellow',
    theme: 'mew',
    sprite: mewSprite,
  },
  {
    id: 'gen1-surfing-pikachu',
    generation: 1,
    species: 'PIKACHU',
    label: 'Surfing Pikachu',
    hint: 'Gen 1 · Red / Blue / Yellow',
    theme: 'pikachu',
    sprite: pikachuSprite,
  },
  {
    id: 'gen2-celebi',
    generation: 2,
    species: 'CELEBI',
    label: 'Celebi',
    hint: 'Gen 2 · Gold / Silver / Crystal',
    theme: 'celebi',
    sprite: celebiSprite,
  },
];

export function getDistributionLine(id) {
  return DISTRIBUTION_LINES.find((line) => line.id === id);
}
