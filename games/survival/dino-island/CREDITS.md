# dino island: credits

Everything in the game that wasn't written for it, with its maker, licence and what was changed. Licence texts are in
`LICENSES/`. The in-game credits screen (C) shows the same list.

## T-rexes

- **T-rex "olive"**: "Animated T-rex with 7 clips" by Patch, made with anymove (mesh and motion generated with AI),
  CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/). https://github.com/patch-gg/anymove
  (Patch asset library id `anymove:trex`). Used as it is; textures recompressed to 2048 px WebP, geometry meshopt.
- **T-rex variants brute, tiger, ghost, quill, ember, runt**: made by Patch for this game. Each started as a render of
  the olive T-rex, restyled by FLUX 3 (Black Forest Labs) and turned into a mesh by Tripo H3.1, both run on fal. Each
  was rigged with anymove's rig step (the olive T-rex's 25-bone skeleton placed in the mesh, anymove's
  `build_rig.py` for seams, automatic weights and limb paint) and given the olive T-rex's anymove clips, bone for
  bone. Dedicated CC0 1.0 like the rest of what Patch makes itself.
- **anymove** (https://github.com/patch-gg/anymove, Apache-2.0 code): the two-camera motion-capture method is
  @CanItCode's (https://www.youtube.com/watch?v=AS92HYsEBqo) and the MiniMax H3 LoRA step is @Graalitoo's idea
  (https://x.com/Graalitoo/status/2112548557576380659). No anymove code ships in the game.

## People

- **The explorer** (third-person body): made by Patch for this game from a render of anymove's woman, restyled by
  FLUX 3 and meshed by Tripo H3.1 on fal, rigged on her anymove skeleton and given her clips (idle, walk, run).
  CC0 1.0.
- **Woman in sportswear** (the explorer's skeleton and clips): "Animated woman in sportswear with 4 clips" by Patch,
  made with anymove (AI-generated), CC0 1.0 Universal. Patch asset library id `anymove:woman`.

## Vehicle

- **Tan off-road jeep**: asset_GywxXFB6Pb2npYADkRwTiqnb ("Tan off-road jeep", title by Patch) by Scenario
  (Scenario, https://huggingface.co/datasets/scenario-labs/3d-collection/blob/55b4c002b4c1529fc48da3dff98516c3069bfa3f/assets/scenario_asset_GywxXFB6Pb2npYADkRwTiqnb/output.glb),
  licensed Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/).
  AI-generated with Hitem3D Sparc3D 2.1 image-to-3D. Changed by Patch: textures resized to 2048 px, pivot moved to the
  bottom centre, credit and licence added to the file metadata, simplified LODs added. Changed for this game: the
  LOD2 mesh scaled to 4.2 m, turned to face forward, the four wheels cut out so they spin and steer, textures
  recompressed to WebP. Not affiliated with or endorsed by Scenario.

## The hands and rifle

- **First-person hands and carbine** (one mesh): made by Patch for this game. A studio picture by FLUX 3 (Black Forest
  Labs), turned into a textured mesh by Tripo H3.1, both run on fal (`tools/foliage.mjs`). Changed for this game:
  scaled and placed as the view model, its metal kept matte. CC0 1.0.

## Leaves and flowers

- **Palm, fern, tree-fern, banana, elephant-ear, canopy-leaf, vine, monstera, fan-palm and climbing-vine cutouts, the
  bromeliad, heliconia, bird's-nest fern, cordyline and wild grass**: made
  by Patch for this game. Each is a specimen photograph by FLUX 3 (Black Forest Labs) cut out with BiRefNet v2, both
  run on fal (`tools/foliage.mjs`), then cropped and colour-bled into WebP (`tools/foliage_textures.py`). The plants are
  built from them in code. CC0 1.0.
- **More species, leaf litter and ground cover** (philodendron, alocasia, maidenhair fern, calathea, dieffenbachia,
  croton, torch ginger, impatiens, moss cushion, epiphytic orchid; nine fallen leaves; creeper, herb, spikemoss and moss
  mats; seedlings and sedge): made by Patch for this game the same way (`tools/foliage.mjs`,
  `tools/foliage_textures.py`). CC0 1.0.

## Ground (Poly Haven, 4K scans)

All licensed CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/), downloaded at 4K from
polyhaven.com (`tools/polyhaven.mjs`). Changed for this game: the scan's AO baked into the colour, its displacement
packed into the normal map's alpha, recompressed to WebP (`tools/ground_ph.py`).

- **Mud Forest** by eye-candy.xyz, Poly Haven, https://polyhaven.com/a/mud_forest
- **Dry Decay Leaves** by Amal Kumar, Poly Haven, https://polyhaven.com/a/dry_decay_leaves
- **Forest Floor** by eye-candy.xyz, Poly Haven, https://polyhaven.com/a/forest_floor
- **Leaves Forest Ground** by Dario Barresi and Dimitrios Savva, Poly Haven, https://polyhaven.com/a/leaves_forest_ground
- **Rock Pitted Mossy** by Dimitrios Savva and Rico Cilliers, Poly Haven, https://polyhaven.com/a/rock_pitted_mossy
- **Tree Bark 03** by Rob Tuytel, Poly Haven, https://polyhaven.com/a/tree_bark_03
- **Japanese Zelkova Bark** by Charlotte Baglioni, Poly Haven, https://polyhaven.com/a/japanese_zelkova_bark

## Scanned roots, branches and stones (Poly Haven, from polyhaven.com)

All licensed CC0 1.0 Universal. Changed for this game: simplified with meshoptimizer, meshopt-compressed, textures
recompressed to 1024 px WebP (`tools/ph_props.sh`), recoloured and mossed over in the shader.

- **Root Cluster 02** by Jenelle van Heerden, https://polyhaven.com/a/root_cluster_02
- **Pine Roots** by Rob Tuytel, https://polyhaven.com/a/pine_roots
- **Single Root** by Jenelle van Heerden, https://polyhaven.com/a/single_root
- **Dead Quiver Branch 01** and **02** by Greg Zaal and Jenelle van Heerden, https://polyhaven.com/a/dead_quiver_branch_01
- **Stone 01** by Dario Barresi and Rico Cilliers, https://polyhaven.com/a/stone_01
- **Rock 07** and **Rock 09** by Jenelle van Heerden, https://polyhaven.com/a/rock_07
- **Namaqualand Stones 01** by Greg Zaal and Jenelle van Heerden, https://polyhaven.com/a/namaqualand_stones_01

## Plants, wood and rock (from Patch's asset library)

All licensed CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/). Changed by Patch's library:
packed into one GLB, pivot moved to the bottom centre, credit added to the file (and alpha maps restored, simplified
LODs added where it says so on the asset). Changed for this game: decimated in Blender (`tools/props.py`), the rock set
split into separate rocks, textures recompressed to 1024 px WebP, and moss grown on the logs and stump in the shader.

- **Fern 02** by Rob Tuytel and Rico Cilliers, Poly Haven, https://polyhaven.com/a/fern_02
- **Shrub Sorrel 01** by Rico Cilliers, Poly Haven, https://polyhaven.com/a/shrub_sorrel_01
- **Dead Tree Trunk 02** by Jenelle van Heerden and Rico Cilliers, Poly Haven, https://polyhaven.com/a/dead_tree_trunk_02
- **Tree Stump 01** by Rob Tuytel, Poly Haven, https://polyhaven.com/a/tree_stump_01
- **Rock Moss Set 01** by Kless Gyzen, Poly Haven, https://polyhaven.com/a/rock_moss_set_01
- **Rock Moss Set 02** by Kless Gyzen, Poly Haven, https://polyhaven.com/a/rock_moss_set_02
- **Namaqualand Boulder 03** (the outcrops' boulders; given moss and darker stone in the shader) by Jenelle van Heerden
  and Dario Barresi, Poly Haven, https://polyhaven.com/a/namaqualand_boulder_03
- **Root Cluster 01** by Jenelle van Heerden and Rico Cilliers, Poly Haven, https://polyhaven.com/a/root_cluster_01
- **Dry Branches Medium 01** by Rico Cilliers, Poly Haven, https://polyhaven.com/a/dry_branches_medium_01
- **Bark Debris 01** by Greg Zaal and Jenelle van Heerden, Poly Haven, https://polyhaven.com/a/bark_debris_01
- **Anthurium Botany 01** by Rob Tuytel and Rico Cilliers, Poly Haven, https://polyhaven.com/a/anthurium_botany_01
- **Shrub 03** by Rico Cilliers, Poly Haven, https://polyhaven.com/a/shrub_03
- **Grass Medium 02** by Rico Cilliers, Poly Haven, https://polyhaven.com/a/grass_medium_02
- **Tree Stump 02** by Rob Tuytel, Poly Haven, https://polyhaven.com/a/tree_stump_02

## Ground, bark and moss

All licensed CC0 1.0 Universal; 1K colour and normal maps.

- **Forest Ground 04** (the dirt tracks): "Forest Ground 04" by Rob Tuytel and Rico Cilliers (Poly Haven,
  https://polyhaven.com/a/forest_ground_04).
- **Forest Ground 01** (the grass): "Forest Ground 01" by Rob Tuytel (Poly Haven,
  https://polyhaven.com/a/forrest_ground_01).
- **Forest Leaves 02** (the leaf litter): by Rob Tuytel, Poly Haven, https://polyhaven.com/a/forest_leaves_02. From
  Patch's library (credit added to each file).
- **Bark Brown 02** (the canopy trees and fig roots): by Rob Tuytel, Poly Haven, https://polyhaven.com/a/bark_brown_02.
  From Patch's library.
- **Palm Tree Bark** (palms, tree ferns, banana stems): by Dimitrios Savva and Rico Cilliers, Poly Haven,
  https://polyhaven.com/a/palm_tree_bark. From Patch's library.
- **Moss 002** (moss on trunks, roots, logs and the forest floor): by ambientCG, https://ambientcg.com/a/Moss002. From
  Patch's library (maps selected from the zip, credit added to each file).
- **Roots** (roots in the earth under the trees): by Dario Barresi and Dimitrios Savva, Poly Haven,
  https://polyhaven.com/a/roots. From Patch's library.
- **Mossy Rock** (the outcrops and steep ground): by Rob Tuytel, Poly Haven, https://polyhaven.com/a/mossy_rock. From
  Patch's library.

Textures are shipped as WebP at 1024 px.

## Code

- **The game's code** was written for Patch by Christos (`christos-fal`) and blendi. MIT (`LICENSE` in the source).
- **three.js** r186 by mrdoob and the three.js authors, MIT (`LICENSES/MIT-three.js.txt`). Includes its Sky,
  Reflector, GLTFLoader, meshopt decoder, EffectComposer, UnrealBloomPass, SMAAPass, OutputPass, RoundedBoxGeometry
  and BufferGeometryUtils add-ons.
- **n8ao** 2.0.1 (ambient occlusion) by N8python, https://github.com/N8python/n8ao. Its package says ISC and its
  LICENSE file is CC0 1.0 (`LICENSES/n8ao-LICENSE.txt`).
- **postprocessing** 6.39.5 by Raoul van Rüschen (used by n8ao), Zlib (`LICENSES/Zlib-postprocessing.txt`).
- The island, the pool, the tree, palm, fern and plant shapes, the sea, the fog and light shafts, the effects and the
  game itself are made in code for this game.
