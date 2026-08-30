# Routeforge

A browser-based Mythic+ dungeon route planner. Plan pulls, draw routes, drop
cooldown markers, and move routes to and from the game as strings — on a second
monitor beside WoW in windowed mode, or on your phone.

Routes interoperate with [Mythic Dungeon Tools][mdt] (MDT): paste a route
exported from the addon and it renders here; export from here and the addon
reads it back.

[mdt]: https://github.com/Nnoggie/MythicDungeonTools

## What it does

- **All 16 dungeons** of the two seasons MDT currently ships, with the real map
  tiles, every spawn, patrol paths and pack groupings.
- **Pull editing** — click a pack to add it to a pull (alt-click for a single
  mob), reorder pulls, and see per-pull and cumulative enemy forces as
  percentages of what the key requires.
- **Pull outlines** — a convex hull around each pull, numbered at its centroid.
- **Drawing** — freehand, lines, arrows, text notes and an eraser, with undo.
- **Route markers** — Bloodlust, Heroism, Combat Res, Shroud, Sap and the eight
  raid marks.
- **Enemy inspection** — abilities with icons and descriptions, flagged the way
  MDT flags them: interruptible, magic, enrage, bleed, poison, curse, disease.
- **Import / export** to MDT route strings, and a local route library.

## Running it

The generated game data and art under `public/` are committed, so a clone runs
without World of Warcraft installed:

```bash
npm install
npm run dev
```

## Refreshing the data

`npm run data` rebuilds `public/` from a local WoW install with the Mythic
Dungeon Tools addon. Re-run it after an MDT update to pick up new dungeons or
rebalanced enemy forces.

```bash
npm run data
```

It runs these steps:

- `tools/extract.mjs` executes MDT's Lua dungeon files in a WASM Lua VM, writes
  `public/data/`, and copies the addon's map tiles.
- `tools/portraits.mjs` and `tools/marker-icons.mjs` fetch creature portraits
  and route-marker icons.
- `tools/spells.mjs` fetches spell names, icons and descriptions.

If WoW lives somewhere non-standard, point at it:

```bash
MDT_PATH="/path/to/_retail_/Interface/AddOns/MythicDungeonTools" npm run data
```

If `public/data/` is missing, the app renders setup instructions instead of
failing the build, so a data-less deploy is obvious rather than cryptic.

> The tile copy step assumes MDT's current layout
> (`Midnight/Textures/<Dungeon>/`). See `tools/extract.mjs` if that moves.

## Tests

```bash
npm test
```

Covers the MDT string codec, the route model round-trip, undo/redo, the hull
geometry, and a check that every enemy and clone index matches Lua's own view
of the data. It also asserts byte-level fidelity against a real in-game export
kept at `tools/fixtures/real-route.txt`.

## How the interop works

MDT route strings are `!~MDT2~` + Base64(Deflate(CBOR(preset))). Three details
matter and are easy to get wrong:

1. Blizzard encodes Lua strings as CBOR **byte strings** (major type 2), not
   text strings — Lua strings are byte arrays, not guaranteed UTF-8.
2. `cbor-x` must be constructed with `tagUint8Array: false`, or it tags every
   byte string with CBOR tag 64, which the game never emits.
3. Pull tables mix integer enemy keys with a string `"color"` key, so they must
   stay CBOR maps. Flattening them to objects stringifies the indices and the
   addon drops every pull.

Deflate is not canonical, so our compressed bytes differ from the game's while
the CBOR payload underneath is byte-identical. Unmodelled preset fields are
carried through untouched, so re-exporting an imported route loses nothing.

## Sharing routes (optional)

Without a database the app runs entirely locally and every sharing endpoint
returns 503 with an explanation — nothing else is affected.

To turn sharing on, point `DATABASE_URL` at a Postgres database (Neon works
well on serverless) and create the schema:

```bash
echo 'DATABASE_URL="postgresql://…"' >> .env.local
npm run db:setup
```

Set the same variable on your host. Then **Share** publishes the route and
returns a short link like `/r/x7k2p9`.

How it works:

- The stored payload is the same `!~MDT2~` string the game uses, so shared
  routes go through the codec the tests already cover.
- Creating a link also issues an **edit token**, kept in the creator's browser.
  Pressing *Update link* rewrites the route at the same URL; anyone else with
  the link can only read it. The token is matched in the `WHERE` clause, so a
  wrong token updates nothing.
- Anonymous writes are rate-limited per IP in Postgres (serverless instances
  share no memory) and payloads are capped. The limiter fails open, so a
  database hiccup never blocks a legitimate save.

## Deploying

`public/` is committed, so any static-friendly host builds this as-is — there
is no build-time dependency on a game install.

## Licence

GPL-2.0-or-later, because it builds on MDT's GPL-2.0 dungeon data. See
[LICENSE](LICENSE).

Unofficial, non-commercial fan project — not affiliated with Blizzard
Entertainment or the MDT authors. Game art under `public/` belongs to
Blizzard Entertainment and is included only so the app can be built and
hosted.
