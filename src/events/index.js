import { ALL_EVENTS } from './registry.js';

export function getEventsForGeneration(generation) {
  return ALL_EVENTS.filter((e) => (e.generation ?? 1) === generation);
}

export function getEventById(id) {
  return ALL_EVENTS.find((e) => e.id === id) ?? ALL_EVENTS[0];
}
