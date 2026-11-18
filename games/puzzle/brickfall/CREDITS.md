# Brickfall credits

Brickfall is a first-person voxel demolition game made for Patch. It is built on
**three-voxel-destruction** by **Steven Bobyn** (MIT), from
https://github.com/sbobyn/three-voxel-destruction at commit 8c4b058. The voxel world, the GPU
physics use, destruction, structural collapse, rendering, smoke and dust, debris readback, device
tuning, sky and synthesised sounds are his work. Brickfall adds the game: three contracts, the
sledge, hand cannon and sticky charges, scoring and combos, propane tanks, spreading fire, the
replay camera, hit-stop and the rest of the game feel, materials with hardness and a readable load,
blast light, char and scorch, spatial sound, the screens, the sounds and the music.

## Code

| What | Author | License |
|---|---|---|
| three-voxel-destruction (the base of this game) | Steven Bobyn | MIT (`LICENSE`) |
| three-avbd 0.2.1 (GPU rigid bodies) | Steven Bobyn | MIT (`LICENSES/three-avbd-MIT.txt`) |
| three.js r186 | three.js authors | MIT (`LICENSES/three.js-MIT.txt`) |

## Art

| What | Source | License |
|---|---|---|
| Surface textures: brick_wall_005, concrete_wall_008, plastered_wall_02, damaged_plaster, asphalt_03 | Poly Haven (Dimitrios Savva, Dario Barresi, Charlotte Baglioni, Amal Kumar) | CC0 |
| Skies: Qwantani late afternoon and Qwantani sunset (puresky, 1k) | Poly Haven | CC0 |
| Fonts: Anton and Inter, through Fontsource | The Anton Project Authors, The Inter Project Authors | SIL OFL 1.1 (`LICENSES/`) |
| Levels, buildings and props | Built from voxels in code for this game | MIT |

## Sound

The cannon, explosions, impacts, sledge, glass, rubble, the debris of each material and the creaks and groans of a loaded structure are built from recordings in the **Sonniss GDC Game Audio
Bundle** (2016 to 2020), cut, layered and mastered for this game (`audio-build/build.mjs` in the source). **These
sounds are licensed for use in this game only. They are not covered by the game's MIT licence or by any open
licence, and may not be extracted or reused.**

| Sonniss library | Used for |
|---|---|
| Bluezone Corporation, Tank: Explosion Sound Effects (2020) | cannon shot, explosion, falling debris |
| Fascinated Sound, The Gun Locker SFX Pack (2016) | cannon shot (MK44 shot and report) |
| Lukas Tvrdon, Distant Blast (2018) | the cannon's report, explosion tails |
| Gamemaster Audio, Explosion Sound Pack (2017) | explosion |
| Gamemaster Audio, Guns, Bullets and Explosions (2018) | explosion |
| Stefano Cremona, Explosions (2020) | explosion |
| BlueZone, Heavy Metal Impact Sound Effects (2019) | propane tank burst, metal impacts |
| SoundBits, Just Impacts: Extension II (2017) | breech clack, metal impacts |
| 3maze, FINAL IMPACT (2019) and High Impact (2016) | sledge thud, breech clack |
| PMSFX, Shattering Bricks (2020) and Rocky Impacts (2020) | brick and concrete impacts |
| Soundrangers, Foley Elements: Rocks, Dirt and Stone (2018) | brick impacts, debris |
| Double Trouble Audio, Tools and Wood (2017) | wood impacts |
| BlueZone, Wood Sound Effects (2019) | wood impacts |
| Chris Skyes, Shards: Broken Glass (2017) | windows breaking |
| Airborne Sound, Elements: Glass (2019) | windows breaking |
| Mechanical Wave, Rock, Brick and Dirt, Part 02 (2017) | debris |
| Alexander Kopeikin, Rocks (2016) | debris tails |
| Mattia Cellotto, Rocks Momentum (2016) | collapse rubble, concrete, plaster and wood debris |
| Tatak Audio, Rocks and Debris (2020) | concrete and plaster debris, rubble sliding |
| Wav Junction Sound Effects, Rocks (2020) | plaster debris, masonry groans |
| Antisample, Rocks and Stones (2018) | plaster and wood debris |
| Gibson and Ansell, Got Wood (2018) | timber debris |
| Double Trouble Audio, Wood Impacts and Debris (2017) | timber debris |
| Airborne Sound, Elements: Metal (2019) | steel debris |
| Bluezone Corporation, Metal Debris (2018) | steel debris |
| Double Trouble Audio, Junk and Debris (2017) | steel debris |
| Pole Position, Car Debris, Impacts and Crashes (2017) | steel debris |
| Pole Position, Car Destruction (2020) | steel debris |
| Pole Position, The Junkyard Metal Library (2020) | steel creaking under load |
| Gregor Quendel, Designed Rocks (2018) | masonry groaning under load |

| Other sound | Source |
|---|---|
| Air horn and whistle | Generated for this game with ElevenLabs Sound Effects v2 on fal |
| Music bed ("demolition crew" groove, looped) | Generated for this game with Sonilo v1.1 text-to-music on fal |
| Synthesised layers (sub thumps, cracks, rumble, footsteps, glass tinkle, car alarm) | Brickfall and three-voxel-destruction's `audio.ts` (MIT) |

No assets from other games, no Mixamo, nothing non-commercial.

Added to Patch by Patch. The author of three-voxel-destruction can claim this listing.
