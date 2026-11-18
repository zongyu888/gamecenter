# Siege credits

Siege is a first-person voxel zombie defence game made for Patch. It is built on Brickfall's engine, which is
**three-voxel-destruction** by **Steven Bobyn** (MIT, https://github.com/sbobyn/three-voxel-destruction): the voxel
world, GPU rigid-body physics, destruction, structural collapse, rendering, smoke and dust, debris readback, device
tuning, sky and synthesised sounds are his work, extended for Brickfall. Siege adds the game: the town, the store
that remembers its shape (repairs and upgrades), the voxel zombies and their flow-field pathing through destructible
terrain, the voxel guns and tools, gore, traps, the economy and waves, the night, the screens.

## Code

| What | Author | License |
|---|---|---|
| three-voxel-destruction (the engine's base) | Steven Bobyn | MIT (`LICENSE`) |
| Brickfall and Siege game code | Patch | MIT (`LICENSE`) |
| three-avbd 0.2.1 (GPU rigid bodies) | Steven Bobyn | MIT (`LICENSES/three-avbd-MIT.txt`) |
| three.js r186 | three.js authors | MIT (`LICENSES/three.js-MIT.txt`) |

## Art

| What | Source | License |
|---|---|---|
| Surface textures: brick_wall_005, concrete_wall_008, plastered_wall_02, damaged_plaster, asphalt_03 | Poly Haven (Dimitrios Savva, Dario Barresi, Charlotte Baglioni, Amal Kumar) | CC0 |
| Sky: Qwantani sunset (puresky, 1k) | Poly Haven | CC0 |
| Fonts: Anton and Inter, through Fontsource | The Anton Project Authors, The Inter Project Authors | SIL OFL 1.1 (`LICENSES/`) |
| The town, the zombies, the guns, the hands and the tools | Built from voxels in code for this game | MIT |

No models are loaded: no Mixamo, no Sketchfab, no generated meshes.

## Sound

Destruction (explosions, impacts, debris of each material, creaks and groans) is Brickfall's set, built from
recordings in the **Sonniss GDC Game Audio Bundle** (2016 to 2020). The recorded gun layers, the hits on the dead
(flesh, bone, thuds), the wind and the crickets are Harrowfield's cuts from the same bundle. **These sounds are
licensed for use in this game only. They are not covered by the game's MIT licence or by any open licence, and may
not be extracted or reused.**

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

| Fascinated Sound, The Gun Locker (2016) | recorded layers under the SMG, rifle and shotgun |
| Olivier Girardot, Guns & Explosions (2018); Gamemaster Audio, Guns, Bullets and Explosions (2018) | explosion layer |
| Timothy McHugh, Gorification [HD] (2015); Coll Anderson, Gore (2015); Soundopolis, Gore Toolkit HD (2015); PMSFX, Lethal Blow (2020) | bullets into the dead (flesh) |
| The Chris Alan, Hand-to-Hand Combat (2018); Shapeforms, Hit & Punch (2020) | heavy hits and kills |
| Coll Anderson, Gentle Wind (2020); Discover Oregon, Wilderness Crickets (2018) | the night outside |

| Other sound | Source |
|---|---|
| Gunshots, reloads, pump and lever, shell tinks, zombie groans, growls, screams, deaths and rising, gibs, footsteps, boards placed and torn, the shop, round stings, the siren, the heartbeat | Generated for Patch (for Harrowfield) with ElevenLabs Sound Effects v2, Mirelo SFX 2.0 and Sonilo v1.1 on fal |
| Music bed (the tension layer) | Generated for Patch (for Harrowfield) with Stable Audio 3 Medium on fal |
| Pistol recordings | Freesound, CC0 1.0: "Single Pistol Gunshot 3" by morganpurkis (https://freesound.org/people/morganpurkis/sounds/385811/), "Small pistol gunshot indoors" by acidsnowflake (https://freesound.org/people/acidsnowflake/sounds/402789/) |
| Synthesised layers (sub thumps, cracks, rumble, glass tinkle, blips) | Brickfall and three-voxel-destruction's `audio.ts` (MIT) |

No assets from other games, nothing non-commercial.

Made for Patch. The author of three-voxel-destruction can claim the engine's credit.
