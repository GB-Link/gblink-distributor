import path from 'path';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { generateEventsRegistry } from './scripts/generate-events-registry.mjs';

function eventsRegistryPlugin() {
  let root;
  let regenTimer;

  function scheduleRegen(server) {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(() => {
      regen(server).catch((err) => {
        console.error(err instanceof Error ? err.message : err);
      });
    }, 300);
  }

  async function regen(server) {
    await generateEventsRegistry(root);
    if (!server) return;
    const mod = server.moduleGraph.getModuleById(`${root}/src/events/registry.js`);
    if (mod) {
      server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: 'full-reload' });
    }
  }

  return {
    name: 'events-registry',
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      await generateEventsRegistry(root);
    },
    configureServer(server) {
      const onEventChange = (file) => {
        if (!file.includes(`${path.sep}src${path.sep}events${path.sep}`)) return;
        if (file.endsWith(`${path.sep}registry.js`)) return;
        scheduleRegen(server);
      };
      server.watcher.on('change', onEventChange);
      server.watcher.on('add', onEventChange);
      server.watcher.on('unlink', onEventChange);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [eventsRegistryPlugin(), basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
});
