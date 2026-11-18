# Harrowfield: credits

**Harrowfield** is a round-based zombie survival game by **Blendi Bylygbashi**, made for Patch. Game code is MIT (see LICENSE). The game's art and sound include third-party material that is licensed for use inside this game only (Adobe Mixamo, Sonniss), so the game as a whole is not under an open art licence.

## Code and libraries bundled in this build

| Library | Version | Licence | Text |
| --- | --- | --- | --- |
| three.js | 0.186.1 | MIT | licenses/three.js-MIT.txt |
| Rapier (@dimforge/rapier3d-compat) | 0.21.0 | Apache-2.0 | licenses/rapier-Apache-2.0.txt |
| postprocessing (pmndrs) | 6.39.5 | Zlib | licenses/postprocessing-Zlib.txt |
| navcat | 0.4.1 | MIT | licenses/navcat-MIT.txt |
| mathcat | 0.0.12 | MIT | licenses/mathcat-MIT.txt |
| meshoptimizer decoder (the copy inside three.js) | as in three.js 0.186.1 | MIT | licenses/meshoptimizer-MIT.txt |

The navmesh was baked with navcat at build time. Every baked prop was simplified at build time with **meshoptimizer** 1.0.1 by Arseny Kapoulkine (MIT, licenses/meshoptimizer-MIT.txt); its simplifier isn't in the game, only the decoder above.

## First-person arms and weapons (CC BY 4.0)

All by **DJMaesen (bumstrum)**, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Changes:

- Converted to GLB, textures resized to 1024 px WebP, and meshes compressed with meshopt.
- Each single animation timeline split into named clips, with motion added in code on top (sway, bob, recoil, aiming, sprint and swap poses).
- The carbine's root scale corrected, and overlapping detail faces moved 1.5 mm apart to stop flicker.
- Materials converted to the game's shaders, and framing and sights set per gun. A dark glass disc covers the sniper scope's painted lens.
- The revolver recoloured for the Stormjar, with an added glass jar in copper collars.
- The guns without the arms are also shown as the wall displays and in the Hope Chest.

- Porchlight: "fps pistol Animated" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/fps-pistol-animated-a8cdd6c2e936484aaf67e1786c8320d9
- Sawback: "sawnoff animated" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/sawnoff-animated-806f8327bed34fc3b0e3911d01f0566d
- Hornet: "fps animated smg" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/fps-animated-smg-ea3dad7478624495a5a46f40127b0579
- Harvester: "fps AK animated" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/fps-ak-animated-b0b1bae40337449189483f6187cf7af7
- Thresher: "shotgun animated" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/shotgun-animated-226237e0f49c4f69a9fc5a78df6a236c
- Mule: "animated pistol" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/animated-pistol-30d1b612b2334a8294b02692b8c10cf1
- Drifter and Stormjar: "revolver animated" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/revolver-animated-a34b6d0ddc774744bc3567d6afc0878f
- Fieldhand: "fps animated carbine" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/fps-animated-carbine-62977bb4c53047a185b9f3a0cdf56b87
- Scarecrow: "sniper animated" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/sniper-animated-b48999a250b2433da59f705c371a49b2
- Baler: "lmg animated" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/lmg-animated-c02dc6663f344008a502148e751c9974
- Knife: "knife animated" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/knife-animated-e5db6b73878f4123baa48cea6d9af84c
- Grenade throw: "Arms throwing" by DJMaesen (bumstrum), CC BY 4.0, https://sketchfab.com/3d-models/arms-throwing-1f9a5c717aae4d0f9b77232b7da4b875

## Zombies

- Characters from **Adobe Mixamo**: Yaku J Ignite, Zombiegirl W Kurniawan, Copzombie L Actisdato, Parasite L Starkie and Prisoner B Styperek.
- Animations from **Adobe Mixamo** (Scary Zombie Pack, Not So Scary Zombie Pack, Pro Rifle Pack, Shooter Pack), baked onto one rig in Blender.
- Mixamo characters and animations are licensed by Adobe for use in games. They are included here only as part of the game, converted and compressed; the raw Mixamo files are not distributed.

## Harrow Farm: the look

