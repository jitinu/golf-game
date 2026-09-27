# Pinecrest Golf

Pinecrest Golf is a deterministic browser golf game monorepo. The simulation and course format are platform-independent TypeScript packages; the Three.js client renders the course and replays recorded shots.

## Quick start

```sh
source ~/.nvm/nvm.sh
nvm use 24
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm build:course
pnpm dev
```

Open `http://localhost:5173/?autostart=1&preset=low` to start directly on Pinecrest.

## Scripts

- `pnpm dev` starts the Vite client.
- `pnpm build` builds `apps/web`.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` verify the workspace.
- `pnpm build:course` converts `courses/*/course.src.json` into runtime binaries.
- `node apps/web/scripts/fetch-assets.mjs` optionally downloads Poly Haven assets; procedural fallbacks are always available.

## Architecture

`packages/sim` owns deterministic physics and club launch conditions. `packages/course-format` loads heightfields and surface masks. `packages/protocol` defines the API wire types and validation. `tools/course-builder` authors Pinecrest binaries. `apps/web` contains focused render, course, animation, game, input, networking, UI, and debug modules.

## Adding a course

Create `courses/<id>/course.src.json` using the `CourseManifest` shape: heightfield dimensions and origin, three or more holes with `back`, `middle`, and `front` tees, cup positions, and feature polygons/splines. Run `pnpm build:course`; the generated `course.json`, `terrain.height.f32`, and `surface.u8` are written beneath `apps/web/public/courses/<id>/`. Add the course to `apps/web/public/courses/index.json`.

## Supabase

Set `VITE_API_URL` to the deployed edge-function URL for server-backed runs. Without it, scores use the course-specific local leaderboard in `localStorage`. Deploy the API with:

```sh
supabase db push
supabase functions deploy api --no-verify-jwt
supabase secrets set TURNSTILE_SECRET=...
```

The API supports optional Turnstile verification and rate limiting. Keep service-role credentials server-side.

## Graphics presets

| Preset | Pixel ratio | CSM | GTAO | Bloom | Grass | Water | HDRI |
| --- | ---: | ---: | --- | --- | ---: | ---: | --- |
| Low | 1.0 | 2 | off | off | 8,000 | 256 | 2k |
| Medium | 1.25 | 2 | on | on | 20,000 | 512 | 2k |
| High | 1.5 | 3 | on | on | 40,000 | 512 | 2k |
| Ultra | 1.5 | 3 | on | on | 60,000 | 1024 | 4k |

See [docs/asset-pipeline.md](docs/asset-pipeline.md) for character, animation, club, and texture production.
