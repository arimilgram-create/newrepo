"""Garage planner: a "Garage" tab in the 3D viewport's sidebar (press N) for garage.blend.

It offers the same choices as the web planner: pick a plan, then change the walls, the
concrete, the shelves, the bike wall, the house-door wall, the overhead racks, the lighting
and the column, with the same paint and finish colors.

Each plan is a view layer, with a "· cutaway" twin that hides the ceiling and two walls. The
panel edits both at once. Colors live on the view layers as custom properties ("garage_wall",
"garage_band", ...), which the materials read through Attribute nodes, so every plan keeps its
own colors even with scripts turned off. The panel also sets the white balance for the plan's
lights when you switch plans.

build_garage.py imports this module to set up the plans and render the stills, and embeds
it in the .blend as a registered text block. Blender runs it when the file opens, once
scripts are allowed.
"""
import bpy
import bpy.utils.previews

ATTR = "garage_"  # view-layer properties the materials read: garage_wall, garage_band, ...
CUT = " · cutaway"
CUTAWAY = (" · front", " · east", " · ceiling", " · gear", " · fixtures", " · window view")
BASE = "Base"

# Paint and finish colors, as in the web planner: (id, name, code, hex)
SWATCHES = {
    "wall": [("pure", "Pure White", "SW 7005", "#EDECE6"), ("extra", "Extra White", "SW 7006", "#EEEFEA"),
             ("repose", "Repose Gray", "SW 7015", "#CCC9C0"), ("mindful", "Mindful Gray", "SW 7016", "#BCB7AD"),
             ("gauntlet", "Gauntlet Gray", "SW 7019", "#78736E")],
    "band": [("none", "No band", "", None), ("peppercorn", "Peppercorn", "SW 7674", "#585858"),
             ("ironore", "Iron Ore", "SW 7069", "#434341"), ("naval", "Naval", "SW 6244", "#2F3D4C"),
             ("gauntlet", "Gauntlet Gray", "SW 7019", "#78736E")],
    "curb": [("bare", "Bare concrete", "", "#B9B4AA"), ("white", "Sealed white", "DRYLOK", "#E9E8E2"),
             ("gray", "Sealed gray", "", "#9A9EA3"), ("charcoal", "Charcoal", "", "#46494E")],
    "builtin": [("natural", "Natural plywood, clear coat", "", "#C99A5E"), ("ironore", "Iron Ore", "SW 7069", "#434341"),
                ("pure", "Pure White", "SW 7005", "#EDECE6"), ("naval", "Naval", "SW 6244", "#2F3D4C")],
    "cab": [("charcoal", "Charcoal", "", "#33373C"), ("slate", "Slate gray", "", "#5E6873"),
            ("navy", "Navy", "", "#243A5E"), ("red", "Red", "", "#9E2A26")],
    "slat": [("white", "White", "", "#EFEFEC"), ("gray", "Gray", "", "#A7ABB0"), ("graphite", "Graphite", "", "#4A4E54")],
}
SWATCH_TITLES = {"wall": "Wall color", "band": "Lower band, up to the sill", "curb": "Concrete curb and back wall",
                 "builtin": "Built-in finish", "cab": "Cabinet color", "slat": "Slatwall color"}
SHORT = {"band.none": "None", "curb.bare": "Bare", "builtin.natural": "Natural wood"}  # labels that fit the sidebar