The farm you see (yard, barn and hayloft, coop, windmill, cornfield edge, pumpkin patch, road and every room of the house) was made for this game. All of the generated images and models below are original and were generated under the services' commercial terms.

- **Buildings, rooms and light:** built in Blender from the game's own layout by script, lit and baked with Cycles.
- **Props, about 400 models:** furniture, the dolls in the attic, the pumpkins, the coop and barn gear, the roadside junk and the rest. Each began as an image of the prop made with **GPT Image 2.5** (OpenAI) through fal.ai and was made 3D with **Meshy 7.1** image-to-3D through fal.ai. They were then cleaned up and baked down in Blender and simplified with meshoptimizer. A few are variants of those made in code or Blender (longer rugs and runners, taller tables, retinted leaves, the broom), and the knitted vines were built in Blender on the seated pumpkins.
- **Wallpapers, boards, panelling, plaster, shingles, stone, fabric, lace, the pumpkin vines' knit, the grass, weeds, litter, feathers and chimney smoke:** images generated with **GPT Image 2.5** through fal.ai, then made tileable, cut out or painted over in code.
- **The sky, the moon and the far corn cards:** generated with **GPT Image 2.5** through fal.ai, upscaled 4x with **ESRGAN** through fal.ai, and graded in code.
- **The woman in the corn:** a generated front view (GPT Image 2.5) made 3D with Meshy 7.1 through fal.ai, then rigged and animated in Blender, with her porcelain hands and bonnet lining textured in code.
- **The windmill:** tower and pump house built in Blender with the textures above, the sails from GPT Image 2.5 canvases, and the rooster vane made with GPT Image 2.5 and Meshy 7.1 through fal.ai. **The cuckoo clock** was made the same way as the rooster.
- **Made in code:** the corn stalks and their texture, the flames and coals, the grandfather clock, the wall clock faces, the small papered door, the chicken wire and the gates.

## Harrow Farm: earlier assets still in the build

