# GB Link Distributor

Trade any Pokémon from your party for a historical event Pokémon on a real Game Boy (Pokémon Red, Blue, Yellow, Gold, Silver, or Crystal), over a link cable and a [GB Link USB adapter](https://gblink.io).

Nothing is injected into your save file — the event Pokémon arrives through a normal in-game trade at the Cable Club.

**Live demo:** [distribution.gblink.io](https://distribution.gblink.io)

## Requirements

- Chrome or Edge (WebUSB), or Firefox 151+ (WebSerial)
- [GB Link USB adapter](https://gblink.io)
- Game Boy link cable
- Pokémon Red, Blue, Yellow, Gold, Silver, or Crystal cartridge

## Run

```bash
npm install
npm run dev
```

Open the HTTPS URL Vite prints (e.g. `https://localhost:5173`), pick an event, click **Connect Game Boy**, then on the handheld: enter **Cable Club** and talk to the clerk — the trade room loads automatically.

## Adding events

1. Add `src/events/<region>/my_event.js` (copy an existing event file and edit fields).
2. Add its path to `src/events/manifest.json` (order in the list is the dropdown order).
3. Run `npm run events:sync` or restart the dev server — events are bundled into `registry.js` automatically on build/dev start.

Stat encoding, IV packing, and trade packet layout are handled automatically.

## TODO

- Surfing Pikachu (Gen 1)
- Localized game support (including Japanese versions)
- Gen 3 Pokémon event distributions

## Credits

- [risingPhil/PokeMe64](https://github.com/risingPhil/PokeMe64) — reference data for historical distribution event Pokémon
- [GrenderG/mewdistro](https://github.com/GrenderG/mewdistro) — Gen 1 party block layout and Mew distribution trade flow
- [GrenderG/celebidistro](https://github.com/GrenderG/celebidistro) — Gen 2 Celebi distribution trade flow and party data layout
- [Lorenzooone/PokemonGB_Online_Trades](https://github.com/Lorenzooone/PokemonGB_Online_Trades) — Cable Club link protocol and automated Trade Center entry