# Choices that swap collections: (id, label, description, collection). Labels are short to fit the sidebar.
CHOICES = {
    "finish": ("Wall finish", [
        ("asis", "As is", "White paint, as photographed", "Walls · as is (white, water damage)"),
        ("paint", "Paint", "Paint refresh: scrubbable satin, with an optional dark band up to the window sill", "Walls · paint refresh"),
        ("pvc", "PVC boards", "Trusscore PVC wall boards: bright white and wipe-clean", "Walls · PVC boards (Trusscore)")]),
    "shelves": ("Back-wall shelves", [
        ("asis", "As is", "Keep the plywood cubbies as they are", "Shelves · plywood built-ins (as is)"),
        ("refresh", "Refreshed", "Refresh the built-ins: finish, butcher block, clear totes, LEDs", "Shelves · refreshed built-ins"),
        ("racks", "Racks + bench", "Two 4 ft steel racks, a 6 ft workbench and metal pegboard", "Shelves · steel racks + workbench"),
        ("cabinets", "Cabinet wall", "Steel cabinet wall: lockers, base and wall cabinets", "Shelves · steel cabinet wall")]),
    "bikes": ("Bike wall", [
        ("asis", "As is", "Hooks on a wood cleat", "Bike wall · as is"),
        ("steadyrack", "Pivot racks", "Steadyrack pivot racks: bikes swing flat to the wall", "Bike wall · Steadyrack pivot racks"),
        ("slatwall", "Slatwall", "Slatwall for the bikes, yard tools and a basket", "Bike wall · slatwall")]),
    "door": ("House-door wall", [
        ("asis", "As is", "Peg rail with helmets and balls", "House-door wall · peg rail (as is)"),
        ("slatwall", "Slatwall", "Sports slatwall: ball basket, helmet and board hooks", "House-door wall · sports slatwall"),
        ("dropzone", "Drop zone", "Drop zone: bench, hooks and a gear rail", "House-door wall · drop zone")]),
    "overhead": ("Overhead storage", [
        ("none", "None", "Kayak and ski racks only", None),
        ("two", "Two racks", "Two 4 × 8 ceiling racks between the beam and the shelves", "Overhead racks · two 4 × 8")]),
    "lights": ("Lighting", [
        ("fluorescent", "Fluorescent", "The fluorescent tubes you have now", "Lighting · fluorescent (as is)"),
        ("led", "LED bars", "Linkable 4 ft LED shop lights", "Lighting · LED shop lights"),
        ("hex", "Hex grid", "A hexagon LED grid over the parking bays", "Lighting · hex grid")]),
    "column": ("Steel column", [
        ("asis", "As is", "Foam and duct tape", "Column · foam and tape (as is)"),
        ("rope", "Rope wrap", "Manila rope bumper", "Column · manila rope wrap"),
        ("guard", "Post guard", "Yellow HDPE post sleeve", "Column · yellow post guard")]),
}
CONCRETE = {"bare": "Concrete · bare", "sealed": "Concrete · sealed (DRYLOK)"}

CURRENT = dict(finish="asis", wall="pure", band="none", curb="bare", shelves="asis", builtin="natural", cab="charcoal",
               bikes="asis", door="asis", slat="gray", overhead="none", lights="fluorescent", column="asis")
PLANS = [
    ("As photographed", dict(CURRENT)),
    ("Weekend refresh", dict(CURRENT, finish="paint", wall="repose", band="peppercorn", curb="gray", shelves="refresh",
                             builtin="ironore", lights="led", column="rope")),
    ("Organized", dict(CURRENT, finish="paint", wall="pure", curb="charcoal", shelves="racks", bikes="steadyrack",
                       door="slatwall", slat="gray", overhead="two", lights="led", column="guard")),
    ("Showroom", dict(CURRENT, finish="pvc", curb="charcoal", shelves="cabinets", cab="charcoal", bikes="slatwall",
                      door="dropzone", slat="graphite", overhead="two", lights="hex", column="guard")),
]

# The color temperature a phone camera would balance to under each option; the hex plan mixes 5000 K and 6000 K
WHITE_BALANCE = {"fluorescent": 4400, "led": 5000, "hex": 5500}

CAMERAS = [("doors", "Garage doors", "Cam · from the garage doors"),
           ("back", "Back wall", "Cam · back wall"),
           ("bikes", "Bike wall", "Cam · bike wall"),
           ("entry", "House door", "Cam · house door"),
           ("toward_doors", "Toward doors", "Cam · toward the doors"),
           ("overview", "Overview", "Cam · cutaway overview")]


# ─── plan state ───────────────────────────────────────────────────────────
def collection(group, key):
    return next(c[3] for c in CHOICES[group][1] if c[0] == key)


def plan_of(layer_name):
    """The plan a view layer shows, or None."""
    name = layer_name[:-len(CUT)] if layer_name.endswith(CUT) else layer_name
    return name if name in dict(PLANS) else None


def read_opts(scene, plan):
    """A plan's current choices: what's stored on the scene, over the plan's defaults. Never writes,
    so it is safe while Blender draws the panel."""
    o = dict(dict(PLANS)[plan])
    store = scene.get("garage_plans")
    if store is not None and plan in store:
        o.update({k: v for k, v in store[plan].items() if k in o})
    return o


def write_opt(scene, plan, key, value):
    if "garage_plans" not in scene:
        scene["garage_plans"] = {}
    store = scene["garage_plans"]
    if plan not in store:
        store[plan] = read_opts(scene, plan)
    store[plan][key] = value


def reset_plan(scene, plan):
    if "garage_plans" in scene and plan in scene["garage_plans"]:
        del scene["garage_plans"][plan]
    apply_layers(scene, plan)
    apply_colors(scene, plan)


