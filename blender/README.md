# Two-Bay Garage in Blender

`garage.blend` is a photoreal Blender model of the garage and all four makeover
plans. It opens in Blender 4.2 or newer; every texture is packed inside it.

## Seeing each plan

Each plan is a **view layer**. Pick it from the view-layer menu at the top right
of Blender's window:

| View layer | What's switched on |
| --- | --- |
| As photographed | White walls with the water-damaged spot, bare concrete, plywood built-ins, peg rail, fluorescent tubes, foam-wrapped column |
| Weekend refresh | Repose Gray walls with a Peppercorn band, sealed gray concrete, Iron Ore built-ins with clear totes and a butcher-block bench, LED shop lights, rope-wrapped column |
| Organized | Pure White walls, charcoal concrete, steel racks with a workbench and metal pegboard, Steadyrack bikes, sports slatwall, two ceiling racks, LED shop lights, yellow post guard |
| Showroom | Trusscore PVC walls, charcoal concrete, a steel cabinet wall, graphite slatwall bike wall, a drop zone by the house door, ceiling racks, hex lighting |

Every plan also has a **· cutaway** view layer. It hides the ceiling, the
garage-door wall and the house-door wall, for a dollhouse view from above.

To mix your own combination, use the collections under **Garage** in the
Outliner. Each option (walls, concrete, shelves, bike wall, house-door wall,
overhead racks, lighting, column) is its own collection. Tick the checkbox to
include or exclude it.

## Cameras and rendering

The **Cameras** collection has eye-level views from the garage doors, the back
wall, the bike wall, the house door, and toward the doors. It also has the
cutaway overview. To use one, select it and press `Ctrl+Numpad 0`, then render
with `F12`.

Rendering is set up for Cycles: path tracing with OpenImageDenoise, the AgX view
transform, and a slight vignette and lens fringe in the compositor. Lights are
real area lights sized to the fixtures. Daylight comes in through the window,
where the view outside is your own photo of the yard. On a GPU, raise the
samples in Render Properties for cleaner stills. The stills in `renders/` were
rendered on a 4-core CPU at 64 samples.

## Materials

All large surfaces use procedural shaders, so they stay sharp up close:

- The chip-flake floor has a glossy topcoat, with chip colors sampled from your photos.
- The walls have an orange-peel paint texture and grime near the floor.
- The foundation concrete is board-formed with pores and seams.
- Wood grain, galvanized spangle and a textured-plaster ceiling are procedural too.

The house door's magnet board and the pegboard tools are image textures in
`textures/`.

## Rebuilding

`build_garage.py` generates the whole file, so the layout can change in one
place. It uses the same measurements as the web model: 19′-0″ × 22′-0″, with a
97 in. ceiling measured on site.

```sh
pip install "bpy==4.5.*"
python3 blender/build_garage.py                                   # writes blender/garage.blend
python3 blender/build_garage.py --render renders --res 1600x900   # plus the stills
```

It also runs inside Blender: `blender --background --python blender/build_garage.py -- --render renders`.
