# Calamity Cove: credits

A third-person (or first-person: V) disaster survival game made for Patch. Code: MIT, Patch (see LICENSE).

## Code it builds on

| What | Author | License | Used for |
| --- | --- | --- | --- |
| folio-2025 (github.com/brunosimon/folio-2025, commit 41046b5) | Bruno Simon | MIT | The look: the island shading model (MeshDefaultMaterial: palette albedo, light colour, core-shadow terminator, tinted shadows, light bounce, waterline foam), the day/dusk/dawn/night presets, fog, bloom and depth-of-field settings, terrain and slab colours, grass (World/Grass.js), foliage blobs (World/Foliage.js), fallen leaves (World/Leaves.js); the tornado force law and funnel shape (Tornado.js, VisualTornado.js); fireballs and explosions. Rewritten for a walking game and WebGL 2. |
| three-stylized-water (github.com/norio/three-stylized-water), a port of Uber Stylized Water | norio; MatrixRex | MIT | The sea and the flood (src/water), with its foam, caustic and noise textures. Reflection simplified to the game's sky. |
| three.js 0.186.1 | three.js authors | MIT | Renderer (WebGPU with WebGL 2 fallback), TSL shaders, glTF loading |
| Rapier (@dimforge/rapier3d-compat 0.19.3) | Dimforge | Apache-2.0 | Physics: every building block, prop, flung person and the character controllers |

## Art

| What | Author | License | Notes |
| --- | --- | --- | --- |
| folio-2025 models and textures | Bruno Simon | MIT | The oak, birch and cherry trees, bushes, lanterns, pole lights, fences, benches, bricks and explosive crates (static/*.glb, packed into one GLB without textures), and palette.png, slabs.png and foliageSDF.png. Bruno Simon's name letters, career, projects, social, achievements and lab content are not used. |
| Town buildings | Patch | MIT (code), CC-BY-4.0 (art) | Modelled in headless Blender by assets-src/map/build_town2.py in folio's low-poly style: 1,567 bevelled, pre-fractured pieces (plus 259 more in the three set pieces) (window boxes, door hoods and shop signs included), each coloured from folio's palette and each its own physics block. Window glass is drawn separately so you can see through it, and it shatters. |
| Ground, streets, dock, fountain, lookout deck, sky, rain, tornado, meteors, fire, smoke | Patch | MIT (code) | Made in code (TSL shaders and particles), with folio's colours. |
| Blocky Characters 2.0 | Kenney (www.kenney.nl) | CC0 1.0 | The islanders and you (texture-player.png is texture-e recoloured to a yellow shirt and navy trousers by assets-src/make-player-skin.py). Animations from the pack; ragdolls are six Rapier bodies, one per part. |
| City Builder Bits 1.0 (cars, fire hydrant) | Kay Lousberg (www.kaylousberg.com) | CC0 1.0 | Packed into one GLB and rescaled to metres; shaded with folio's material. |
| Key frame used to calibrate the look | generated with Nano Banana Pro on fal.ai | not shipped | Reference only. |

## Asset ledger for the interiors (1.1.0)

| Asset | Source | License | Where |
| --- | --- | --- | --- |
| 49 furniture types (bed, table, chair, bookcase, books, pots, leafy plants, a tall plant, a fern, a small succulent, kitchen counter, stove, sofa, patterned rugs, floor and table lamps, paintings and frames, crate, barrel, plate, cup, bowl of fruit, vase, kettle, pew, altar, candle, desk, stool, shop goods, rowing boat, fireplace, armchair, side table, chest, long-case clock, wall shelf, cushion, folded curtains in four colours) | Patch, modelled in headless Blender (assets-src/map/furniture.py) from bevelled boxes (two-step rounded bevels with area-weighted normals), leaf cards and pleated panels in folio-2025's palette, with turned legs, panelling, mouldings, runners and tiles; wood grain, fabric, rug and leaf detail drawn by the game's shader (src/world/interiors.ts) | MIT (code), CC-BY-4.0 (art) | src/assets/map/furniture.glb; 595 placed items in blocks.json |
| Set pieces: fishing boat, construction lot with scaffold and tower crane, fairground wheel and stalls | Patch, modelled in headless Blender (assets-src/map/setpieces.py), breakable like the town | MIT (code), CC-BY-4.0 (art) | src/assets/map/town.glb (tagged by set) |
| Room lights (a light on every lamp and fireplace, pooling and falling off, with darker corners and warm light bounced off the floor), floorboards, wallpaper, wainscot, skirting, dado rails and cornices | Patch | MIT | src/look/env.ts (ROOMS, roomTerms, roomPattern), src/world/roomlights.ts, build_town2.py |
| Tornado wreckage swirl | Patch | MIT | src/vfx/vortex.ts |
| Gear: balloon and apple pickups | Patch, made in code | MIT | src/world/gear.ts |
| Flowers and rocks | Patch, made in code after folio-2025's World/Flowers.js (MIT) | MIT | src/world/scatter.ts |
| Chatter lines, badge names and awards | Patch | CC-BY-4.0 | src/actors/personality.ts, src/core/progress.ts |

No furniture comes from Kenney, Quaternius, Sketchfab or any other third party.

## Sound

- Kenney Impact Sounds, Interface Sounds and RPG Audio (www.kenney.nl), CC0 1.0: footsteps, debris impacts, cloth.
- Generated sound effects: ElevenLabs Sound Effects v2 and Mirelo SFX 2.0, via fal.ai.
- Announcer: ElevenLabs Eleven v4 text-to-speech (library voice "Brian"), via fal.ai, processed as an outdoor loudspeaker.
- Music: Stable Audio 3 Medium via fal.ai, cut into two bar-locked loops (calm and danger) that crossfade with the danger level.
- Siren, sad-trombone sting, brass stab, meteor whistle tone and sub-bass thumps: synthesised for this game.
- No sound comes from folio-2025 (its static/sounds are not used) or any commercial library.

## Thanks

Added to Patch by Patch. Inspired by the "survive the disaster" genre; no names, maps or assets from any other game.
