# Credits

## Car models

The three cars are third-party models, licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). They were modified for the game: split into crash parts (doors, bonnet, boot, bumpers, glass, lights, mirrors), hinge pivots, wheels rebuilt, materials renamed and repainted, badges removed, textures resized and converted to WebP, and given a crash physics setup. The original files are in `art/sources/`.

| In the game | Model | Author | Source |
| --- | --- | --- | --- |
| Rally saloon | Thunderbolt '96 - Low Poly Model | Daniel Zhabotinsky | [Sketchfab](https://sketchfab.com/3d-models/thunderbolt-96-low-poly-model-25a4ff2002834ec1b4441c57ecd7ca9f) |
| Off-roader | Bokaroo '67 - Low poly model | Daniel Zhabotinsky | [Sketchfab](https://sketchfab.com/3d-models/bokaroo-67-low-poly-model-22015d1863d6455aa31cfd738b972c50) |
| Supercar | Fictional supercar - V12 Goblin | ollitei | [Sketchfab](https://sketchfab.com/3d-models/fictional-supercar-v12-goblin-0a20e49ad5774d778567cb5c3f345786) |

## Aircraft models

| In the game | Model | Author | Source | Licence |
| --- | --- | --- | --- | --- |
| F-16 Fighting Falcon (flown) | General Dynamics F-16D Block 60 | Muhamad Mirza Arrafi (MirzaArrafiERV_45) | [Sketchfab](https://sketchfab.com/3d-models/general-dynamics-f-16d-block-60-ea8edb08d79e4eafa9c794c581f88cf3) | CC BY 4.0 |
| Cirrus SR22 (parked) | Cirrus SR22 | KOG_THORNS | [Sketchfab](https://sketchfab.com/3d-models/cirrus-sr22-cba602c99c524cd4b40e5c2e5f9c5b4f) | CC BY 4.0 (as uploaded) |
| (probable original) | Cirrus SR22 for FlightGear | Emmanuel Baranger (Helijah) | [FGMEMBERS/Cirrus-SR22](https://github.com/FGMEMBERS/Cirrus-SR22) | GPL v2 |

**F-16.** The upload is marked CC BY 4.0 and tagged by Sketchfab as generated with AI; a question in its comments about where it comes from had no answer. Modifications for the game: the external stores (missiles, tanks, pylons) removed, oriented and scaled to the real aircraft (15.06 m long) with the origin at the centre of gravity, cut into parts that can break off (wings with their wingtip lights, the stabilators, fin, gear legs and wheels), the flaperons and rudder cut out along their hinge lines with hinge axes and the stabilators given a pivot, materials renamed, and compressed with meshopt. The source file is `art/sources/jet/f16d_block60.glb`, the Blender scene `art/blend/jet.blend`.

**SR22.** The Sketchfab upload is marked CC BY 4.0, but its texture carries the signature "BARANGER Emmanuel 2013": it is very probably a conversion of Emmanuel Baranger's SR22 for the FlightGear simulator, which is distributed under the GNU GPL v2. Credit for the 3D model and its texture goes to him. To respect both licences, the source file (`art/sources/plane/cirrus_sr22.glb`) and the modified Blender scene (`art/blend/plane.blend`) stay in this repository, and the modified model (`public/models/plane.glb`) is available under the GPL v2 as well.

Modifications for the game: oriented and scaled to the real aircraft (7.92 m long), cut into parts that can break off (wings, tailplane, fin, gear legs, propeller) with their hinge and bolt points, control surfaces (ailerons, flaps, elevator, rudder) cut out along their hinge lines and given hinge axes, the registration, the maker's logos and the signature line painted out of the texture, materials renamed, and compressed with meshopt.

Everything else (code, world, textures generated in code) is part of this project.
