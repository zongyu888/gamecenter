# Wyrdholm: credits

Made by Blendi for Patch. Game code MIT (see LICENSE). Art and sound are a mix of the third-party assets below and work generated in code; because Mixamo animation and Sonniss sound may only ship inside a game, the build's art licence is proprietary (LicenseRef-Proprietary).

## The settler (player character)

Made for this game: concept art generated with Nano Banana Pro and modelled with Meshy 7.1 (via fal), then re-rigged, re-weighted and retargeted in Blender. No third-party licence.

## Creatures (Sketchfab, CC BY 4.0, all modified)

| What | Title, author | Licence | Source | Changes |
| --- | --- | --- | --- | --- |
| Fallow doe | "Realistic Animated Doe 3D Model" by WildMesh 3D | CC BY 4.0 | https://sketchfab.com/3d-models/b6172618aa304473a4cf7b9246c0a218 | rescaled, clips selected and renamed, in-place locomotion, textures downscaled |
| Boar | "Animated Realistic Boar – 3D Animal Model" by AnimalMesh 3D | CC BY 4.0 | https://sketchfab.com/3d-models/f672a7fd93e84997b80a54ba30956111 | rescaled, clips selected and trimmed, textures downscaled |
| Moss troll | "Troll" by SJunior3d | CC BY 4.0 | https://sketchfab.com/3d-models/bceb1cb47186457c8571a23e6aff1b8e | rescaled, mace skinned to the hand, textures downscaled |
| Stormhorn (the boss) | "Realistic Animated Elk 3D Model" by WildMesh 3D | CC BY 4.0 | https://sketchfab.com/3d-models/787834f9caa2474d9f1814b807c072d7 | scaled up to boss size, clips selected, leap made in-place, textures downscaled |

Not affiliated with or endorsed by any of the authors above.

## Animation

Player animation: Mixamo (Adobe) motion clips, retargeted onto the settler in Blender with a world-space, rest-corrected retarget (tools/retarget_ws.py), used inside this game only. The sprint combines two clips' legs and arms; foot locking and ground IK run at runtime. The one-handed axe chop is hand-keyed for this game.

| What | Title, author | Licence | Source | Changes |
| --- | --- | --- | --- | --- |
| Pickaxe swing (mining) | "Miner" by Timsblends | CC BY 4.0 | https://sketchfab.com/3d-models/miner-d22a4eb8788d4af887061ce64746c8d9 | one swing of the mining loop retargeted onto the settler, upper body only, blended from and to the idle pose; the model itself is not used |

## Code libraries bundled in this build

| Library | Version | Licence | Source |
| --- | --- | --- | --- |
| three.js (incl. GLTFLoader, SkeletonUtils, BufferGeometryUtils, meshopt decoder) | 0.186.1 | MIT | github.com/mrdoob/three.js |
| Rapier (@dimforge/rapier3d-compat) | 0.21.0 | Apache-2.0 | github.com/dimforge/rapier.js |

## Generated in code

The island, terrain, ground textures, trees, grass, rocks, bushes, water, sky, weather, fire, building pieces, tools, the standing stones and the antler stone are generated procedurally at load time.

## Sound

