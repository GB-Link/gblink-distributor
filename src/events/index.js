import { ALL_EVENTS } from './registry.js';

export function getEventsForGeneration(generation) {
  return ALL_EVENTS.filter((e) => (e.generation ?? 1) === generation);
}

export function getEventsForLine(line) {
  if (!line) return [];
  return ALL_EVENTS.filter((e) => {
    const gen = e.generation ?? 1;
    if (gen !== line.generation) return false;
    if (line.species) return e.species === line.species;
    return true;
  });
}

export function getEventById(id) {
  return ALL_EVENTS.find((e) => e.id === id) ?? ALL_EVENTS[0];
}