def keep(o):
    names = {BASE, CONCRETE["bare" if o["curb"] == "bare" else "sealed"]}
    for group in CHOICES:
        name = collection(group, o[group])
        if name:
            names.add(name)
    return names


def apply_layers(scene, plan):
    """Switch the plan's collections on in its view layer and its cutaway twin."""
    names = keep(read_opts(scene, plan))
    for layer_name, cut in ((plan, False), (plan + CUT, True)):
        vl = scene.view_layers.get(layer_name)
        if vl is None or "Garage" not in vl.layer_collection.children:
            continue
        for lc in vl.layer_collection.children["Garage"].children:
            lc.exclude = lc.name not in names
            if not lc.exclude:  # excluding a parent flags its children too; don't undo that
                for child in lc.children:
                    child.exclude = cut and child.name.endswith(CUTAWAY)


def lin(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def swatch(group, key):
    return next((s for s in SWATCHES[group] if s[0] == key), SWATCHES[group][0])


def colors(o, cut=False):
    """The values the materials read for a set of choices, in linear RGB."""
    wall = lin(swatch("wall", o["wall"])[3])[:3]
    band = swatch("band", o["band"])[3]
    return {
        "wall": wall,
        "band": lin(band)[:3] if band else wall,
        "curb": lin(swatch("curb", o["curb"])[3])[:3],
        "builtin": lin(swatch("builtin", o["builtin"])[3])[:3],
        "builtin_natural": 1.0 if o["builtin"] == "natural" else 0.0,
        "cab": lin(swatch("cab", o["cab"])[3])[:3],
        "slat": lin(swatch("slat", o["slat"])[3])[:3],
        # a dark night outside, or a light studio gray behind the cutaway
        "backdrop": (0.495, 0.522, 0.558) if cut else (0.015, 0.018, 0.022),
    }


def apply_colors(scene, plan):
    """Write the plan's colors onto its view layer and cutaway twin."""
    o = read_opts(scene, plan)
    for layer_name, cut in ((plan, False), (plan + CUT, True)):
        vl = scene.view_layers.get(layer_name)
        if vl is None:
            continue
        for k, v in colors(o, cut).items():
            vl[ATTR + k] = v
    scene.update_tag()


def set_defaults(scene):
    """Scene-level fallbacks, used by any view layer without its own colors."""
    for k, v in colors(dict(PLANS[0][1])).items():
        scene[ATTR + k] = v


def blackbody(k):
    """Compact approximation of blackbody RGB (normalized, linear), good for 2000-10000 K."""
    import math
    t = k / 100.0
    r = 255 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255 if t >= 66 else (0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    c = [max(0.0, min(255.0, v)) / 255 for v in (r, g, b)]
    return tuple(((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


def white_balance(scene, kelvin, amount=0.8):
    """Balance most of the way to the lights' color, leaving a little warmth, as a phone camera does."""
    vs = scene.view_settings
    if hasattr(vs, "use_white_balance"):  # Blender 4.3+
        vs.use_white_balance = True
        vs.white_balance_whitepoint = tuple(c ** amount for c in blackbody(kelvin))


def activate(scene, layer_name):
    """Balance the camera for the plan's lights. The white balance is per scene, not per view layer."""
    plan = plan_of(layer_name)
    if plan is not None:
        white_balance(scene, WHITE_BALANCE[read_opts(scene, plan)["lights"]])


# ─── panel ────────────────────────────────────────────────────────────────
_icons = None
_last_layer = {"name": None}


def _current(context):
    return plan_of(context.view_layer.name) if context.view_layer else None


def _show_layer(context, name):
    vl = context.scene.view_layers.get(name)
    if vl is None:
        return
    if context.window is not None:
        context.window.view_layer = vl
    _last_layer["name"] = name
    activate(context.scene, name)


def _views(context):
    screen = context.screen or (context.window.screen if context.window else None)
    return [a.spaces.active for a in screen.areas if a.type == "VIEW_3D"] if screen else []


def look_through(context, key):
    cam = bpy.data.objects.get(dict((k, n) for k, _, n in CAMERAS)[key])
    if cam is None:
        return
    context.scene.camera = cam
    for space in _views(context):
        space.region_3d.view_perspective = "CAMERA"


def _choice_prop(group):
    title, choices = CHOICES[group]

    def get(self):
        plan = _current(bpy.context)
        value = read_opts(self.id_data, plan)[group] if plan else choices[0][0]
        return next((i for i, c in enumerate(choices) if c[0] == value), 0)

    def set_(self, i):
        plan = _current(bpy.context)
        if plan is None:
            return
        write_opt(self.id_data, plan, group, choices[i][0])
        apply_layers(self.id_data, plan)
        if group == "lights":
            activate(self.id_data, bpy.context.view_layer.name)

    items = [(c[0], c[1], c[2], i) for i, c in enumerate(choices)]
    return bpy.props.EnumProperty(name=title, items=items, get=get, set=set_)


def _swatch_prop(group):
    swatches = SWATCHES[group]

    def get(self):
        plan = _current(bpy.context)
        value = read_opts(self.id_data, plan)[group] if plan else swatches[0][0]
        return next((i for i, s in enumerate(swatches) if s[0] == value), 0)

    def set_(self, i):
        plan = _current(bpy.context)
        if plan is None:
            return
        write_opt(self.id_data, plan, group, swatches[i][0])
        if group == "curb":
            apply_layers(self.id_data, plan)
        apply_colors(self.id_data, plan)

    items = []
    for i, (sid, name, code, hexcol) in enumerate(swatches):
        icon = 0
        if _icons is not None and hexcol:
            icon = _icons[f"{group}.{sid}"].icon_id
        items.append((sid, SHORT.get(f"{group}.{sid}", name), f"{name}, {code}" if code else name, icon, i))
    return bpy.props.EnumProperty(name=SWATCH_TITLES[group], items=items, get=get, set=set_)


def _get_plan(self):
    plan = _current(bpy.context)
    names = [p for p, _ in PLANS]
    return names.index(plan) if plan in names else 0


def _set_plan(self, i):
    ctx = bpy.context
    cut = ctx.view_layer.name.endswith(CUT)
    _show_layer(ctx, PLANS[i][0] + (CUT if cut else ""))


def _get_cut(self):
    return bpy.context.view_layer.name.endswith(CUT)


def _set_cut(self, on):
    ctx = bpy.context
    plan = _current(ctx)
    if plan is None:
        return
    _show_layer(ctx, plan + (CUT if on else ""))
    look_through(ctx, "overview" if on else "doors")


def _get_cam(self):
    cam = self.id_data.camera
    return next((i for i, c in enumerate(CAMERAS) if cam is not None and cam.name == c[2]), 0)


def _set_cam(self, i):
    look_through(bpy.context, CAMERAS[i][0])


def _get_real(self):
    return any(s.shading.type == "RENDERED" for s in _views(bpy.context))


def _set_real(self, on):
    for s in _views(bpy.context):
        s.shading.type = "RENDERED" if on else "MATERIAL"


def _make_props():
    ann = {
        "plan": bpy.props.EnumProperty(name="Plan", items=[(p, p, "Switch to this plan", i) for i, (p, _) in enumerate(PLANS)],
                                       get=_get_plan, set=_set_plan),
        "cutaway": bpy.props.BoolProperty(name="Cutaway", description="Hide the ceiling, the door wall and the east wall",
                                          get=_get_cut, set=_set_cut),
        "camera": bpy.props.EnumProperty(name="Look from", items=[(k, label, "", i) for i, (k, label, _) in enumerate(CAMERAS)],
                                         get=_get_cam, set=_set_cam),
        "realistic": bpy.props.BoolProperty(name="Realistic",
                                            description="Show the view with path-traced lighting (Rendered shading). Slower",
                                            get=_get_real, set=_set_real),
    }
    for group in CHOICES:
        ann[group] = _choice_prop(group)
    for group in SWATCHES:
        ann[group] = _swatch_prop(group)
    return type("GaragePlannerProps", (bpy.types.PropertyGroup,), {"__annotations__": ann})


class GARAGE_OT_reset_plan(bpy.types.Operator):
    bl_idname = "garage.reset_plan"
    bl_label = "Reset this plan"
    bl_description = "Put this plan's choices and colors back the way they started"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        plan = _current(context)
        if plan is None:
            return {"CANCELLED"}
        reset_plan(context.scene, plan)
        activate(context.scene, context.view_layer.name)
        return {"FINISHED"}


class GARAGE_PT_planner(bpy.types.Panel):
    bl_idname = "GARAGE_PT_planner"
    bl_label = "Garage planner"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Garage"

    def draw(self, context):
        g = context.scene.garage
        layout = self.layout
        layout.prop(g, "plan", text="")
        plan = _current(context)
        if plan is None:
            layout.label(text="Pick a plan to change it.", icon="INFO")
            return
        o = read_opts(context.scene, plan)

        def row(box, prop, label):
            r = box.split(factor=0.34)
            r.label(text=label)
            r.prop(g, prop, text="")

        box = layout.box().column()
        box.label(text="Walls", icon="MOD_BUILD")
        row(box, "finish", "Finish")
        if o["finish"] == "paint":
            row(box, "wall", "Color")
            row(box, "band", "Band")
        row(box, "curb", "Concrete")

        box = layout.box().column()
        box.label(text="Storage", icon="PACKAGE")
        row(box, "shelves", "Shelves")
        if o["shelves"] == "refresh":
            row(box, "builtin", "Built-ins")
        if o["shelves"] == "cabinets":
            row(box, "cab", "Cabinets")
        row(box, "bikes", "Bike wall")
        row(box, "door", "Door wall")
        if "slatwall" in (o["bikes"], o["door"]):
            row(box, "slat", "Slatwall")

        box = layout.box().column()
        box.label(text="Ceiling", icon="LIGHT_AREA")
        row(box, "overhead", "Racks")
        row(box, "lights", "Lights")
        row(box, "column", "Column")

        box = layout.box().column()
        box.label(text="View", icon="CAMERA_DATA")
        row(box, "camera", "Camera")
        r = box.split(factor=0.34)
        r.label(text="")
        c = r.column()
        c.prop(g, "cutaway")
        c.prop(g, "realistic")
        box.operator("render.render", text="Render a picture", icon="RENDER_STILL")

        layout.operator("garage.reset_plan", icon="LOOP_BACK")


_owner = object()  # message-bus subscriptions belong to this


def _on_view_layer():
    # Switching view layers from Blender's own menu: bring that plan's colors along.
    ctx = bpy.context
    if ctx.window is not None and ctx.window.view_layer.name != _last_layer["name"]:
        _last_layer["name"] = ctx.window.view_layer.name
        activate(ctx.window.scene, ctx.window.view_layer.name)


def _on_open():
    """After the file opens: set up the current plan and bring the Garage tab to the front."""
    for win in bpy.context.window_manager.windows:
        _last_layer["name"] = win.view_layer.name
        activate(win.scene, win.view_layer.name)
        for area in win.screen.areas:
            if area.type != "VIEW_3D":
                continue
            for region in area.regions:
                if region.type == "UI" and hasattr(region, "active_panel_category"):  # Blender 4.3+
                    try:
                        region.active_panel_category = "Garage"
                    except (TypeError, ValueError):
                        pass
                if region.type == "WINDOW" and area.spaces.active.region_3d.view_perspective == "CAMERA":
                    try:  # fit the camera frame to the view
                        with bpy.context.temp_override(window=win, area=area, region=region):
                            bpy.ops.view3d.view_center_camera()
                    except RuntimeError:
                        pass
            try:
                area.spaces.active.shading.studio_light = "interior.exr"
            except TypeError:
                pass
    return None


def _make_icons():
    global _icons
    try:
        _icons = bpy.utils.previews.new()
        for group, swatches in SWATCHES.items():
            for sid, _, _, hexcol in swatches:
                if not hexcol:
                    continue
                h = hexcol.lstrip("#")
                px = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [1.0]
                pv = _icons.new(f"{group}.{sid}")
                pv.icon_size = (16, 16)
                pv.icon_pixels_float = px * 256
                pv.image_size = (32, 32)
                pv.image_pixels_float = px * 1024
    except Exception:  # icons are a nicety; the dropdowns work without them
        _icons = None


_classes = []


def register():
    unregister()
    _make_icons()
    _classes[:] = [_make_props(), GARAGE_OT_reset_plan, GARAGE_PT_planner]
    for c in _classes:
        bpy.utils.register_class(c)
    bpy.types.Scene.garage = bpy.props.PointerProperty(type=_classes[0])
    bpy.msgbus.subscribe_rna(key=(bpy.types.Window, "view_layer"), owner=_owner, args=(), notify=_on_view_layer)
    if not bpy.app.background:
        bpy.app.timers.register(_on_open, first_interval=0.2)


def unregister():
    global _icons
    bpy.msgbus.clear_by_owner(_owner)
    if hasattr(bpy.types.Scene, "garage"):
        del bpy.types.Scene.garage
    for name in ("GARAGE_PT_planner", "GARAGE_OT_reset_plan", "GaragePlannerProps"):
        cls = getattr(bpy.types, name, None)
        if cls is not None:
            try:
                bpy.utils.unregister_class(cls)
            except RuntimeError:
                pass
    _classes.clear()
    if _icons is not None:
        bpy.utils.previews.remove(_icons)
        _icons = None


# Blender imports this text block when the .blend opens (with scripts allowed), and runs it as
# __main__ from the Text Editor's Run Script button. The build script imports it without the UI.
if __name__ == "__main__" or not bpy.app.background:
    register()