- Other foley and impacts (jump and landing, rocks breaking, building, UI, item drops, tree falls): processed from the Sonniss GDC Game Audio Bundles (royalty-free, in-game use only; libraries listed in the night kit's `_sonniss/README.md`), Kenney audio packs (CC0) and generated takes.
- Ambience beds: wind, rain and shore beds, the fire crackle, creature voices (doe, boar, troll, the stag boss), thunder and small cues: generated with ElevenLabs Sound Effects v2 via fal, processed (trimmed, faded, loudness-normalised).
- Meadow, forest and night beds (rebuilt without insects): field recordings from the Sonniss GDC Game Audio Bundles (Raconteur Sound "Spring in the Pacific Northwest - Ambiences", Discover Oregon "Wind and Storms"; in-game use only) mixed with generated leaf rustle and songbirds (ElevenLabs Sound Effects v2 via fal), looped and loudness-normalised. The distant owl, bird-of-prey and raven calls: generated with ElevenLabs Sound Effects v2 and Mirelo SFX 2.0 via fal.
- Footsteps (grass, forest floor, stone, sand, wood), tree chops, the crack, creak and crash of a falling tree, log splitting and the rustle of a shaken crown: cut from field recordings on Freesound (freesound.org), single takes sliced, filtered and levelled for this game.
  - CC0 1.0 (public domain; listed with thanks): "Axe chopping wood" by xkeril; "Chopping a tree trunk with an Axe" by JesterWhoo; "Large Axe Chopping Small Log" by Hano_van_Dalen; "Hitting tree stump with Axe" by MioMeg; "single crack" by Bini_trns; "Tree creaks" by Sacha.Julien; "Deep creaky tree" by felix.blume; "Trunk Impact Ground" by Profispiesser; "Log Split" by Veridiansunrise; "SplittingWood" by MHockett; "Axe Hit Tree Leaves" by johnnydekk; "Forest_footsteps_6x" by Letterborne; "Hiking Boot Footsteps on Grass" and "Hiking Boot Footsteps on Stone" by Fission9; "Footsteps - Dirt, Grass" by SecureSubset; "Woodland Footsteps" by James.Keeble; "Foot steps on sand" by martinimeniscus; "Footsteps_Wood_Walk_Mono" by Nox_Sound.
  - CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/): "Tree Hit With Axe" by EminYILDIRIM (https://freesound.org/people/EminYILDIRIM/sounds/608343/), sliced into single chops and levelled.
- Flesh hits, pick on stone and blocking, rebuilt from real recordings only: Sonniss GDC Game Audio Bundle libraries (in-game use only): 3maze "ICE BLOCK", Gibson and Ansell "Got Wood", Coll Anderson "Gore", Wav Junction Sound Effects "Tools", Matt Script "You Me & Debris", InspectorJ "Wooden Fence Destruction", Double Trouble Audio "Tools and Wood" and "Wood Impacts and Debris", Soundrangers "Foley Elements Foliage", Gamemaster Audio "Punch Sound Pack", The Chris Alan "Hand-to-Hand Combat - Body Hits & Vocal Excursions", PMSFX "Lethal Blow", Shapeforms "Hit & Punch", Timothy McHugh "Gorification [HD]", Sound Spark LLC "Gore", Airborne Sound "Tools", The Sound Pack Tree "Construction & Tools", The AudioVille "Wooden Staffs and Sword Fight".
- Music (day, night, dawn, home and boss cues): composed for this game with Google Lyria 3.5 via fal from text prompts describing instruments and mood only (no other work or composer named), trimmed, faded, looped (boss) and loudness-normalised. The outputs carry Google's SynthID watermark.
- No sound in this game was taken from any other game.


## World textures and props (CC0)

The ground, bark and rock textures, the leaf and needle cards, and the rock, shrub, fern and stump props are made from these CC0 1.0 assets (public domain dedication: https://creativecommons.org/publicdomain/zero/1.0/). No attribution is required, but we list them with thanks. All of them were downscaled, recoloured, recomposed or decimated for this game.

- Poly Haven (polyhaven.com):
  - Forest Ground 01 (forrest_ground_01) by Rob Tuytel
  - Forest Leaves 02 (forest_leaves_02) by Rob Tuytel
  - Damp Sand (damp_sand) by eye-candy.xyz
  - Rock Face 03 (rock_face_03) by Dario Barresi and Rico Cilliers
  - Forest Ground 04 (forest_ground_04) by Rob Tuytel and Rico Cilliers
  - Mossy Rock (mossy_rock) by Rob Tuytel
  - Island Tree 02 (island_tree_02, leaf atlas) by Rob Tuytel and Rico Cilliers
  - Shrub 01, 03 and 04 (shrub_01, shrub_03, shrub_04) by Rico Cilliers
  - Fir Tree 01 (fir_tree_01, twig atlas) by Rob Tuytel and Rico Cilliers
  - Boulder 01 (boulder_01) by Rico Cilliers
  - Rock Moss Set 01 and 02 (rock_moss_set_01, rock_moss_set_02) by Kless Gyzen
  - Fern 02 (fern_02) by Rob Tuytel and Rico Cilliers
  - Tree Stump 01 (tree_stump_01) by Rob Tuytel
  - Trees (beech, fir, birch models built for this game): leaves from Island Tree 02 (island_tree_02) and Fir Tree 01 (fir_tree_01, twig atlas) by Rob Tuytel and Rico Cilliers, and Shrub 01 and 03 (shrub_01, shrub_03) by Rico Cilliers; bark from ambientCG Bark 002 and Bark 011
  - Grass card: Grass Medium 02 (grass_medium_02) by Rico Cilliers and Grass Medium 01 (grass_medium_01) by Rob Tuytel and Rico Cilliers
- ambientCG (ambientcg.com), by Lennart Demes:
  - Bark 002 (Bark002)
  - Bark 011 (Bark011)

- Building planks: "Planks Brown 10" by Rob Tuytel; thatch: "Thatch Roof Angled" by Rob Tuytel and Dimitrios Savva (Poly Haven, CC0), downscaled to 128 px.
- Fire and smoke sprites: Kenney Particle Pack (CC0).