These still ship in the game: the plain map under the new farm (it casts the moon's shadow on the dead), the buyable doors and debris, the breaker box, the tonic cabinets and some set pieces.

- Map geometry, lighting and baked ambient occlusion: built in Blender from the game's own layout script.
- Textures from **Poly Haven** (polyhaven.com), CC0 1.0: Old Wooden Floor 01 (Charlotte Baglioni, Dario Barresi), Decrepit Wallpaper (Rob Tuytel), Peeling Painted Wall (Dimitrios Savva), Weathered Plank Siding (Dimitrios Savva), Weathered Planks (Dario Barresi, Dimitrios Savva), Worn Planks (Dimitrios Savva), Red Brick (Rob Tuytel), Damaged Plaster (Amal Kumar), Forest Floor (eye-candy.xyz), Grey Roof Tiles (Rob Tuytel), Concrete Floor Damaged 01 (Rob Tuytel), Rusty Metal 02 (Rob Tuytel), Dirty Carpet (Rohit Seervi).
- Props from **Poly Haven**, CC0 1.0: Old Bed Frame (Luca B), Wooden Table 01 (Ethan Place), Painted Wooden Cabinet (Kirill Sannikov), Wooden Bookshelf Worn (Ulan Cabanilla), Portable Generator (James Ray Cock), Power Box 01 (Rico Cilliers, Yann Kervran), Wooden Crate 01 (James Ray Cock), Old Military Crate (Jack Mava), Ammo Box (DanKit), Barrel 01 (Jorge Camacho), Vintage Oil Lamp (Monsta3D), Hanging Industrial Lamp (Kuutti Siitonen), Television 01 (Gabriel Radić), Metal Trash Can (GurJas Studios), Wooden Ladder (Miroslav Turura), Painted Wooden Table (Kirill Sannikov), Sofa 01 (Kirill Sannikov), Drawer Cabinet (Ulan Cabanilla), Utility Box 01 (James Ray Cock), Wooden Military Crate (Prabhjinder Singh).
- More props from **Poly Haven**, CC0 1.0 (1.3.0 set dressing): Brass Pan 01 (Rico Cilliers), Pot Enamel 01 (Kuutti Siitonen), Metal Jug (Anzor Lezhava), Wooden Bowl 01 (Oliver Harries), Mantel Clock 01 (Yann Kervran, Rico Cilliers), Wall Clock (PierreB3D), Lantern 01 (Rajil Jose Macatangay), Wicker Basket 01 (Kuutti Siitonen), Wooden Bucket 01 (James Ray Cock), Rockingchair 01 (Jorge Camacho). Some were simplified with meshoptimizer.
- The wallpapers, painted floorboards, wainscot, tin roofing, rag rugs, quilt, oilcloth, linen, felt, knit and canvas textures, the three paintings, the dried herbs and the painted sky backdrop: original images generated for this game with **Nano Banana Pro** through fal.ai, then made tileable and painted over in code. The kitchen stove and plate-rack dresser: our own concept images (Nano Banana Pro) made 3D with **Meshy 7.1** through fal.ai. Generated under the services' commercial terms.
- The zombies' knitwear, overalls and putty skin are painted over the Mixamo textures on this machine with code only (no AI service sees the Mixamo files), using the generated knit and canvas textures above.
- The four tonic cabinets: original designs generated for this game with **Nano Banana Pro** (concept images) and **Meshy 7.1** image-to-3D through fal.ai, then cleaned up in Blender. Generated under the services' commercial terms.
- The Hope Chest, the jack-in-the-box, boards, doors, signs, power-up icons, particles and decals are made in code.

## Sound and music

- Sound effects generated through fal.ai with **ElevenLabs Sound Effects v2**, **Mirelo SFX 2.0** and **Sonilo v1.1**, then trimmed, looped and loudness-normalised for the game. Generated under each service's commercial terms (ElevenLabs: no reselling as a competing sound pack; Sonilo output carries an inaudible watermark).
- Music bed and tension layer: **Stable Audio 3 Medium** (Stability AI) through fal.ai. Tonic jingles: Stable Audio 3 Medium and **ACE-Step** (Apache-2.0 weights) through fal.ai.
- Choir (the late-act dread layer): a recording from the **Sonniss GDC Game Audio Bundle**, Certified Audio "Ambient Soundscapes" (Church Choir_Dm), shifted and frozen into a held chord for this game.
- The music box (the Harrow lullaby), the wind chime, the hall clock and the wind through the windows are synthesised in code.
- Announcer: **ElevenLabs Eleven v4** text-to-speech through fal.ai, library voice "Adam", with a radio filter.
- Recorded gun, explosion and impact layers from the **Sonniss GDC Game Audio Bundle** (royalty-free licence, https://sonniss.com/gdc-bundle-license/): Fascinated Sound "The Gun Locker", Olivier Girardot "Guns & Explosions", Gamemaster Audio "Guns, Bullets and Explosions", the house's cooling ticks from Gibson and Ansell "Got Wood", the house's floorboards, doors and window glass from Coll Anderson "House Library Add Ons", the late-night creaks from SoundBits "Unsettling Creaks and Squeaks", the wind from Coll Anderson "Gentle Wind", the crickets from Discover Oregon "Wilderness Crickets", the choir from Certified Audio "Ambient Soundscapes", and the bullet hits on the dead from Timothy McHugh "Gorification [HD]", Coll Anderson "Gore", Soundopolis "Gore Toolkit HD", PMSFX "Lethal Blow", The Chris Alan "Hand-to-Hand Combat" and Shapeforms "Hit & Punch". Cut and processed for this game; not offered as separate sounds, and excluded from any open licence.
- Pistol recordings, CC0 1.0, from Freesound: "Single Pistol Gunshot 3" by morganpurkis (https://freesound.org/people/morganpurkis/sounds/385811/) and "Small pistol gunshot indoors" by acidsnowflake (https://freesound.org/people/acidsnowflake/sounds/402789/).
- The music box (the Harrow lullaby), the wind through the windows and the UI ticks are synthesised in code.
- UI clicks, confirm and error sounds, plank and punch impacts: **Kenney** (kenney.nl) Interface Sounds and Impact Sounds, CC0 1.0.

## Fonts

- **IM Fell English** and **IM Fell English SC** by Igino Marini, SIL Open Font License 1.1 (licenses/IMFellEnglish-OFL.txt), from the Google Fonts repository, subset to Latin and converted to WOFF2.
- Elsewhere the game uses the system's Georgia and system UI fonts.

Made by Blendi Bylygbashi for Patch.
