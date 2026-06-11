export const DISTRIBUTION_LINES = [
  {
    id: 'gen1-mew',
    generation: 1,
    label: 'Mew',
    hint: 'Gen 1 · Red / Blue / Yellow',
    theme: 'mew',
  },
  {
    id: 'gen2-celebi',
    generation: 2,
    label: 'Celebi',
    hint: 'Gen 2 · Gold / Silver / Crystal',
    theme: 'celebi',
  },
];

export function getDistributionLine(id) {
  return DISTRIBUTION_LINES.find((line) => line.id === id);
}
