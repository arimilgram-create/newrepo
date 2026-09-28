#!/usr/bin/env python3
"""Build a photoreal Blender model of the two-bay garage and its makeover plans.

    python3 blender/build_garage.py                      # writes blender/garage.blend
    python3 blender/build_garage.py --render renders/    # also renders the stills

It runs with Blender's Python module (pip install "bpy==4.5.*") or inside Blender:

    blender --background --python blender/build_garage.py -- --render renders/

The layout matches the web model (src/app.js). It is authored in feet in the
same "web" coordinates: x runs east (window wall to house-door wall), y is up,
and z runs from the back wall (0) toward the garage doors (D). Everything is
converted to Blender meters: X east, Y north from the garage doors, Z up.

Every option lives in its own collection, and each plan is a view layer that
switches the right collections on. garage_planner.py defines the options and plans,
and adds the Garage tab (press N in the 3D viewport) that changes them, colors
included. This script embeds it in the .blend, where it runs once scripts are allowed.
"""
import argparse
import math
import os
import sys

import bpy  # must come first: the pip bpy module puts bmesh and mathutils on the path
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "textures")
sys.path.insert(0, HERE)
import garage_planner as gp  # noqa: E402  (options, plans and the planner panel)

# ─── layout (feet) ────────────────────────────────────────────────────────
FT = 0.3048
W, D, H = 19.0, 22.0, 97 / 12          # ceiling measured on site: 97 in.
T_WALL = 0.45
CURB_H, CURB_T, BACK_H, BAND_H = 1.7, 0.22, 3.15, 3.35
BW, BD = 3.0, 4.5                       # bump-out in the northeast corner
DOOR_W, DOOR_H = 8.0, 7.0
BEAM_Y = H - 0.79                       # beam underside, 9.5 in. below the ceiling
_RET = max(0.3, (W - 2 * DOOR_W - 1.5) / 2)
DOORS = [(_RET, _RET + DOOR_W), (W - _RET - DOOR_W, W - _RET)]
BEAM_Z = D - 12 * (D / 22)
COL_X = W * 8 / 19
WIN = dict(s0=2.9, s1=6.7, y0=3.45, y1=min(7.05, H - 0.7))
STEP_H = 0.42                           # raised sill at the house door
HD = dict(z0=BD + 0.1, z1=BD + 3.35, top=STEP_H + 80 / 12)
X1 = W - BW

# web (feet, y-up, z toward the doors) -> Blender (meters, z-up, y north)
TOBL = Matrix.Scale(FT, 4) @ Matrix(((1, 0, 0, 0), (0, 0, -1, D), (0, 1, 0, 0), (0, 0, 0, 1)))
I4 = Matrix.Identity(4)


def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def RX(a):
    return Matrix.Rotation(a, 4, "X")


def RY(a):
    return Matrix.Rotation(a, 4, "Y")


def RZ(a):
    return Matrix.Rotation(a, 4, "Z")


def SC(sx, sy, sz):
    m = Matrix.Identity(4)
    m[0][0], m[1][1], m[2][2] = sx, sy, sz
    return m


def to_bl(p):
    return (TOBL @ Vector((p[0], p[1], p[2], 1.0))).xyz


# wall-local frames: x along the wall, y up, z out from the wall into the room
WALL = {
    "west": T(0, 0, D) @ RY(math.pi / 2),
    "east": T(W, 0, 0) @ RY(-math.pi / 2),
    "bumpW": T(W - BW, 0, 0) @ RY(-math.pi / 2),
}


# ─── collections ──────────────────────────────────────────────────────────
class Ctx:
    root = None
    option = None


def coll(name, parent):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        parent.children.link(c)
    return c


def sub(group):
    return coll(f"{Ctx.option.name} · {group}", Ctx.option)


def option(name):
    Ctx.option = coll(name, Ctx.root)
    return Ctx.option


# ─── materials ────────────────────────────────────────────────────────────
def lin(hexstr, a=1.0):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (a,)


class NT:
    """Small helper for writing shader node trees."""

    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.m.use_nodes = True
        self.t = self.m.node_tree
        self.t.nodes.clear()
        self.out = self.n("ShaderNodeOutputMaterial")
        self.b = self.n("ShaderNodeBsdfPrincipled")
        self.link(self.b.outputs["BSDF"], self.out.inputs["Surface"])

    def n(self, typ, **props):
        node = self.t.nodes.new(typ)
        for k, v in props.items():
            setattr(node, k, v)
        return node

    def link(self, a, b):
        self.t.links.new(a, b)

    def val(self, sock, v):
        sock.default_value = v

    def vl(self, key):
        """A value the planner sets on each view layer (the custom property garage_<key>), so each plan
        keeps its own colors. Returns the Attribute node's outputs: "Color" or "Fac"."""
        return self.n("ShaderNodeAttribute", attribute_type="VIEW_LAYER", attribute_name=gp.ATTR + key).outputs

    def scale(self, col, k):
        m = self.n("ShaderNodeVectorMath", operation="SCALE")
        self.link(col, m.inputs[0])
        m.inputs["Scale"].default_value = k
        return m.outputs["Vector"]

    def pos(self, scale=1.0):
        g = self.n("ShaderNodeNewGeometry")
        if scale == 1.0:
            return g.outputs["Position"]
        m = self.n("ShaderNodeVectorMath", operation="SCALE")
        self.link(g.outputs["Position"], m.inputs[0])
        m.inputs["Scale"].default_value = scale
        return m.outputs["Vector"]

    def noise(self, vec, scale, detail=2.0, rough=0.5, distortion=0.0):
        n = self.n("ShaderNodeTexNoise")
        self.link(vec, n.inputs["Vector"])
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Distortion"].default_value = distortion
        return n

    def voronoi(self, vec, scale, feature="F1", randomness=1.0):
        v = self.n("ShaderNodeTexVoronoi", feature=feature)
        self.link(vec, v.inputs["Vector"])
        v.inputs["Scale"].default_value = scale
        v.inputs["Randomness"].default_value = randomness
        return v

    def math(self, op, a, b=None, clamp=False):
        m = self.n("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                m.inputs[i].default_value = x
            else:
                self.link(x, m.inputs[i])
        return m.outputs[0]

    def maprange(self, v, a, b, c=0.0, d=1.0, clamp=True):
        m = self.n("ShaderNodeMapRange", clamp=clamp)
        self.link(v, m.inputs["Value"])
        m.inputs["From Min"].default_value, m.inputs["From Max"].default_value = a, b
        m.inputs["To Min"].default_value, m.inputs["To Max"].default_value = c, d
        return m.outputs["Result"]

    def mix(self, fac, a, b):
        m = self.n("ShaderNodeMix", data_type="RGBA")
        for idx, x in ((0, fac), (6, a), (7, b)):
            if isinstance(x, (int, float)):
                m.inputs[idx].default_value = x
            elif isinstance(x, tuple):
                m.inputs[idx].default_value = x
            else:
                self.link(x, m.inputs[idx])
        return m.outputs[2]

    def ramp(self, fac, stops, interp="LINEAR"):
        r = self.n("ShaderNodeValToRGB")
        r.color_ramp.interpolation = interp
        els = r.color_ramp.elements
        while len(els) > len(stops):
            els.remove(els[-1])
        while len(els) < len(stops):
            els.new(0.5)
        for e, (p, col) in zip(els, stops):
            e.position = p
            e.color = col if isinstance(col, tuple) else lin(col)
        self.link(fac, r.inputs["Fac"])
        return r.outputs["Color"]

    def bump(self, height, strength, distance, normal=None):
        b = self.n("ShaderNodeBump")
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = distance
        self.link(height, b.inputs["Height"])
        if normal is not None:
            self.link(normal, b.inputs["Normal"])
        return b.outputs["Normal"]

    def image(self, path, noncolor=False, extension="REPEAT", uvscale=None):
        tx = self.n("ShaderNodeTexImage")
        img = bpy.data.images.load(path, check_existing=True)
        if noncolor:
            img.colorspace_settings.name = "Non-Color"
        tx.image = img
        tx.extension = extension
        tx.interpolation = "Cubic"
        if uvscale:
            tc = self.n("ShaderNodeTexCoord")
            mp = self.n("ShaderNodeMapping")
            mp.inputs["Scale"].default_value = (uvscale[0], uvscale[1], 1)
            self.link(tc.outputs["UV"], mp.inputs["Vector"])
            self.link(mp.outputs["Vector"], tx.inputs["Vector"])
        return tx

    def set(self, **kw):
        names = {"base": "Base Color", "rough": "Roughness", "metal": "Metallic", "coat": "Coat Weight",
                 "coat_rough": "Coat Roughness", "trans": "Transmission Weight", "ior": "IOR",
                 "spec": "Specular IOR Level", "aniso": "Anisotropic", "sheen": "Sheen Weight",
                 "emit_strength": "Emission Strength", "emit": "Emission Color", "alpha": "Alpha"}
        for k, v in kw.items():
            sock = self.b.inputs[names[k]]
            if isinstance(v, (int, float, tuple)):
                sock.default_value = lin(v) if False else v
            elif isinstance(v, str):
                sock.default_value = lin(v)
            else:
                self.link(v, sock)
        return self


MAT = {}


def mat(key, builder):
    if key not in MAT:
        MAT[key] = builder()
    return MAT[key]


def m_simple(name, hexcol, rough=0.5, metal=0.0, coat=0.0, spec=0.5):
    def b():
        nt = NT(name)
        nt.set(base=hexcol, rough=rough, metal=metal, coat=coat, spec=spec)
        return nt.m
    return mat(name, b)


def m_floor():
    def b():
        nt = NT("Floor · flake epoxy, polyaspartic topcoat")
        p = nt.pos()
        warp = nt.noise(p, 38.0, detail=2.0)
        wv = nt.n("ShaderNodeVectorMath", operation="MULTIPLY_ADD")
        nt.link(warp.outputs["Color"], wv.inputs[0])
        wv.inputs[1].default_value = (0.0035, 0.0035, 0.0035)
        nt.link(p, wv.inputs[2])
        v1 = nt.voronoi(wv.outputs["Vector"], 115.0)
        v2 = nt.voronoi(wv.outputs["Vector"], 185.0)
        s1, s2 = nt.n("ShaderNodeSeparateColor"), nt.n("ShaderNodeSeparateColor")
        nt.link(v1.outputs["Color"], s1.inputs["Color"])
        nt.link(v2.outputs["Color"], s2.inputs["Color"])
        mask = nt.math("GREATER_THAN", nt.noise(p, 9.0, 2.0).outputs["Fac"], 0.52)
        r = nt.n("ShaderNodeMix", data_type="FLOAT")
        nt.link(mask, r.inputs[0])
        nt.link(s1.outputs["Red"], r.inputs[2])
        nt.link(s2.outputs["Red"], r.inputs[3])
        col = nt.ramp(r.outputs[0], [(0.0, "#e2e2df"), (0.17, "#babcbf"), (0.36, "#909397"), (0.58, "#55595f"),
                                      (0.82, "#232629"), (0.95, "#737e8c")], interp="CONSTANT")
        drift = nt.maprange(nt.noise(p, 0.45, 3.0).outputs["Fac"], 0.3, 0.7, 0.0, 1.0)
        col = nt.mix(nt.math("MULTIPLY", drift, 0.18), col, lin("#4a4d51"))
        e1 = nt.voronoi(wv.outputs["Vector"], 115.0, feature="DISTANCE_TO_EDGE")
        height = nt.maprange(e1.outputs["Distance"], 0.0, 0.06, 0.0, 1.0)
        nt.set(base=col, rough=0.55, coat=0.85, ior=1.5)
        nt.b.inputs["Coat IOR"].default_value = 1.5
        cr = nt.maprange(nt.noise(p, 1.3, 3.0).outputs["Fac"], 0.3, 0.7, 0.05, 0.13)
        nt.link(cr, nt.b.inputs["Coat Roughness"])
        nt.link(nt.bump(height, 0.35, 0.0006), nt.b.inputs["Normal"])
        return nt.m
    return mat("floor", b)


def m_wall(key, name, hexcol, band=None, grime=0.0, rough=0.82, swatch=False):
    """Painted drywall. With swatch=True the wall and band colors come from the view layer (see NT.vl)."""
    def b():
        nt = NT(name)
        p = nt.pos()
        sep = nt.n("ShaderNodeSeparateXYZ")
        nt.link(p, sep.inputs[0])
        if swatch:
            base = nt.vl("wall")["Color"]
            darker = nt.scale(base, 0.975)
        else:
            base = lin(hexcol)
            darker = tuple(x * 0.975 for x in base[:3]) + (1,)
        col = nt.mix(nt.maprange(nt.noise(p, 1.4, 3.0).outputs["Fac"], 0.35, 0.65, 0.0, 1.0), darker, base)
        if band:
            under = nt.math("LESS_THAN", sep.outputs["Z"], BAND_H * FT)
            col = nt.mix(under, col, nt.vl("band")["Color"] if swatch else lin(band))
        if grime > 0:
            low = nt.maprange(sep.outputs["Z"], 0.0, 0.32, 1.0, 0.0)
            dirt = nt.math("MULTIPLY", low, nt.maprange(nt.noise(p, 6.0, 5.0).outputs["Fac"], 0.35, 0.75, 0.25, 1.0))
            col = nt.mix(nt.math("MULTIPLY", dirt, grime), col, lin("#8f8574"))
        peel = nt.noise(p, 260.0, 6.0, 0.55)
        nt.set(base=col, rough=rough)
        nt.link(nt.bump(peel.outputs["Fac"], 0.045, 0.0006), nt.b.inputs["Normal"])
        return nt.m
    return mat(key, b)


def m_ceiling():
    def b():
        nt = NT("Ceiling · textured plaster")
        p = nt.pos()
        v = nt.voronoi(p, 420.0)
        n = nt.noise(p, 140.0, 5.0)
        h = nt.math("ADD", nt.math("MULTIPLY", v.outputs["Distance"], 1.6), n.outputs["Fac"])
        nt.set(base="#EDEBE5", rough=0.95)
        nt.link(nt.bump(h, 0.32, 0.0012), nt.b.inputs["Normal"])
        return nt.m
    return mat("ceiling", b)


def m_concrete(key, name, paint=None):
    def b():
        nt = NT(name)
        p = nt.pos()
        n1 = nt.noise(p, 2.4, 8.0, 0.6)
        n2 = nt.noise(p, 0.7, 4.0, 0.5)
        pores = nt.voronoi(p, 900.0)
        pore = nt.maprange(pores.outputs["Distance"], 0.0, 0.12, 1.0, 0.0)
        sep = nt.n("ShaderNodeSeparateXYZ")
        nt.link(p, sep.inputs[0])
        along = nt.math("ADD", sep.outputs["X"], sep.outputs["Y"])
        seam = nt.maprange(nt.math("PINGPONG", along, 0.6096), 0.0, 0.004, 1.0, 0.0)
        if paint is None:
            c = nt.mix(nt.maprange(n1.outputs["Fac"], 0.3, 0.7), lin("#8a8479"), lin("#aca69b"))
            c = nt.mix(nt.maprange(n2.outputs["Fac"], 0.42, 0.72, 0.0, 0.65), c, lin("#655f55"))
            sep2 = nt.n("ShaderNodeSeparateXYZ")
            nt.link(p, sep2.inputs[0])
            wet = nt.math("MULTIPLY", nt.maprange(sep2.outputs["Z"], 0.0, 0.35, 0.55, 0.0), nt.noise(p, 3.0, 6.0).outputs["Fac"])
            c = nt.mix(wet, c, lin("#4f4a42"))
            c = nt.mix(nt.math("MULTIPLY", pore, 0.7), c, lin("#5c574f"))
            c = nt.mix(nt.math("MULTIPLY", seam, 0.35), c, lin("#6d675d"))
            nt.set(base=c, rough=0.92)
            h = nt.math("ADD", n1.outputs["Fac"], nt.math("MULTIPLY", pore, -0.5))
            nt.link(nt.bump(h, 0.35, 0.0015), nt.b.inputs["Normal"])
        else:
            sealed = nt.vl("curb")["Color"]
            c = nt.mix(nt.maprange(n1.outputs["Fac"], 0.3, 0.7), nt.scale(sealed, 0.95), sealed)
            nt.set(base=c, rough=0.7)
            h = nt.math("ADD", nt.math("MULTIPLY", n1.outputs["Fac"], 0.5), nt.math("MULTIPLY", pore, -0.4))
            nt.link(nt.bump(h, 0.18, 0.001), nt.b.inputs["Normal"])
        return nt.m
    return mat(key, b)


def wood_grain(nt, p, light, dark, scale):
    """Face grain: long straight fibers along X with gentle figure, not swirls. Returns (color, fibers)."""
    stretch = nt.n("ShaderNodeVectorMath", operation="MULTIPLY")
    nt.link(p, stretch.inputs[0])
    stretch.inputs[1].default_value = (0.3, 6.0, 6.0)
    fibers = nt.noise(stretch.outputs["Vector"], 55.0, 8.0, 0.62)
    w = nt.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Y", wave_profile="SIN")
    nt.link(p, w.inputs["Vector"])
    w.inputs["Scale"].default_value = scale * 3.0
    w.inputs["Distortion"].default_value = 1.6
    w.inputs["Detail"].default_value = 4.0
    w.inputs["Detail Scale"].default_value = 2.0
    f = nt.math("ADD", nt.math("MULTIPLY", w.outputs["Fac"], 0.5), nt.math("MULTIPLY", fibers.outputs["Fac"], 0.5))
    col = nt.ramp(f, [(0.28, dark), (0.78, light)])
    tone = nt.maprange(nt.noise(p, 0.9, 2.0).outputs["Fac"], 0.35, 0.65, 0.0, 0.18)
    return nt.mix(tone, col, lin(dark)), fibers.outputs["Fac"]


def m_wood(key, name, light, dark, rough=0.65, coat=0.0, scale=4.0):
    def b():
        nt = NT(name)
        col, fibers = wood_grain(nt, nt.pos(), light, dark, scale)
        nt.set(base=col, rough=rough, coat=coat)
        nt.b.inputs["Coat Roughness"].default_value = 0.12
        nt.link(nt.bump(fibers, 0.08, 0.0004), nt.b.inputs["Normal"])
        return nt.m
    return mat(key, b)


def m_builtin():
    """Refreshed built-ins: enamel in the planner's color, or clear-coated plywood when "natural" is 1."""
    def b():
        nt = NT("Built-ins · refreshed finish")
        wood, fibers = wood_grain(nt, nt.pos(), "#D6B081", "#B18B5F", 4.0)
        natural = nt.vl("builtin_natural")["Fac"]
        nt.set(base=nt.mix(natural, nt.vl("builtin")["Color"], wood), rough=nt.maprange(natural, 0.0, 1.0, 0.35, 0.5),
               coat=nt.maprange(natural, 0.0, 1.0, 0.2, 0.35))
        nt.b.inputs["Coat Roughness"].default_value = 0.1
        grain = nt.math("MULTIPLY", fibers, nt.maprange(natural, 0.0, 1.0, 0.25, 1.0))
        nt.link(nt.bump(grain, 0.08, 0.0004), nt.b.inputs["Normal"])
        return nt.m
    return mat("builtin", b)


def m_cab(key, name, k, rough, coat):
    """Cabinet steel in the planner's color; k lightens the doors a little against the carcass."""
    def b():
        nt = NT(name)
        c = nt.vl("cab")["Color"]
        nt.set(base=nt.scale(c, k) if k != 1.0 else c, rough=rough, coat=coat)
        nt.b.inputs["Coat Roughness"].default_value = 0.08
        nt.link(nt.bump(nt.noise(nt.pos(), 320.0, 5.0).outputs["Fac"], 0.02, 0.0004), nt.b.inputs["Normal"])
        return nt.m
    return mat(key, b)


def m_slat():
    def b():
        nt = NT("Slatwall panels")
        nt.set(base=nt.vl("slat")["Color"], rough=0.4)
        return nt.m
    return mat("slat", b)


def m_paint(key, name, hexcol, rough=0.45, coat=0.0, peel=0.02):
    def b():
        nt = NT(name)
        p = nt.pos()
        nt.set(base=hexcol, rough=rough, coat=coat)
        nt.b.inputs["Coat Roughness"].default_value = 0.08
        if peel:
            nt.link(nt.bump(nt.noise(p, 320.0, 5.0).outputs["Fac"], peel, 0.0004), nt.b.inputs["Normal"])
        return nt.m
    return mat(key, b)


def m_galv():
    def b():
        nt = NT("Galvanized steel")
        p = nt.pos()
        sp = nt.voronoi(p, 28.0)
        r = nt.maprange(sp.outputs["Color"], 0.0, 1.0, 0.22, 0.42)
        nt.set(base="#B9BEC3", metal=1.0, rough=r)
        return nt.m
    return mat("galv", b)


def m_emit(key, name, kelvin, strength, base="#FFFFFF", color=None):
    def b():
        nt = NT(name)
        nt.set(base=base, rough=0.4)
        if color:
            nt.b.inputs["Emission Color"].default_value = lin(color)
        else:
            bb = nt.n("ShaderNodeBlackbody")
            bb.inputs["Temperature"].default_value = kelvin
            nt.link(bb.outputs["Color"], nt.b.inputs["Emission Color"])
        nt.b.inputs["Emission Strength"].default_value = strength
        return nt.m
    return mat(key, b)


def m_glass():
    def b():
        nt = NT("Window glass")
        nt.set(base="#FFFFFF", rough=0.0, trans=1.0, ior=1.5)
        return nt.m
    return mat("glass", b)


def m_clear_plastic():
    """Thin tote walls: see-through face-on, more reflective toward grazing angles. A refractive solid would
    leave the contents unlit, since Cycles skips the caustic paths that light them."""
    def b():
        nt = NT("Clear tote plastic")
        nt.set(base="#E9EEF0", rough=0.12, ior=1.49)
        see = nt.n("ShaderNodeBsdfTransparent")
        see.inputs["Color"].default_value = (0.9, 0.93, 0.94, 1)
        lw = nt.n("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.35
        mix = nt.n("ShaderNodeMixShader")
        nt.link(nt.maprange(lw.outputs["Fresnel"], 0.0, 1.0, 0.1, 0.85), mix.inputs[0])
        nt.link(see.outputs["BSDF"], mix.inputs[1])
        nt.link(nt.b.outputs["BSDF"], mix.inputs[2])
        nt.link(mix.outputs["Shader"], nt.out.inputs["Surface"])
        return nt.m
    return mat("clearplastic", b)


def m_image(key, name, file, rough=0.6, uvscale=None, metal=0.0, alpha=False, emit=0.0, extension="REPEAT"):
    def b():
        nt = NT(name)
        tx = nt.image(os.path.join(TEX, file), uvscale=uvscale, extension=extension)
        nt.set(base=tx.outputs["Color"], rough=rough, metal=metal)
        if alpha:
            nt.link(tx.outputs["Alpha"], nt.b.inputs["Alpha"])
        if emit:
            nt.link(tx.outputs["Color"], nt.b.inputs["Emission Color"])
            nt.b.inputs["Emission Strength"].default_value = emit
        return nt.m
    return mat(key, b)


def m_pvc():
    def b():
        nt = NT("Trusscore PVC wall boards")
        p = nt.pos()
        sep = nt.n("ShaderNodeSeparateXYZ")
        nt.link(p, sep.inputs[0])
        board = 16 / 12 * FT
        ph = nt.math("FRACT", nt.math("DIVIDE", sep.outputs["Z"], board))
        groove = nt.maprange(nt.math("MINIMUM", ph, nt.math("SUBTRACT", 1.0, ph)), 0.0, 0.012, 0.0, 1.0)
        half = nt.maprange(nt.math("ABSOLUTE", nt.math("SUBTRACT", ph, 0.5)), 0.0, 0.004, 0.6, 1.0)
        h = nt.math("MULTIPLY", groove, half)
        nt.set(base="#F7F7F3", rough=0.32)
        nt.link(nt.bump(h, 0.9, 0.0025), nt.b.inputs["Normal"])
        return nt.m
    return mat("pvc", b)


def m_tire():
    def b():
        nt = NT("Tire rubber")
        p = nt.pos()
        v = nt.voronoi(p, 260.0)
        nt.set(base="#141516", rough=0.78)
        nt.link(nt.bump(v.outputs["Distance"], 0.5, 0.0008), nt.b.inputs["Normal"])
        return nt.m
    return mat("tire", b)


def m_fabric(key, hexcol):
    def b():
        nt = NT(f"Fabric · {key}")
        p = nt.pos()
        nt.set(base=hexcol, rough=0.9)
        nt.b.inputs["Sheen Weight"].default_value = 0.6
        nt.link(nt.bump(nt.noise(p, 900.0, 2.0).outputs["Fac"], 0.2, 0.0003), nt.b.inputs["Normal"])
        return nt.m
    return mat("fabric_" + key, b)


def P(hexcol, rough=0.45, metal=0.0, coat=0.0):
    """Plain plastic/painted material, cached by its parameters."""
    return m_simple(f"Plastic {hexcol} r{rough} m{metal} c{coat}", hexcol, rough, metal, coat)


# ─── mesh builder ─────────────────────────────────────────────────────────
class MB:
    """Accumulates primitives (in web feet, through a frame) into one Blender object."""

    def __init__(self, name, group, frame=I4):
        self.name = name
        self.coll = sub(group)
        self.fr = frame
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.verify()
        self.mats = []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _tag(self, verts, m):
        mi = self._mi(m)
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = mi

    def M(self, local, fr=None):
        return TOBL @ (self.fr if fr is None else fr) @ local

    def box(self, x0, x1, y0, y1, z0, z1, m, fr=None):
        c = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
        s = (max(abs(x1 - x0), 1e-4), max(abs(y1 - y0), 1e-4), max(abs(z1 - z0), 1e-4))
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=self.M(T(*c) @ SC(*s), fr), calc_uvs=True)
        self._tag(r["verts"], m)
        return self

    def cyl(self, local, r, h, m, seg=16, fr=None, caps=True):
        """three.js CylinderGeometry: along local Y, centered on the local origin."""
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r, radius2=r,
                                    depth=h, matrix=self.M(local @ RX(-math.pi / 2), fr), calc_uvs=True)
        self._tag(res["verts"], m)
        return self

    def cyl_v(self, x, z, y0, y1, r, m, seg=24, fr=None):
        return self.cyl(T(x, (y0 + y1) / 2, z), r, y1 - y0, m, seg, fr)

    def cyl_x(self, x0, x1, y, z, r, m, seg=16, fr=None):
        return self.cyl(T((x0 + x1) / 2, y, z) @ RZ(math.pi / 2), r, x1 - x0, m, seg, fr)

    def cyl_z(self, x, y, z0, z1, r, m, seg=20, fr=None):
        return self.cyl(T(x, y, (z0 + z1) / 2) @ RX(math.pi / 2), r, z1 - z0, m, seg, fr)

    def tube(self, a, b, r, m, seg=8, fr=None):
        a, b = Vector(a), Vector(b)
        d = b - a
        q = Vector((0, 1, 0)).rotation_difference(d.normalized())
        return self.cyl(T(*((a + b) / 2)) @ q.to_matrix().to_4x4(), r, d.length, m, seg, fr)

    def sphere(self, x, y, z, r, m, seg=18, scale=(1, 1, 1), fr=None, local=None):
        L = (local if local is not None else T(x, y, z)) @ SC(*scale) @ RX(-math.pi / 2)
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=max(8, seg // 2), radius=r,
                                        matrix=self.M(L, fr), calc_uvs=True)
        self._tag(res["verts"], m)
        return self

    def dome(self, x, y, z, r, m, seg=20, rings=8, scale=(1, 1, 1), fr=None):
        """Upper hemisphere, open at the bottom (a helmet shell)."""
        Mx = self.M(T(x, y, z) @ SC(*scale), fr)
        bm = self.bm
        top = bm.verts.new(Mx @ Vector((0, r, 0)))
        rings_v = []
        for i in range(1, rings + 1):
            th = (math.pi / 2) * i / rings
            rings_v.append([bm.verts.new(Mx @ Vector((r * math.sin(th) * math.cos(2 * math.pi * k / seg), r * math.cos(th),
                                                       r * math.sin(th) * math.sin(2 * math.pi * k / seg)))) for k in range(seg)])
        faces = []
        for k in range(seg):
            faces.append(bm.faces.new((top, rings_v[0][(k + 1) % seg], rings_v[0][k])))
        for i in range(rings - 1):
            a, c = rings_v[i], rings_v[i + 1]
            for k in range(seg):
                faces.append(bm.faces.new((a[k], a[(k + 1) % seg], c[(k + 1) % seg], c[k])))
        mi = self._mi(m)
        for f in faces:
            f.material_index = mi
            f.smooth = True
        return self

    def torus(self, local, R, r, m, seg=40, rseg=8, fr=None):
        """three.js TorusGeometry: ring in the local XY plane."""
        Mx = self.M(local, fr)
        bm = self.bm
        rings = []
        for i in range(seg):
            u = 2 * math.pi * i / seg
            rings.append([bm.verts.new(Mx @ Vector(((R + r * math.cos(2 * math.pi * j / rseg)) * math.cos(u),
                                                     (R + r * math.cos(2 * math.pi * j / rseg)) * math.sin(u),
                                                     r * math.sin(2 * math.pi * j / rseg)))) for j in range(rseg)])
        mi = self._mi(m)
        for i in range(seg):
            for j in range(rseg):
                f = bm.faces.new((rings[i][j], rings[(i + 1) % seg][j], rings[(i + 1) % seg][(j + 1) % rseg], rings[i][(j + 1) % rseg]))
                f.material_index = mi
                f.smooth = True
        return self

    def quad(self, local, w, h, m, fr=None):
        """three.js PlaneGeometry: w x h in the local XY plane, facing +Z, with 0..1 UVs."""
        Mx = self.M(local, fr)
        pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
        vs = [self.bm.verts.new(Mx @ Vector((x, y, 0))) for x, y in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self._mi(m)
        for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[self.uv].uv = uv
        return self

    def slab(self, local, w, h, t, rad, m, fr=None, seg=6):
        """Rounded rectangle w x h in local XY, extruded along +Z by t (three.js ExtrudeGeometry)."""
        Mx = self.M(local, fr)
        rad = min(rad, w / 2 - 1e-4, h / 2 - 1e-4)
        outline = []
        for cx, cy, a0 in ((w / 2 - rad, -h / 2 + rad, -90), (w / 2 - rad, h / 2 - rad, 0), (-w / 2 + rad, h / 2 - rad, 90), (-w / 2 + rad, -h / 2 + rad, 180)):
            for k in range(seg + 1):
                a = math.radians(a0 + 90 * k / seg)
                outline.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
        bot = [self.bm.verts.new(Mx @ Vector((x, y, 0))) for x, y in outline]
        top = [self.bm.verts.new(Mx @ Vector((x, y, t))) for x, y in outline]
        mi = self._mi(m)
        faces = [self.bm.faces.new(list(reversed(bot))), self.bm.faces.new(top)]
        n = len(outline)
        for i in range(n):
            faces.append(self.bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i])))
        for f in faces:
            f.material_index = mi
        return self

    def done(self, bevel=0.0, smooth=35.0, segments=2):
        if not self.bm.verts:
            self.bm.free()
            return None
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        lo = Vector((min(v.co.x for v in me.vertices), min(v.co.y for v in me.vertices), min(v.co.z for v in me.vertices)))
        hi = Vector((max(v.co.x for v in me.vertices), max(v.co.y for v in me.vertices), max(v.co.z for v in me.vertices)))
        c = (lo + hi) / 2
        me.transform(Matrix.Translation(-c))
        if smooth:
            me.shade_smooth()
            me.set_sharp_from_angle(angle=math.radians(smooth))
        ob = bpy.data.objects.new(self.name, me)
        ob.location = c
        self.coll.objects.link(ob)
        if bevel > 0:
            bv = ob.modifiers.new("Bevel", "BEVEL")
            bv.width = bevel
            bv.segments = segments
            bv.limit_method = "ANGLE"
            bv.angle_limit = math.radians(50)
            bv.harden_normals = True
        return ob


def curve(name, group, pts, radius, m, fr=I4, kind="NURBS", closed=False):
    """A round tube along a path (cables, springs, curved door tracks)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius * FT
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new(kind)
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        w = TOBL @ fr @ Vector((q[0], q[1], q[2], 1.0))
        p.co = (w.x, w.y, w.z, 1.0)
    if kind == "NURBS":
        sp.order_u = min(4, len(pts))
        sp.use_endpoint_u = True
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    ob.data.materials.append(m)
    sub(group).objects.link(ob)
    return ob


def area_light(name, p_web, size, size_y, watts, kelvin=4100, rot=None):
    li = bpy.data.lights.new(name, "AREA")
    li.shape = "RECTANGLE"
    li.size, li.size_y = size * FT, size_y * FT
    li.energy = watts
    li.color = gp.blackbody(kelvin)
    ob = bpy.data.objects.new(name, li)
    ob.location = to_bl(p_web)
    if rot is not None:
        ob.rotation_euler = rot
    ob.visible_camera = False
    sub("lights").objects.link(ob)
    return ob


# ─── props (ported from src/app.js) ───────────────────────────────────────
def bike(name, group, frame, frame_hex, accent_hex, rack=False, mtb=False, bars_turn=0.0):
    b = MB(name, group, frame)
    R, wb = 1.1, 3.45
    mF, mA = m_paint("bike_" + frame_hex, f"Bike paint {frame_hex}", frame_hex, rough=0.25, coat=1.0, peel=0), P(accent_hex, 0.35, 0.2, 0.5)
    tire, alu, steel, blk = m_tire(), P("#C5C9CD", 0.25, 1.0), P("#9EA3A8", 0.3, 1.0), P("#1C1D1F", 0.5)
    for x in (0.0, wb):
        b.torus(T(x, 0, 0), R - 0.07, 0.085 if mtb else 0.06, tire, seg=48, rseg=10)
        b.torus(T(x, 0, 0), R - 0.155, 0.03, alu, seg=48, rseg=6)
        b.cyl_z(x, 0, -0.12, 0.12, 0.055, alu, seg=12)
        for k in range(32):
            a = 2 * math.pi * k / 32
            side = 0.1 if k % 2 else -0.1
            hub = Vector((x + 0.06 * math.cos(a + (0.6 if k % 4 < 2 else -0.6)), 0.06 * math.sin(a + (0.6 if k % 4 < 2 else -0.6)), side))
            rim = Vector((x + (R - 0.17) * math.cos(a), (R - 0.17) * math.sin(a), side * 0.15))
            b.tube(hub, rim, 0.006, steel, seg=4)
    V = lambda x, y, z=0.0: (x, y, z)
    BB, ST, HT, HB = V(1.35, -0.05), V(1.05, 1.5), V(2.85, 1.35), V(2.98, 0.9)
    b.tube(BB, ST, 0.055, mF, 14).tube(ST, HT, 0.05, mF, 14).tube(BB, HB, 0.064, mF, 14).tube(HB, HT, 0.07, mF, 14)
    for s in (1, -1):
        b.tube(BB, V(0, 0, 0.07 * s), 0.03, mF, 10).tube(V(1.1, 1.3, 0.04 * s), V(0, 0, 0.07 * s), 0.028, mF, 10)
        b.tube(HB, V(wb, 0, 0.07 * s), 0.055 if mtb else 0.035, mA, 12)
    b.tube(ST, V(0.98, 1.95), 0.035, alu, 12)
    b.slab(T(0.96, 2.0, -0.14), 0.75, 0.3, 0.12, 0.12, blk)
    SB = V(2.75, 1.85)
    b.tube(HT, SB, 0.042, blk, 12)
    pv = T(*SB) @ RY(bars_turn)
    b.cyl(pv @ RX(math.pi / 2), 0.036, 2.1, blk, 12)
    for zz in (0.9, -0.9):
        b.cyl(pv @ T(0, 0, zz) @ RX(math.pi / 2), 0.055, 0.3, P("#2A2B2D", 0.8), 12)
    b.torus(T(BB[0], BB[1], 0.13), 0.34, 0.03, steel, seg=32, rseg=6)
    b.tube(V(BB[0], BB[1], 0.16), V(BB[0] + 0.25, BB[1] - 0.5, 0.16), 0.03, blk).tube(V(BB[0], BB[1], -0.16), V(BB[0] - 0.25, BB[1] + 0.5, -0.16), 0.03, blk)
    b.box(BB[0] + 0.15, BB[0] + 0.45, BB[1] - 0.56, BB[1] - 0.5, 0.1, 0.3, blk)
    if rack:
        for s in (1, -1):
            b.tube(V(-0.25, 1.1, 0.12 * s), V(0.95, 1.2, 0.12 * s), 0.022, blk).tube(V(0, 0, 0.12 * s), V(-0.2, 1.1, 0.12 * s), 0.02, blk)
    return b.done(smooth=40)


def helmet(b, x, y, z, hexcol):
    b.dome(x, y, z, 0.42, P(hexcol, 0.3, 0.1, 0.6), scale=(1, 0.85, 1.15))


def ball(b, x, y, z, key, r=0.39):
    b.sphere(x, y, z, r, m_image("ball_" + key, f"Ball {key}", f"{key}.png", rough=0.6), seg=24)


def football(b, x, y, z):
    b.sphere(x, y, z, 0.28, P("#6E3A1E", 0.55), seg=20, scale=(1.55, 1, 1))


def claw(b, x, y):
    blk = P("#1C1D1F", 0.5)
    b.box(x - 0.08, x + 0.08, y - 0.1, y + 0.1, 0, 0.12, blk)
    b.tube((x, y, 0.1), (x - 0.28, y + 0.12, 0.42), 0.025, blk).tube((x, y, 0.1), (x + 0.28, y + 0.12, 0.42), 0.025, blk)


def skateboard(b, x, yc, length=2.65, deck="#1C1D1F"):
    b.slab(T(x, yc, 0.08), 0.7, length, 0.05, 0.34, P(deck, 0.7))
    for dy in (-length * 0.32, length * 0.32):
        for dx in (-0.22, 0.22):
            b.cyl_z(x + dx, yc + dy, 0.0, 0.08, 0.1, P("#D9D4C4", 0.4), seg=12)


def lacrosse(b, x, y0, y1, z=0.12):
    b.tube((x, y0, z), (x + 0.05, y1 - 0.5, z), 0.035, P("#1C1D1F", 0.4))
    b.torus(T(x + 0.05, y1 - 0.2, z) @ SC(0.7, 1.25, 1), 0.28, 0.03, P("#E9E9E6", 0.5), seg=24, rseg=6)


def bag(b, x, y, z, hexcol="#1D1F22", s=1.0):
    b.sphere(x, y, z, 0.45 * s, m_fabric(hexcol, hexcol), seg=16, scale=(0.9, 1.25, 0.45))


def rake(b, s, d, y_top=5.55):
    wood, red = m_wood("handle", "Tool handle wood", "#D9B77E", "#B8905A", rough=0.5, scale=10), P("#C8262B", 0.45)
    b.tube((s, y_top, d), (s, 2.75, d), 0.035, wood, 10)
    for i in range(13):
        a = -0.65 + i * (1.3 / 12)
        b.tube((s, 2.75, d), (s + math.sin(a) * 0.95, 2.75 - math.cos(a) * 0.95, d), 0.018, red, 5)
    b.tube((s - 0.45, 2.3, d), (s + 0.45, 2.3, d), 0.02, red, 5)


def shovel(b, s, d, y_top=5.45):
    wood = m_wood("handle", "Tool handle wood", "#D9B77E", "#B8905A", rough=0.5, scale=10)
    b.tube((s, y_top, d), (s, 2.6, d), 0.035, wood, 10)
    b.box(s - 0.18, s + 0.18, y_top - 0.02, y_top + 0.08, d - 0.03, d + 0.03, P("#1C1D1F", 0.5))
    b.slab(T(s, 2.15, d - 0.015), 0.7, 0.95, 0.03, 0.25, P("#6F757B", 0.35, 0.8))


def push_broom(b, s, d, y_top):
    wood = m_wood("handle", "Tool handle wood", "#D9B77E", "#B8905A", rough=0.5, scale=10)
    b.tube((s, y_top, d), (s, 2.3, d), 0.035, wood, 10)
    b.box(s - 0.95, s + 0.95, 2.05, 2.3, d - 0.12, d + 0.12, P("#1C1D1F", 0.8))


def tote_clear(b, x0, x1, y0, y1, z0, z1, lid="#2B2E33", seed=0):
    b.box(x0, x1, y0, y1 - 0.08, z0, z1, m_clear_plastic())
    b.box(x0 - 0.02, x1 + 0.02, y1 - 0.08, y1, z0 - 0.02, z1 + 0.02, P(lid, 0.4))
    stuff = ["#5B6F86", "#A0773F", "#6C7A53", "#8A4B4B"][seed % 4]
    b.box(x0 + 0.12, x1 - 0.12, y0 + 0.02, y0 + (y1 - y0) * 0.55, z0 + 0.12, z1 - 0.12, m_fabric(stuff, stuff))
    r = (x1 - x0) * 0.22
    b.box((x0 + x1) / 2 - r, (x0 + x1) / 2 + r, y1 - 0.34, y1 - 0.2, z1, z1 + 0.01, P("#F7F7F4", 0.8))


def hdx(b, x0, x1, y0, z0, z1):
    b.box(x0, x1, y0, y0 + 1.05, z0, z1, P("#1E2023", 0.45))
    b.box(x0 - 0.03, x1 + 0.03, y0 + 1.05, y0 + 1.16, z0 - 0.03, z1 + 0.03, P("#E6BA38", 0.4))


def ev_charger(group, x, y, z):
    b = MB("EV charger", group)
    b.box(x - 0.36, x + 0.36, y, y + 0.98, z, z + 0.3, P("#F4F4F1", 0.3))
    b.box(x - 0.3, x + 0.3, y + 0.1, y + 0.88, z + 0.3, z + 0.315, P("#E4E6E3", 0.15, 0, 0.8))
    b.sphere(x, y + 0.72, z + 0.32, 0.03, m_emit("ledgreen", "Status LED green", 0, 8.0, base="#3DDC6A", color="#3DDC6A"), seg=8)
    b.box(x + 0.42, x + 0.6, y - 0.28, y - 0.08, z - 0.02, z + 0.1, P("#1C1D1F", 0.5))
    b.done(bevel=0.004)
    pts = [(x, y, z + 0.15), (x + 0.05, y - 0.7, z + 0.3), (x + 0.25, y - 1.45, z + 0.36), (x + 0.48, y - 1.75, z + 0.3),
           (x + 0.6, y - 1.15, z + 0.2), (x + 0.5, y - 0.2, z + 0.12)]
    curve("EV charger cable", group, pts, 0.035, P("#2B2D30", 0.55))


# ─── base: structure shared by every plan ─────────────────────────────────
def build_base():
    option("Base")
    b = MB("Floor · flake epoxy", "floor")
    b.box(0, W, -0.25, 0, 0, D, m_floor()).done(bevel=0)
    b = MB("Ground outside", "exterior")
    b.box(-T_WALL - 8, W + T_WALL + 8, -0.95, -0.02, -T_WALL - 8, D + T_WALL + 16, m_concrete("slab", "Driveway concrete")).done()
    MB("Ceiling", "ceiling").box(-T_WALL, W + T_WALL, H, H + 0.25, -T_WALL, D + T_WALL, m_ceiling()).done()
    MB("Beam", "free").box(0, W, BEAM_Y, H, BEAM_Z - 0.36, BEAM_Z + 0.36, m_ceiling()).done(bevel=0.004)
    steel, dark = m_paint("colpaint", "Column paint, gray", "#8C9196", rough=0.45, coat=0.1), P("#34373C", 0.5, 0.4)
    b = MB("Steel column", "free")
    b.cyl_v(COL_X, BEAM_Z, 0, BEAM_Y, 0.146, steel, 32)
    b.cyl_v(COL_X, BEAM_Z, 0, 0.05, 0.32, dark, 32).cyl_v(COL_X, BEAM_Z, BEAM_Y - 0.06, BEAM_Y, 0.3, dark, 32)
    b.done(bevel=0.003)
    build_window()
    build_house_door()
    build_garage_doors()
    build_mechanics()
    build_kayak()
    build_west_tools()
    build_bump_gear()
    b = MB("Curb drip edge", "west")
    b.box(0, CURB_T + 0.03, CURB_H - 0.02, CURB_H + 0.03, 0, D, m_galv()).done()
    build_outlets()
    b = MB("Conduit", "gear")
    b.box(W * 0.15, W * 0.85, H - 0.07, H - 0.01, 3.2, 3.27, m_galv()).done()


def build_outlets():
    plate, slot = P("#F2F1EC", 0.35), P("#3A3B3D", 0.6)

    def outlet(b, x, y, switch=False):
        b.box(x - 0.115, x + 0.115, y - 0.19, y + 0.19, 0, 0.02, plate)
        if switch:
            b.box(x - 0.025, x + 0.025, y - 0.06, y + 0.06, 0.02, 0.05, plate)
        else:
            for dy in (-0.07, 0.07):
                b.box(x - 0.05, x + 0.05, y + dy - 0.04, y + dy + 0.04, 0.02, 0.035, P("#EDEBE4", 0.4))
                b.box(x - 0.03, x - 0.02, y + dy - 0.015, y + dy + 0.02, 0.035, 0.037, slot).box(x + 0.02, x + 0.03, y + dy - 0.02, y + dy + 0.02, 0.035, 0.037, slot)
    e = MB("Outlets and switches (house-door wall)", "east", WALL["east"])
    outlet(e, HD["z1"] + 0.4, 3.9, switch=True)
    outlet(e, HD["z1"] + 0.7, 3.9, switch=True)
    outlet(e, 14.5, 1.3)
    e.box(HD["z1"] + 1.02, HD["z1"] + 1.22, 4.45, 4.75, 0, 0.06, P("#EDEBE4", 0.4)).box(HD["z1"] + 1.07, HD["z1"] + 1.17, 4.55, 4.65, 0.06, 0.08, P("#D9D6CE", 0.35))
    e.done(bevel=0.002)
    w = MB("Outlets (window wall)", "west", WALL["west"])
    outlet(w, 12.0, 3.2)
    outlet(w, 18.5, 3.2)
    w.done(bevel=0.002)
    bb = MB("Outlet (bump-out)", "bump", WALL["bumpW"])
    outlet(bb, 3.2, 1.3)
    bb.done(bevel=0.002)


def build_window():
    w, zA, zB, c = WIN, D - WIN["s1"], D - WIN["s0"], 0.28
    trim = m_paint("trim", "Painted trim, white", "#F3F2EE", rough=0.4)
    b = MB("Window", "west")
    b.box(-T_WALL, 0, w["y0"], w["y0"] + 0.04, zA, zB, trim).box(-T_WALL, 0, w["y1"] - 0.04, w["y1"], zA, zB, trim)
    b.box(-T_WALL, 0, w["y0"], w["y1"], zA, zA + 0.04, trim).box(-T_WALL, 0, w["y0"], w["y1"], zB - 0.04, zB, trim)
    f0, f1, ym = -0.29, -0.17, (w["y0"] + w["y1"]) / 2
    b.box(f0, f1, w["y0"], w["y0"] + 0.2, zA, zB, trim).box(f0, f1, w["y1"] - 0.16, w["y1"], zA, zB, trim)
    b.box(f0, f1 + 0.04, ym - 0.07, ym + 0.07, zA, zB, trim)
    b.box(f0, f1, w["y0"], w["y1"], zA, zA + 0.15, trim).box(f0, f1, w["y0"], w["y1"], zB - 0.15, zB, trim)
    b.box(0, 0.05, w["y0"], w["y1"] + c, zA - c, zA, trim).box(0, 0.05, w["y0"], w["y1"] + c, zB, zB + c, trim)
    b.box(0, 0.05, w["y1"], w["y1"] + c, zA - c, zB + c, trim)
    b.box(0, 0.2, w["y0"] - 0.07, w["y0"], zA - c - 0.08, zB + c + 0.08, trim)
    b.box(0, 0.04, w["y0"] - 0.34, w["y0"] - 0.07, zA - c, zB + c, trim)
    b.done(bevel=0.003)
    g = MB("Window glass", "west")
    for (y0, y1) in ((w["y0"] + 0.2, ym - 0.07), (ym + 0.07, w["y1"] - 0.16)):
        g.box(-0.245, -0.235, y0, y1, zA + 0.15, zB - 0.15, m_glass())
    g.done()
    # the view outside: your photo of the yard, lit like daylight
    v = MB("Yard view (photo)", "window view")
    v.quad(T(-3.2, (w["y0"] + w["y1"]) / 2 + 0.3, (zA + zB) / 2) @ RY(math.pi / 2), 7.0, 6.0,
           m_image("yardview", "Yard view", "window-view.jpg", rough=1.0, emit=2.2, extension="EXTEND"))
    v.done(smooth=0)
    area_light("Daylight through the window", (-0.8, (w["y0"] + w["y1"]) / 2, (zA + zB) / 2), w["y1"] - w["y0"], zB - zA,
               220, kelvin=6800, rot=(0, math.radians(-90), 0))


def build_house_door():
    z0, z1, top = HD["z0"], HD["z1"], HD["top"]
    l0, l1 = z0 + 0.3, z1 - 0.3
    casing = m_paint("casing", "Door casing, cream", "#E9E4D8", rough=0.45)
    b = MB("House door frame and step", "east")
    b.box(W - 0.08, W, 0, top + 0.28, z0, l0, casing).box(W - 0.08, W, 0, top + 0.28, l1, z1, casing)
    b.box(W - 0.08, W, top, top + 0.28, z0, z1, casing)
    b.box(W, W + 0.05, STEP_H, top, l0, l0 + 0.05, casing).box(W, W + 0.05, STEP_H, top, l1 - 0.05, l1, casing)
    b.box(W - 0.34, W + 0.25, 0, STEP_H - 0.06, l0 - 0.05, l1 + 0.05, m_paint("step", "Step, painted white", "#ECEAE3", rough=0.55))
    b.box(W - 0.12, W + 0.22, STEP_H - 0.06, STEP_H, l0, l1, P("#B8BCC0", 0.35, 1.0))
    b.done(bevel=0.004)
    leaf = MB("House door (magnet board)", "east")
    board = m_image("doorboard", "Door face (your photo)", "door-board.jpg", rough=0.55, extension="EXTEND")
    leaf.quad(T(W - 0.001, (STEP_H + top) / 2, (l0 + l1) / 2) @ RY(-math.pi / 2), l1 - l0, top - STEP_H, board)
    leaf.box(W, W + 0.15, STEP_H + 0.02, top - 0.02, l0, l1, P("#7E858B", 0.45))
    leaf.done(bevel=0.003, smooth=0)
    k = MB("Door knob", "east")
    k.sphere(W - 0.09, STEP_H + 3.0, l0 + 0.3, 0.09, P("#C9CDD1", 0.2, 1.0), seg=16)
    k.cyl_x(W - 0.03, W, STEP_H + 3.0, l0 + 0.3, 0.12, P("#C9CDD1", 0.2, 1.0), 24)
    k.done()
    kp = MB("Garage keypads", "east", WALL["east"])
    for x in (z1 + 0.35, z1 + 0.68):
        kp.box(x - 0.12, x + 0.12, 4.45, 4.8, 0, 0.05, P("#1C1D1F", 0.35))
        kp.box(x - 0.08, x + 0.08, 4.62, 4.72, 0.05, 0.056, m_emit("screen", "Keypad screen", 0, 1.5, base="#4B8DF0", color="#4B8DF0"))
    kp.done(bevel=0.002)


def build_garage_doors():
    panel = m_paint("gdoor", "Garage door, white steel", "#F1F1ED", rough=0.32, coat=0.15, peel=0.012)
    galv, dark, rubber = m_galv(), P("#34373C", 0.5, 0.4), P("#141517", 0.85)
    spring = P("#2E3134", 0.4, 0.9)
    for idx, (x0, x1) in enumerate(DOORS):
        name = "west" if idx == 0 else "east"
        h, zf, cx = DOOR_H, D - 0.04, (x0 + x1) / 2
        b = MB(f"Garage door ({name} bay)", "front")
        for j in range(4):
            b.box(x0 - 0.08, x1 + 0.08, j * h / 4 + (0.012 if j else 0), (j + 1) * h / 4 - 0.012, zf - 0.13, zf, panel)
        b.box(x0 - 0.08, x1 + 0.08, 0, 0.06, zf - 0.15, zf + 0.02, rubber)
        b.box(x0 + 0.1, x1 - 0.1, h - 0.55, h - 0.43, zf - 0.2, zf - 0.13, galv)
        for j in (1, 2, 3):
            for xx in (x0 + 0.16, cx, x1 - 0.16):
                b.box(-0.13, 0.13, -0.13, 0.13, -0.015, 0.015, galv, fr=T(xx, h * j / 4, zf - 0.15) @ RZ(math.pi / 4))
        b.done(bevel=0.006)
        hw = MB(f"Door tracks and springs ({name} bay)", "front")
        for xx, sg in ((x0 - 0.13, -1), (x1 + 0.13, 1)):
            hw.box(xx - 0.05, xx + 0.05, 0, h + 0.1, zf - 0.34, zf - 0.14, galv)
            hw.box(xx - 0.05 + sg * 0.09, xx + 0.05 + sg * 0.09, 0.05, h + 0.05, zf - 0.14, zf - 0.02, galv)
        ys, zs = h + 0.72, zf - 0.3
        hw.cyl_x(x0 - 0.25, x1 + 0.25, ys, zs, 0.035, dark)
        for dx in (x0 - 0.13, x1 + 0.13):
            hw.cyl_x(dx - 0.09, dx + 0.09, ys, zs, 0.17, galv, 28)
        hw.box(cx - 0.12, cx + 0.12, ys - 0.3, ys + 0.2, zf - 0.1, zf - 0.02, galv)
        hw.done(bevel=0.003)
        for xx in (x0 - 0.13, x1 + 0.13):
            pts = [(xx, h + 0.1 + 0.45 * math.sin(a), zf - 0.24 - 0.61 * (1 - math.cos(a))) for a in [i * math.pi / 2 / 8 for i in range(9)]]
            curve(f"Curved track ({name} bay)", "front", pts, 0.06, galv, kind="POLY")
        for sx in (cx - 1.05, cx + 1.05):
            turns, n = 30, 30 * 16
            pts = [(sx - 0.9 + 1.8 * i / n, ys + 0.1 * math.cos(2 * math.pi * turns * i / n), zs + 0.1 * math.sin(2 * math.pi * turns * i / n)) for i in range(n + 1)]
            curve(f"Torsion spring ({name} bay)", "front", pts, 0.022, spring, kind="POLY")


def build_mechanics():
    galv, body, cover = m_galv(), P("#EDEDEA", 0.4), P("#3A3D41", 0.4)
    red = P("#C8262B", 0.45)
    lens = m_emit("openerlens", "Opener light lens", 3000, 0.0, base="#F4F1E8")
    for idx, (x0, x1) in enumerate(DOORS):
        name = "west" if idx == 0 else "east"
        b = MB(f"Door opener and rail ({name} bay)", "gear")
        cx = (x0 + x1) / 2
        for x in (x0 - 0.13, x1 + 0.13):
            b.box(x - 0.05, x + 0.05, 7.5, 7.62, D - 9.9, D - 0.85, galv)
            b.box(x - 0.04, x + 0.04, 7.62, H, D - 9.75, D - 9.65, galv)
        b.box(cx - 0.06, cx + 0.06, 7.5, 7.64, D - 10.1, D - 0.35, galv)
        b.box(cx - 0.58, cx + 0.58, 7.36, 7.92, D - 11.55, D - 10.1, body)
        b.box(cx - 0.6, cx + 0.6, 7.92, 7.99, D - 11.57, D - 10.08, cover)
        b.box(cx - 0.42, cx + 0.42, 7.33, 7.37, D - 11.3, D - 10.4, lens)
        for dx in (-0.62, 0.56):
            b.box(cx + dx, cx + dx + 0.06, 7.96, H, D - 10.9, D - 10.8, galv)
        b.box(cx - 0.12, cx + 0.12, 7.42, 7.52, D - 1.55, D - 1.1, galv)
        b.tube((cx, 7.45, D - 1.3), (cx, 6.88, D - 0.22), 0.035, galv)
        b.tube((cx, 7.42, D - 1.3), (cx, 6.1, D - 1.3), 0.01, red, 5)
        b.box(cx - 0.05, cx + 0.05, 5.92, 6.12, D - 1.35, D - 1.25, red)
        b.box(cx - 0.12, cx + 0.12, 7.3, 7.7, D - 0.12, D, galv)
        b.done(bevel=0.004)


def build_kayak():
    z0, z1 = 0.7, BEAM_Z - 0.7
    zc = (z0 + z1) / 2
    blk = P("#1C1D1F", 0.5)
    b = MB("Kayak", "west")
    b.sphere(1.45, 7.46, zc, 1.0, P("#F2C230", 0.28, 0, 0.4), seg=40, scale=(1.05, 0.28, (z1 - z0) / 2))
    b.torus(T(1.45, 7.73, zc + 0.6) @ RX(math.pi / 2) @ SC(1, 1.7, 1), 0.55, 0.05, blk, seg=28)
    b.slab(T(1.45, 7.76, zc - 1.2) @ RX(-math.pi / 2), 1.0, 3.0, 0.08, 0.4, P("#E8751A", 0.4))
    b.done()
    r = MB("Kayak and ski racks", "west")
    for z in (z0 + 1.4, z1 - 1.4):
        r.box(0.3, 0.38, 7.1, H, z - 0.05, z + 0.05, blk).box(2.52, 2.6, 7.1, H, z - 0.05, z + 0.05, blk)
        r.box(0.3, 2.6, 7.1, 7.18, z - 0.06, z + 0.06, blk)
    for z in (zc - 1.6, zc + 1.6):
        r.box(2.7, 3.55, 7.66, 7.7, z - 0.06, z + 0.06, blk)
        r.box(2.72, 2.78, 7.7, H, z - 0.03, z + 0.03, blk).box(3.47, 3.53, 7.7, H, z - 0.03, z + 0.03, blk)
    for i, col in enumerate(("#C8262B", "#1D1F22", "#2A62C9")):
        x = 2.85 + i * 0.22
        for dx in (-0.06, 0.06):
            r.box(x + dx - 0.05, x + dx + 0.05, 7.72 - i * 0.02, 7.76 - i * 0.02, zc - 2.7, zc + 2.7, P(col, 0.3, 0, 0.5))
    r.done(bevel=0.003)


def build_west_tools():
    b = MB("Tool board, leaf blower, cord reel, snow shovel", "west", WALL["west"])
    b.box(0.35, 2.85, 6.0, 6.42, 0, 0.07, m_wood("cleat", "Stained pine board", "#A77B51", "#7E5634", rough=0.55))
    b.box(0.45, 1.95, 6.42, 6.46, 0.02, 0.7, P("#F2F2F0", 0.4))
    b.tube((0.95, 3.85, 0.3), (1.9, 5.7, 0.3), 0.09, P("#1C1D1F", 0.45), 16)
    b.box(1.7, 2.15, 5.4, 5.95, 0.12, 0.52, P("#B3261E", 0.4))
    b.tube((1.75, 5.95, 0.32), (2.1, 6.05, 0.32), 0.04, P("#1C1D1F", 0.45))
    b.cyl_z(2.4, 5.15, 0.08, 0.42, 0.42, P("#EF7D1A", 0.4), 40)
    b.cyl_z(2.4, 5.15, 0.42, 0.46, 0.2, P("#2C2E31", 0.5), 24)
    b.tube((0.8, 6.2, 0.12), (0.8, 2.5, 0.3), 0.045, P("#1D4FA8", 0.35), 12)
    b.box(0.35, 1.25, 1.74, 2.55, 0.26, 0.34, P("#1C1D1F", 0.6))
    b.box(10.6, 11.0, 4.2, 4.65, 0, 0.12, P("#F4F3EF", 0.4))
    b.sphere(10.8, 4.5, 0.125, 0.025, m_emit("ledgreen", "Status LED green", 0, 8.0, base="#3DDC6A", color="#3DDC6A"), seg=8)
    b.box(10.77, 10.83, 2.35, 4.2, 0, 0.05, m_galv()).box(10.65, 10.95, 1.95, 2.35, 0, 0.1, P("#F4F3EF", 0.4))
    b.done(bevel=0.004)


def build_bump_gear():
    fr = WALL["bumpW"]
    b = MB("Wire shelf, beach chairs, backpack cooler", "bump", fr)
    white, frame_m = P("#F2F2F0", 0.35), P("#B9BDC2", 0.3, 0.9)
    for i in range(24):
        x = 0.25 + i * (BD - 0.55) / 23
        b.box(x - 0.01, x + 0.01, 6.5, 6.53, 0, 1.0, white)
    b.box(0.2, BD - 0.25, 6.5, 6.53, 0.97, 1.0, white).box(0.2, BD - 0.25, 6.5, 6.53, 0.0, 0.03, white)
    b.cyl_x(0.2, BD - 0.25, 6.55, 1.0, 0.02, white, 8)
    for s in (0.55, BD - 0.6):
        b.tube((s, 6.5, 0.98), (s, 5.95, 0.02), 0.02, white, 6)
    b.box(0.35, BD - 0.35, 6.05, 6.15, 0, 0.06, white)
    stripes = m_image("stripes", "Beach chair fabric", "stripes.png", rough=0.85, uvscale=(3, 6))
    for i in range(3):
        x0, x1, y0, y1, z = 0.45 + i * 0.1, 1.95 + i * 0.1, 3.1 + i * 0.05, 6.0, 0.08 + i * 0.18
        b.box(x0, x0 + 0.06, y0, y1, z, z + 0.08, frame_m).box(x1 - 0.06, x1, y0, y1, z, z + 0.08, frame_m)
        b.box(x0, x1, y1 - 0.06, y1, z, z + 0.08, frame_m).box(x0, x1, y0, y0 + 0.06, z, z + 0.08, frame_m)
        b.box(x0 + 0.06, x1 - 0.06, y0 + 0.4, y1 - 0.1, z + 0.02, z + 0.06, stripes)
    b.box(0.95, 1.95, 3.9, 5.65, 0.72, 1.32, m_image("floral", "Backpack cooler fabric", "floral.png", rough=0.8, uvscale=(2, 2)))
    b.box(0.9, 2.0, 5.55, 5.72, 0.9, 1.1, frame_m).box(1.2, 1.7, 3.55, 3.9, 0.9, 1.25, P("#F2C230", 0.4))
    b.cyl_x(0.5, 2.6, 6.83, 0.5, 0.3, m_fabric("#2C62B8", "#2C62B8"), 24)
    helmet(b, 3.25, 6.53, 0.45, "#1D1F22")
    b.slab(T(BD / 2, 6.56, 0.55) @ RX(-math.pi / 2), 4.1, 0.95, 0.04, 0.46, P("#E9E9E6", 0.3, 0, 0.5))
    b.done(bevel=0.003)
    g = MB("Corner guard", "bump")
    wood = m_wood("lightwood", "Light pine", "#EAD5B3", "#CDAE82", rough=0.55)
    g.box(X1 - 0.06, X1, 1.4, 4.3, BD - 0.28, BD + 0.06, wood).box(X1, X1 + 0.28, 1.4, 4.3, BD, BD + 0.06, wood)
    g.done(bevel=0.003)


# ─── walls: one collection per finish ─────────────────────────────────────
FINISHES = {  # base color, band color, grime near the floor, roughness (paint takes its colors from the view layer)
    "asis": ("#EFEEE8", None, 0.9, 0.85),
    "paint": ("#CCC9C0", "#585858", 0.15, 0.62),
    "pvc": (None, None, 0.0, 0.3),
}


def build_walls(key):
    hexcol, band, grime, rough = FINISHES[key]
    title = option(gp.collection("finish", key)).name
    wm = m_pvc() if key == "pvc" else m_wall("wall_" + key, f"Wall · {title}", hexcol, band=band, grime=grime, rough=rough,
                                             swatch=key == "paint")
    zA, zB, w = D - WIN["s1"], D - WIN["s0"], WIN
    b = MB("West wall", "west")
    b.box(-T_WALL, 0, CURB_H, H, -T_WALL, zA, wm).box(-T_WALL, 0, CURB_H, H, zB, D + T_WALL, wm)
    b.box(-T_WALL, 0, CURB_H, w["y0"], zA, zB, wm).box(-T_WALL, 0, w["y1"], H, zA, zB, wm)
    b.done(smooth=0)
    MB("Back wall", "back").box(0, X1, BACK_H, H, -T_WALL, 0, wm).done(smooth=0)
    MB("Bump-out", "bump").box(X1, W + T_WALL, -0.25, H, -T_WALL, BD, wm).done(smooth=0)
    l0, l1 = HD["z0"] + 0.3, HD["z1"] - 0.3
    b = MB("East wall", "east")
    b.box(W, W + T_WALL, -0.25, H, BD, l0, wm).box(W, W + T_WALL, -0.25, H, l1, D + T_WALL, wm)
    b.box(W, W + T_WALL, HD["top"], H, l0, l1, wm)
    b.done(smooth=0)
    pier = (m_wood("pier", "Stained pier cladding", "#7A4A2A", "#5A3219", rough=0.55) if key == "asis" else
            (m_paint("pvctrim", "PVC trim, white", "#F7F7F3", rough=0.32) if key == "pvc" else wm))
    b = MB("Front wall and pier", "front")
    (d1, d2) = DOORS
    b.box(-T_WALL, d1[0], -0.25, H, D, D + T_WALL, wm).box(d2[1], W + T_WALL, -0.25, H, D, D + T_WALL, wm)
    b.box(-T_WALL, W + T_WALL, DOOR_H, H, D, D + T_WALL, wm)
    b.done(smooth=0)
    MB("Center pier", "front").box(d1[1], d2[0], -0.25, DOOR_H, D, D + T_WALL, pier).done(bevel=0.003)
    if key == "asis":
        dm = MB("Water damage at the base", "bump", WALL["bumpW"])
        dm.quad(T(BD - 0.9, 0.31, 0.008), 1.7, 0.62, m_decal())
        dm.done(smooth=0)
    else:
        cove = P("#3A3D41", 0.55)
        c = MB("Vinyl cove base", "east")
        c.box(W - 0.03, W, 0, 0.33, BD, HD["z0"], cove).box(W - 0.03, W, 0, 0.33, HD["z1"], D - 1.2, cove)
        c.done(bevel=0.002)
        c = MB("Vinyl cove base (bump-out)", "bump")
        c.box(X1 - 0.03, X1, 0, 0.33, 0, BD, cove).box(X1, W, 0, 0.33, BD, BD + 0.03, cove)
        c.done(bevel=0.002)


def m_decal():
    def b():
        nt = NT("Water damage (decal)")
        tx = nt.image(os.path.join(TEX, "damage.png"), extension="CLIP")
        nt.set(base=tx.outputs["Color"], rough=0.9)
        nt.link(tx.outputs["Alpha"], nt.b.inputs["Alpha"])
        return nt.m
    return mat("decal", b)


CONCRETE = {"bare": None, "sealed": "#9A9EA3"}  # the planner recolors the sealed coat


def build_concrete(key):
    title, paint = gp.CONCRETE[key], CONCRETE[key]
    option(title)
    cm = m_concrete("conc_" + key, title, paint)
    MB("Curb under the window wall", "west").box(-T_WALL, CURB_T, -0.25, CURB_H, 0, D, cm).done(bevel=0.006)
    MB("Foundation wall (back)", "back").box(0, X1, -0.25, BACK_H, -T_WALL, 0, cm).done(smooth=0)
    MB("Concrete step (front corner)", "east").box(W - 0.7, W, -0.25, 1.05, D - 1.2, D, cm).done(bevel=0.01)


# ─── back-wall storage ────────────────────────────────────────────────────
PALETTE = ["#7A2E2A", "#232427", "#A58A62", "#3E5670", "#D5D2C9", "#5E6268", "#4B5B3C", "#A68D52", "#8B8F95", "#A58A62", "#9B4B2E", "#2E3B4A"]


class Rng:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def __call__(self):
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.s / 4294967296


def clutter(b, x0, x1, y0, y1, depth, r):
    x = x0 + 0.05
    while x < x1 - 0.3:
        w = min(x1 - 0.05 - x, 0.45 + r() * 1.05)
        h = min(y1 - y0 - 0.06, 0.3 + r() * 0.8)
        d = min(depth - 0.1, 0.55 + r() * 1.0)
        if r() < 0.2:
            n = 2 + int(r() * 3)
            for i in range(n):
                if x + (i + 1) * 0.3 >= x1:
                    break
                b.cyl_v(x + 0.15 + i * 0.3, 0.4 + r() * 0.5, y0, y0 + 0.35 + r() * 0.2, 0.13, P(PALETTE[int(r() * len(PALETTE))], 0.35), 16)
            x += n * 0.3 + 0.1
        else:
            col = PALETTE[int(r() * len(PALETTE))]
            b.box(x, x + w, y0, y0 + h, 0.06, 0.06 + d, m_fabric("cardboard", "#B89668") if col == "#B89668" else P(col, 0.45))
            x += w + 0.04 + r() * 0.15


def build_builtins(fresh):
    if fresh:
        pm = m_builtin()
    else:
        pm = m_wood("plyraw", "Plywood, raw", "#D6B081", "#B18B5F", rough=0.72)
    t, x0, xT, xE, dT, dU, dC = 0.06, 0.24, 4.3, X1 - 0.04, 1.75, 1.5, 1.85
    sx = lambda x: xT + (x - 4.3) * (xE - xT) / (15.96 - 4.3)
    xDiv = [sx(v) for v in (6.55, 8.05, 8.95, 10.9, 13.35)]
    xLeg = [sx(v) for v in (8.5, 10.9, 13.35)]
    xPeg = xDiv[4]
    r = Rng(31)
    b = MB("Built-in shelving (refreshed)" if fresh else "Built-in plywood shelving", "back")
    b.box(x0, x0 + t, 0, 6.72, 0, dT, pm).box(xT - t, xT, 0, 6.72, 0, dT, pm)
    ys = [0.32, 1.27, 2.22, 3.14, 4.3, 5.5, 6.72]
    for i in range(len(ys) - 1):
        b.box(x0 + t, xT - t, ys[i] - t, ys[i], 0, dT - 0.04, pm)
    if fresh:
        b.box(xT, xDiv[3], 3.02, 3.14, 0, dC, pm)
        b.box(xDiv[3], xE, 2.99, 3.17, 0, dC + 0.1, m_butcher())
    else:
        b.box(xT, xE, 3.02, 3.14, 0, dC, pm)
    for y in (4.3, 5.5):
        b.box(xT, xPeg, y - t, y, 0, dU, pm)
    for x in xDiv:
        b.box(x - t / 2, x + t / 2, 3.14, 6.72, 0, dU, pm)
    b.box(xE - t, xE, 3.14, 6.72, 0, dU, pm)
    for x in xLeg + [xE - t / 2]:
        b.box(x - t / 2, x + t / 2, 0, 3.02, 0.04, dC, pm)
    b.box(x0, xE, 6.72, 6.84, 0, 1.95, pm).box(x0, xE, 6.56, 6.72, 1.89, 1.95, pm)
    b.box(xDiv[1], xDiv[2], 3.14, 6.72, dU - 0.02, dU + 0.03, pm)
    b.done(bevel=0.004)
    ev_charger("back", (xDiv[1] + xDiv[2]) / 2, 4.55, dU + 0.03)
    pb = MB("Tool pegboard", "back")
    peg = m_image("pegTall", "Metal pegboard with tools", "pegTall.png", rough=0.5, metal=0.3, extension="EXTEND") if fresh else \
        m_image("peg", "Pegboard with tools", "peg.png", rough=0.8, extension="EXTEND")
    pb.quad(T((xPeg + t / 2 + xE - t) / 2, (3.14 + 6.72) / 2, 0.045), xE - t - xPeg - t / 2, 6.72 - 3.14, peg)
    pb.box(xPeg + t / 2, xE - t, 3.14, 6.72, 0, 0.04, P("#8C6A45", 0.8))
    pb.done(smooth=0)
    cubbies = [(x0 + t, xT - t, ys[i], ys[i + 1] - t, dT) for i in range(len(ys) - 1)]
    for a, c in ((xT, xDiv[0]), (xDiv[0], xDiv[1]), (xDiv[2], xDiv[3]), (xDiv[3], xPeg)):
        for (y0, y1) in ((3.14, 4.24), (4.3, 5.44), (5.5, 6.66)):
            cubbies.append((a + t / 2, c - t / 2, y0, y1, dU))
    st = MB("Shelf contents (totes)" if fresh else "Shelf contents", "back")
    k = 0
    for (a, c, y0, y1, dep) in cubbies:
        if fresh:
            w = 1.25
            n = max(1, int((c - a - 0.08) // (w + 0.1)))
            gap = (c - a - n * w) / (n + 1)
            hh = min(0.95, y1 - y0 - 0.1)
            for i in range(n):
                xa = a + gap + i * (w + gap)
                tote_clear(st, xa, xa + w, y0, y0 + hh, 0.12, dep - 0.1, seed=k)
                k += 1
        else:
            clutter(st, a, c, y0, y1, dep, r)
    if fresh:
        st.box(xE - 1.7, xE - 0.3, 3.17, 3.62, 0.3, 1.0, P("#C8262B", 0.35, 0.2))
        for i in range(4):
            tote_clear(st, x0 + 0.3 + i * 2.35, x0 + 2.3 + i * 2.35, 6.84, 7.7, 0.15, 1.75, seed=i)
        for i in range(2):
            tote_clear(st, x0 + 9.8 + i * 2.35, x0 + 11.8 + i * 2.35, 6.84, 7.7, 0.15, 1.75, seed=i + 2)
    else:
        st.box(xE - 1.7, xE - 0.3, 3.14, 3.6, 0.3, 1.0, P("#C8262B", 0.35, 0.2))
        st.cyl_x(1.3, 4.6, 7.27, 0.9, 0.42, m_fabric("#3D5A36", "#3D5A36"), 24)
        st.box(4.8, 7.9, 6.84, 7.4, 0.2, 1.6, m_fabric("cardboard", "#B89668"))
        st.cyl_z(8.5, 7.2, 0.3, 1.7, 0.34, P("#1C1D1F", 0.4), 28)
        st.box(9.1, 10.5, 6.84, 7.55, 0.2, 1.5, m_clear_plastic())
        st.box(12.1, 13.5, 6.84, 7.45, 0.2, 1.5, m_fabric("cardboard", "#B89668"))
        st.cyl_x(13.9, 15.5, 7.14, 0.8, 0.3, m_fabric("#2C62B8", "#2C62B8"), 20)
        st.box(5.1, 5.3, 0.5, 3.0, 0, 0.12, m_wood("cleat", "Stained pine board", "#A77B51", "#7E5634", rough=0.55))
        st.box(5.17, 5.23, 0.6, 2.9, 0.12, 0.14, m_galv())
    st.done(bevel=0.004)
    if fresh:
        led = MB("LED strip under the top shelf", "back")
        led.box(x0 + 0.2, xE - 0.2, 6.52, 6.56, 1.6, 1.78, m_emit("ledstrip", "LED strip", 5000, 18.0))
        led.done()
        area_light("LED strip light", (xE / 2 + 0.1, 6.5, 1.7), xE - 0.6, 0.15, 60, kelvin=5000, rot=None)


def m_butcher():
    def b():
        nt = NT("Butcher block, birch")
        p = nt.pos()
        br = nt.n("ShaderNodeTexBrick")
        nt.link(p, br.inputs["Vector"])
        br.inputs["Scale"].default_value = 1.0
        br.inputs["Mortar Size"].default_value = 0.0015
        br.inputs["Brick Width"].default_value = 0.9
        br.inputs["Row Height"].default_value = 0.045
        br.inputs["Color1"].default_value = lin("#D8B886")
        br.inputs["Color2"].default_value = lin("#C69E68")
        br.inputs["Mortar"].default_value = lin("#8E6A40")
        n = nt.noise(p, 40.0, 3.0)
        col = nt.mix(nt.maprange(n.outputs["Fac"], 0.3, 0.7, 0.0, 0.25), br.outputs["Color"], lin("#A57A48"))
        nt.set(base=col, rough=0.42, coat=0.3)
        return nt.m
    return mat("butcher", b)


def build_racks():
    dark = m_paint("powderblk", "Powder-coated steel, black", "#2A2D31", rough=0.42, coat=0.1)
    for i, x0 in enumerate((0.3, 4.45)):
        b = MB(f"Steel shelving unit {i + 1} (Husky 48 × 24 × 78)", "back")
        for x in (x0, x0 + 3.92):
            for z in (0.05, 1.97):
                b.box(x, x + 0.08, 0, 6.5, z, z + 0.08, dark)
        for j, y in enumerate((0.3, 1.8, 3.3, 4.8, 6.3)):
            b.box(x0, x0 + 4, y - 0.08, y, 0.05, 2.05, dark)
        b.done(bevel=0.004)
        c = MB(f"Totes on shelving unit {i + 1}", "back")
        for j, y in enumerate((0.3, 1.8, 3.3, 4.8, 6.3)):
            if j < 4:
                hdx(c, x0 + 0.2, x0 + 2.7, y, 0.2, 1.9)
                c.box(x0 + 2.85, x0 + 3.8, y, y + 0.7, 0.3, 1.6, P("#2F5FA8", 0.4) if j % 2 else m_fabric("cardboard", "#B89668"))
            else:
                c.box(x0 + 0.3, x0 + 3.2, y, y + 0.7, 0.2, 1.8, m_fabric("cardboard", "#B89668"))
        c.done(bevel=0.006)
    bx0, bx1 = X1 - 6.1, X1 - 0.1
    ev_x = (8.45 + bx0) / 2
    bk = MB("Charger backer board", "back")
    bk.box(ev_x - 0.55, ev_x + 0.55, 3.9, 5.75, 0, 0.06, m_paint("backer", "Painted plywood backer", "#D9D6CF", rough=0.6)).done(bevel=0.003)
    ev_charger("back", ev_x, 4.35, 0.06)
    wb = MB("Workbench (Husky 6 ft, wood top)", "back")
    wb.box(bx0, bx1, 2.95, 3.1, 0.05, 2.05, m_butcher())
    for x in (bx0 + 0.1, bx1 - 0.18):
        for z in (0.12, 1.9):
            wb.box(x, x + 0.08, 0, 2.95, z, z + 0.08, dark)
    wb.box(bx0 + 0.1, bx1 - 0.1, 0.45, 0.52, 0.2, 1.9, dark)
    hdx(wb, bx0 + 0.4, bx0 + 2.9, 0.52, 0.3, 1.8)
    hdx(wb, bx0 + 3.2, bx0 + 5.7, 0.52, 0.3, 1.8)
    wb.box(bx1 - 1.6, bx1 - 0.3, 3.1, 3.55, 0.3, 1.0, P("#C8262B", 0.35, 0.2))
    wb.done(bevel=0.004)
    px0 = bx0 + 0.35
    px1 = px0 + 5.33
    pg = MB("Wall Control pegboard and shelf", "back")
    pg.quad(T((px0 + px1) / 2, (3.55 + 6.22) / 2, 0.052), px1 - px0, 6.22 - 3.55,
            m_image("pegWide", "Metal pegboard with tools (wide)", "pegWide.png", rough=0.5, metal=0.3, extension="EXTEND"))
    pg.box(px0, px1, 3.55, 6.22, 0, 0.05, P("#A9AEB3", 0.4, 0.6))
    pg.box(px0, px1, 6.45, 6.52, 0, 0.95, dark)
    for i, col in enumerate(("#C8262B", "#2F5FA8", "#1D1F22", "#C9A54A", "#3F6B3A")):
        pg.box(px0 + 0.2 + i * 1.02, px0 + 0.95 + i * 1.02, 6.52, 6.95, 0.15, 0.8, P(col, 0.4))
    pg.box(px0 + 0.1, px1 - 0.1, 6.4, 6.44, 0.5, 0.85, m_emit("ledstrip", "LED strip", 5000, 18.0))
    pg.done(bevel=0.003, smooth=0)
    area_light("Bench light", ((px0 + px1) / 2, 6.38, 0.7), px1 - px0 - 0.4, 0.2, 45, kelvin=5000)


def build_cabinets():
    X = X1 - 0.05
    f = X / 15.95
    s = lambda x: x * f
    body = m_cab("cab_body", "Cabinet steel", 1.0, rough=0.38, coat=0.25)
    door = m_cab("cab_door", "Cabinet doors", 1.28, rough=0.3, coat=0.35)
    top = m_paint("stainless", "Stainless worktop", "#C9CDD1", rough=0.22, peel=0)
    MAT["stainless"].node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 1.0
    MAT["stainless"].node_tree.nodes["Principled BSDF"].inputs["Anisotropic"].default_value = 0.6
    chrome = P("#D5D8DB", 0.18, 1.0)
    blk = P("#141517", 0.6)
    b = MB("Garage cabinets (NewAge Bold 3.0 style)", "back")

    def handle(x, y0, y1, z):
        b.box(x - 0.025, x + 0.025, y0, y1, z, z + 0.06, chrome)

    def locker(a, c):
        b.box(a + 0.08, c - 0.08, 0, 0.25, 0.1, 1.45, blk)
        b.box(a, c, 0.25, 6.75, 0.05, 1.55, body)
        b.box(a + 0.03, c - 0.03, 0.3, 6.7, 1.55, 1.6, door)
        handle(c - 0.18, 3.1, 4.3, 1.6)

    def base(a, c):
        b.box(a + 0.08, c - 0.08, 0, 0.25, 0.1, 1.45, blk)
        b.box(a, c, 0.25, 2.95, 0.05, 1.55, body)
        b.box(a + 0.03, c - 0.03, 2.35, 2.9, 1.55, 1.6, door)
        m = (a + c) / 2
        b.box(a + 0.03, m - 0.015, 0.3, 2.3, 1.55, 1.6, door).box(m + 0.015, c - 0.03, 0.3, 2.3, 1.55, 1.6, door)
        b.box(m - 0.3, m + 0.3, 2.6, 2.65, 1.6, 1.66, chrome)
        handle(m - 0.12, 1.7, 2.2, 1.6)
        handle(m + 0.12, 1.7, 2.2, 1.6)

    def wall(a, c):
        b.box(a, c, 5.25, 7.6, 0.05, 1.15, body)
        m = (a + c) / 2
        b.box(a + 0.03, m - 0.015, 5.3, 7.55, 1.15, 1.2, door).box(m + 0.015, c - 0.03, 5.3, 7.55, 1.15, 1.2, door)
        handle(m - 0.12, 5.4, 5.9, 1.2)
        handle(m + 0.12, 5.4, 5.9, 1.2)

    locker(s(0.3), s(2.3))
    locker(s(2.35), s(4.35))
    base(s(4.45), s(6.45))
    base(s(6.5), s(8.5))
    base(s(11.0), s(13.45))
    base(s(13.5), s(15.95))
    b.box(s(4.45), s(8.5), 2.95, 3.08, 0.05, 1.75, top).box(s(11.0), s(15.95), 2.95, 3.08, 0.05, 1.75, top)
    for a, c in ((s(4.45), s(6.45)), (s(6.5), s(8.5)), (s(11.0), s(13.45)), (s(13.5), s(15.95))):
        wall(a, c)
    b.done(bevel=0.006)
    led = MB("Under-cabinet LEDs", "back")
    for a, c in ((s(4.45), s(8.5)), (s(11.0), s(15.95))):
        led.box(a + 0.1, c - 0.1, 5.2, 5.24, 0.6, 1.0, m_emit("ledstrip", "LED strip", 5000, 18.0))
        area_light("Under-cabinet light", ((a + c) / 2, 5.18, 0.8), c - a - 0.3, 0.3, 35, kelvin=5000)
    led.done()
    pg = MB("Pegboard backsplash", "back")
    pg.quad(T((s(11.05) + s(15.9)) / 2, (3.3 + 5.1) / 2, 0.045), s(15.9) - s(11.05), 1.8,
            m_image("pegStrip", "Metal pegboard backsplash", "pegStrip.png", rough=0.5, metal=0.3, extension="EXTEND"))
    pg.box(s(11.05), s(15.9), 3.3, 5.1, 0, 0.04, P("#A9AEB3", 0.4, 0.6))
    pg.done(smooth=0)
    ev_x = s(9.75)
    MB("Charger backer board", "back").box(ev_x - 0.55, ev_x + 0.55, 3.9, 5.75, 0, 0.06, m_paint("backer", "Painted plywood backer", "#D9D6CF", rough=0.6)).done(bevel=0.003)
    ev_charger("back", ev_x, 4.35, 0.06)


SHELVES = ("asis", "refresh", "racks", "cabinets")


def build_shelves(key):
    option(gp.collection("shelves", key))
    if key == "asis":
        build_builtins(False)
    elif key == "refresh":
        build_builtins(True)
    elif key == "racks":
        build_racks()
    else:
        build_cabinets()


# ─── bike wall ────────────────────────────────────────────────────────────
BIKE_SPECS = [dict(name="Bike · blue MTB", frame_hex="#1F4FA3", accent_hex="#E9E9E6", rack=True, mtb=True),
              dict(name="Bike · silver hybrid", frame_hex="#C9CCD0", accent_hex="#9AA0A6")]


def slatwall(group, frame, s0, s1, y0, y1, name):
    b = MB(name, group, frame)
    face, trim = m_slat(), P("#2F3236", 0.45)
    slat = 0.25
    y = y0
    while y < y1 - 1e-6:
        b.box(s0, s1, y + 0.03, min(y + slat, y1), 0.0, 0.06, face)
        b.box(s0, s1, y, y + 0.03, 0.0, 0.025, P("#1B1C1E", 0.7))
        y += slat
    b.box(s0 - 0.06, s0, y0 - 0.05, y1 + 0.05, 0, 0.08, trim).box(s1, s1 + 0.06, y0 - 0.05, y1 + 0.05, 0, 0.08, trim)
    b.box(s0, s1, y1, y1 + 0.05, 0, 0.08, trim).box(s0, s1, y0 - 0.05, y0, 0, 0.08, trim)
    return b.done(bevel=0.003)


def hang_flat(spec, rear, y, d, hooks_from=5.7):
    fr = WALL["west"] @ T(rear, y, d) @ RY(math.pi)
    bike(spec["name"], "west", fr, spec["frame_hex"], spec["accent_hex"], rack=spec.get("rack", False), mtb=spec.get("mtb", False), bars_turn=1.25)
    h = MB(spec["name"] + " hooks", "west", WALL["west"])
    for s in (rear - 1.25, rear - 2.45):
        h.box(s - 0.04, s + 0.04, hooks_from, hooks_from + 0.1, 0.05, d + 0.15, P("#1C1D1F", 0.5))
    h.done(bevel=0.002)


BIKES = ("asis", "steadyrack", "slatwall")


def build_bikes(key):
    option(gp.collection("bikes", key))
    fr = WALL["west"]
    if key == "asis":
        b = MB("Broom holder, push broom, bike cleat", "west", fr)
        b.box(7.55, 9.05, 5.95, 6.12, 0, 0.1, P("#F4F3EF", 0.4))
        for i in range(4):
            b.box(7.75 + i * 0.36, 7.88 + i * 0.36, 5.9, 6.1, 0.1, 0.2, P("#1C1D1F", 0.5))
        b.tube((9.02, 6.5, 0.1), (9.3, 1.97, 0.37), 0.035, m_wood("handle", "Tool handle wood", "#D9B77E", "#B8905A", rough=0.5, scale=10))
        b.box(8.65, 9.95, 1.73, 1.98, 0.24, 0.5, P("#1C1D1F", 0.8))
        b.box(10.9, D - 0.35, 5.55, 5.95, 0, 0.07, m_wood("cleat", "Stained pine board", "#A77B51", "#7E5634", rough=0.55))
        b.done(bevel=0.004)
        hang_flat(BIKE_SPECS[0], D - 6.45, 4.45, 0.36)
        hang_flat(BIKE_SPECS[1], D - 2.95, 3.95, 0.66)
        t = MB("Rake and shovel", "west", fr)
        rake(t, D - 7.4, 0.24)
        shovel(t, D - 5.1, 0.26)
        t.done()
    elif key == "steadyrack":
        t = MB("FastTrack rail with yard tools", "west", fr)
        t.box(7.3, 11.4, 5.2, 5.38, 0, 0.09, P("#B9BEC4", 0.3, 0.8))
        rake(t, 7.9, 0.26, 5.25)
        shovel(t, 9.05, 0.28, 5.2)
        push_broom(t, 10.45, 0.3, 5.25)
        t.done(bevel=0.003)
        basis = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        for s, spec in ((D - 7.6, BIKE_SPECS[0]), (D - 5.4, BIKE_SPECS[1])):
            pv = fr @ T(s, 0, 0.08) @ RY(0.62)
            r = MB(spec["name"] + " · Steadyrack", "west", fr)
            r.box(s - 0.22, s + 0.22, 6.2, 7.05, 0, 0.08, P("#1C1D1F", 0.5)).box(s - 0.18, s + 0.18, 2.2, 2.6, 0, 0.1, P("#1C1D1F", 0.5))
            for dx in (-0.12, 0.12):
                r.box(dx - 0.03, dx + 0.03, 6.72, 6.8, 0, 1.6, P("#1C1D1F", 0.5), fr=pv)
            r.box(-0.15, 0.15, 6.6, 6.72, 1.45, 1.6, P("#1C1D1F", 0.5), fr=pv)
            r.done(bevel=0.003)
            bike(spec["name"], "west", pv @ T(0, 2.45, 1.2) @ basis, spec["frame_hex"], spec["accent_hex"], rack=spec.get("rack", False), mtb=spec.get("mtb", False))
    else:
        slatwall("west", fr, 7.4, D - 1.9, 2.05, 6.05, "Slatwall")
        hang_flat(BIKE_SPECS[0], D - 6.45, 4.45, 0.36)
        hang_flat(BIKE_SPECS[1], D - 2.95, 3.95, 0.66)
        t = MB("Yard tools and basket on slatwall", "west", fr)
        rake(t, 7.95, 0.24, 5.6)
        shovel(t, 8.95, 0.26, 5.5)
        push_broom(t, 10.05, 0.3, 5.6)
        blk = P("#26282B", 0.4, 0.5)
        for i in range(10):
            x = 11.0 + i * 1.5 / 9
            t.box(x - 0.012, x + 0.012, 2.2, 3.1, 0.95, 1.0, blk)
        t.box(11.0, 12.5, 2.2, 2.23, 0.06, 1.0, blk).box(11.0, 12.5, 3.07, 3.1, 0.97, 1.0, blk)
        ball(t, 11.45, 2.62, 0.55, "ballOld", 0.36)
        helmet(t, 12.05, 2.55, 0.55, "#C8262B")
        t.done(bevel=0.003)


# ─── house-door wall ──────────────────────────────────────────────────────
DOORWALL = ("asis", "slatwall", "dropzone")


def build_doorwall(key):
    option(gp.collection("door", key))
    fr = WALL["east"]
    b = MB("Sports gear", "east", fr)
    wood = m_wood("lightwood", "Light pine", "#EAD5B3", "#CDAE82", rough=0.55)
    blk = P("#1C1D1F", 0.5)
    if key == "asis":
        b.box(9.0, 13.6, 5.45, 5.7, 0, 0.07, wood)
        for i, c in enumerate(("#C8262B", "#2A62C9", "#3F8A4A", "#F2C230", "#E8751A", "#C8262B", "#2A62C9", "#3F8A4A")):
            b.cyl_z(9.3 + i * 0.55, 5.57, 0.07, 0.3, 0.05, P(c, 0.4), 10)
        b.box(12.6, D - 1.2, 5.65, 5.95, 0, 0.07, wood)
        b.box(14.2, D - 1.4, 5.62, 5.72, 0.07, 0.1, blk)
        x = 14.4
        while x < D - 1.5:
            b.box(x - 0.02, x + 0.02, 5.45, 5.65, 0.08, 0.2, blk)
            x += 0.45
        helmet(b, 9.55, 4.8, 0.48, "#1D1F22")
        helmet(b, 10.35, 4.8, 0.48, "#D4E23A")
        claw(b, 9.45, 4.05)
        ball(b, 9.45, 4.1, 0.46, "ball")
        claw(b, 9.45, 3.3)
        football(b, 9.45, 3.32, 0.4)
        skateboard(b, 10.5, 3.75, 2.65)
        claw(b, 11.3, 4.15)
        for i in range(4):
            b.box(11.05 + i * 0.16, 11.13 + i * 0.16, 3.45, 3.62, 0, 0.18, blk)
        claw(b, 12.2, 4.2)
        ball(b, 12.2, 4.25, 0.46, "ballOld")
        skateboard(b, 12.95, 3.65, 3.0, "#2B2E33")
        helmet(b, 14.6, 5.05, 0.48, "#2B2E33")
        bag(b, 15.45, 4.8, 0.3)
        helmet(b, 16.3, 5.25, 0.48, "#C8262B")
        b.box(16.8, 17.35, 4.95, 5.5, 0.05, 0.12, P("#2A62C9", 0.4))
        lacrosse(b, D - 1.55, 2.4, 6.35)
        lacrosse(b, D - 1.35, 2.6, 6.2)
        b.done(bevel=0.003)
    elif key == "slatwall":
        slatwall("east", fr, 9.0, D - 1.1, 2.0, 6.0, "Sports slatwall")
        wire = P("#26282B", 0.4, 0.5)
        for i in range(12):
            x = 9.4 + i * 1.8 / 11
            b.box(x - 0.012, x + 0.012, 2.25, 3.65, 1.1, 1.15, wire)
        b.box(9.4, 11.2, 2.25, 2.28, 0.06, 1.15, wire)
        ball(b, 9.9, 2.66, 0.6, "ball")
        ball(b, 10.7, 2.66, 0.62, "ballOld")
        football(b, 10.3, 3.18, 0.55)
        for i, c in enumerate(("#1D1F22", "#D4E23A", "#2B2E33", "#C8262B")):
            x = 11.8 + i * 0.85
            b.box(x - 0.03, x + 0.03, 5.3, 5.4, 0.06, 0.3, blk)
            helmet(b, x, 4.85, 0.5, c)
        b.box(15.2, 16.8, 3.2, 3.3, 0.06, 0.55, blk)
        skateboard(b, 15.6, 4.0, 2.65)
        skateboard(b, 16.45, 3.95, 3.0, "#2B2E33")
        b.box(17.4, 19.2, 5.3, 5.36, 0.06, 0.9, blk)
        b.box(17.5, 18.3, 5.36, 5.85, 0.2, 0.8, P("#2F5FA8", 0.4)).box(18.4, 19.1, 5.36, 5.75, 0.2, 0.8, P("#C9A54A", 0.4))
        bag(b, 18.3, 4.35, 0.35)
        b.box(19.1, 19.6, 4.8, 5.3, 0.06, 0.12, P("#2A62C9", 0.4))
        lacrosse(b, D - 1.6, 2.4, 6.35, 0.2)
        lacrosse(b, D - 1.38, 2.6, 6.2, 0.2)
        b.done(bevel=0.003)
    else:
        b0, b1 = 8.6, 12.1
        fab = m_fabric("#6B7078", "#6B7078")
        b.box(b0, b1, 1.4, 1.55, 0, 1.3, wood).box(b0 + 0.05, b1 - 0.05, 1.55, 1.7, 0.05, 1.25, fab)
        for x in (b0, (b0 * 2 + b1) / 3, (b0 + b1 * 2) / 3, b1 - 0.07):
            b.box(x, x + 0.07, 0, 1.4, 0, 1.3, wood)
        b.box(b0, b1, 0.1, 0.16, 0, 1.3, wood)
        for i, c in enumerate(("#1D1F22", "#8B5A3C", "#2F5FA8")):
            a = b0 + 0.25 + i * 1.15
            b.box(a, a + 0.8, 0.16, 0.5, 0.25, 1.1, P(c, 0.6))
        b.box(b0, b1, 5.0, 5.3, 0, 0.07, wood).box(b0, b1, 5.75, 5.82, 0, 0.85, wood)
        for i in range(5):
            b.cyl_z(b0 + 0.35 + i * 0.7, 5.15, 0.07, 0.3, 0.04, blk, 10)
        bag(b, b0 + 1.05, 4.4, 0.35, "#2F5FA8")
        bag(b, b0 + 2.45, 4.35, 0.35, "#3F6B3A", 1.1)
        b.box(b0 + 0.3, b0 + 1.1, 5.82, 6.3, 0.15, 0.75, m_fabric("cardboard", "#B89668")).box(b0 + 1.3, b0 + 2.1, 5.82, 6.3, 0.15, 0.75, m_fabric("cardboard", "#B89668"))
        b.box(12.3, 14.4, 0, 0.05, 0.05, 1.3, P("#141517", 0.8))
        b.box(12.5, 13.1, 0.05, 0.4, 0.2, 1.0, P("#3A2C22", 0.7)).box(13.3, 13.9, 0.05, 0.36, 0.25, 1.05, P("#1D1F22", 0.7))
        b.box(14.8, D - 1.3, 4.9, 5.05, 0, 0.06, m_galv())
        wire = P("#26282B", 0.4, 0.5)
        for i in range(8):
            x = 15.0 + i * 1.3 / 7
            b.box(x - 0.012, x + 0.012, 2.1, 4.8, 0.9, 0.95, wire)
        for y in (2.1, 3.0, 3.9, 4.77):
            b.box(15.0, 16.3, y, y + 0.03, 0.06, 0.95, wire)
        ball(b, 15.65, 4.2, 0.5, "ball")
        ball(b, 15.65, 3.35, 0.5, "ballOld")
        football(b, 15.65, 2.55, 0.5)
        for i, c in enumerate(("#1D1F22", "#D4E23A", "#C8262B")):
            helmet(b, 16.9 + i * 0.75, 4.4, 0.48, c)
        skateboard(b, 19.1, 3.45, 2.65)
        skateboard(b, 19.9, 3.35, 3.0, "#2B2E33")
        lacrosse(b, D - 1.5, 2.4, 6.35)
        lacrosse(b, D - 1.3, 2.6, 6.2)
        b.done(bevel=0.003)


# ─── overhead, lighting, column ───────────────────────────────────────────
def build_overhead():
    option(gp.collection("overhead", "two"))
    deck, z0, z1 = 6.82, 2.35, BEAM_Z - 0.5
    dark = m_paint("powderblk", "Powder-coated steel, black", "#2A2D31", rough=0.42, coat=0.1)
    for i, (x0, x1) in enumerate(((W * 0.25, W * 0.25 + 4), (W * 0.54, W * 0.54 + 4))):
        b = MB(f"Ceiling rack {i + 1} (FLEXIMOUNTS 4 × 8)", "overhead")
        for k in range(17):
            x = x0 + k * (x1 - x0) / 16
            b.box(x - 0.012, x + 0.012, deck - 0.02, deck + 0.02, z0, z1, dark)
        for k in range(9):
            z = z0 + k * (z1 - z0) / 8
            b.box(x0, x1, deck - 0.025, deck + 0.015, z - 0.012, z + 0.012, dark)
        b.box(x0, x1, deck, deck + 0.12, z0, z0 + 0.08, dark).box(x0, x1, deck, deck + 0.12, z1 - 0.08, z1, dark)
        b.box(x0, x0 + 0.08, deck, deck + 0.12, z0, z1, dark).box(x1 - 0.08, x1, deck, deck + 0.12, z0, z1, dark)
        for x in (x0, x1 - 0.08):
            for z in (z0, (z0 + z1) / 2, z1 - 0.08):
                b.box(x, x + 0.08, deck, H, z, z + 0.08, dark)
        n, span = 3, (z1 - z0 - 0.3) / 3
        for j in range(n):
            a = z0 + 0.15 + j * span
            hdx(b, x0 + 1.1, x1 - 1.1, deck + 0.02, a + 0.1, a + span - 0.1)
        b.done(bevel=0.003)


LIGHTS = ("fluorescent", "led", "hex")


def build_lights(key):
    option(gp.collection("lights", key))
    zN = (1.9 + BEAM_Z - 0.6) / 2
    xs = (W * 0.2, W * 0.5, W * 0.8)
    housing = m_paint("fixture", "Fixture housing, white", "#F1F1EE", rough=0.35)
    if key == "fluorescent":
        lens = m_emit("fluor", "Fluorescent diffuser", 4400, 5.0, base="#FAFAF7")
        spots = [(x, zN) for x in xs] + [(W * 0.5, D - 6.5)]
        b = MB("Fluorescent fixtures", "fixtures")
        for x, z in spots:
            b.box(x - 0.3, x + 0.3, H - 0.26, H, z - 2, z + 2, housing)
            b.box(x - 0.26, x + 0.26, H - 0.3, H - 0.25, z - 1.95, z + 1.95, lens)
        b.done(bevel=0.006)
        for x, z in spots:
            area_light("Fluorescent fixture light", (x, H - 0.31, z), 0.5, 3.9, 68, kelvin=4400)
    else:
        bar = m_emit("ledbar", "LED shop light diffuser", 5000, 10.0, base="#FFFFFF")
        spots = [(x, zN) for x in xs]
        if key == "led":
            spots += [(x, D - 6.2) for x in (W * 0.125, W * 0.5, W * 0.875)]
        b = MB("LED shop lights", "fixtures")
        for x, z in spots:
            b.box(x - 0.13, x + 0.13, H - 0.12, H, z - 2, z + 2, housing)
            b.box(x - 0.1, x + 0.1, H - 0.14, H - 0.11, z - 1.95, z + 1.95, bar)
        b.done(bevel=0.004)
        for x, z in spots:
            area_light("LED shop light", (x, H - 0.15, z), 0.2, 3.9, 80, kelvin=5000)
        if key == "hex":
            hex_grid(3.0, W - 3.0, BEAM_Z + 2.2, D - 1.3)


def hex_grid(x0, x1, z0, z1):
    R, hw, y = 1.35, math.sqrt(3) * 1.35, H - 0.07
    cols = max(2, int((x1 - x0) // hw))
    rows = max(1, int((z1 - z0 - 2 * R) // (1.5 * R)) + 1)
    ox = x0 + (x1 - x0 - cols * hw) / 2 + hw / 2
    oz = z0 + (z1 - z0 - (rows - 1) * 1.5 * R - 2 * R) / 2 + R
    edges = {}
    bx = [1e9, -1e9, 1e9, -1e9]
    for r in range(rows):
        for c in range(cols):
            if r % 2 and c == cols - 1:
                continue
            cx, cz = ox + c * hw + (hw / 2 if r % 2 else 0), oz + r * 1.5 * R
            v = [(cx + R * math.cos(math.radians(60 * k - 30)), cz + R * math.sin(math.radians(60 * k - 30))) for k in range(6)]
            for k in range(6):
                a, b_ = v[k], v[(k + 1) % 6]
                key = tuple(sorted(((round(a[0], 2), round(a[1], 2)), (round(b_[0], 2), round(b_[1], 2)))))
                edges.setdefault(key, (a, b_))
                bx = [min(bx[0], a[0]), max(bx[1], a[0]), min(bx[2], a[1]), max(bx[3], a[1])]
    pad = 0.35
    frame = [((bx[0] - pad, bx[2] - pad), (bx[1] + pad, bx[2] - pad)), ((bx[1] + pad, bx[2] - pad), (bx[1] + pad, bx[3] + pad)),
             ((bx[1] + pad, bx[3] + pad), (bx[0] - pad, bx[3] + pad)), ((bx[0] - pad, bx[3] + pad), (bx[0] - pad, bx[2] - pad))]
    tube_m = m_emit("hex", "Hex LED tube", 6000, 8.0, base="#FFFFFF")
    b = MB("Hex LED grid", "fixtures")
    for (a, c) in list(edges.values()) + frame:
        ln = math.hypot(c[0] - a[0], c[1] - a[1])
        ang = -math.atan2(c[1] - a[1], c[0] - a[0])
        b.box(-ln / 2 - 0.05, ln / 2 + 0.05, -0.03, 0.03, -0.06, 0.06, tube_m, fr=T((a[0] + c[0]) / 2, y, (a[1] + c[1]) / 2) @ RY(ang))
    b.done(bevel=0.01)
    for (px, pz) in ((W * 0.3, D - 4.8), (W * 0.7, D - 4.8), (W * 0.5, BEAM_Z + 4)):
        area_light("Hex grid fill", (px, H - 0.2, pz), 4.0, 3.0, 85, kelvin=6000)


COLUMN = ("asis", "rope", "guard")


def build_column(key):
    option(gp.collection("column", key))
    b = MB("Column wrap", "free")
    if key == "asis":
        b.cyl_v(COL_X, BEAM_Z, 1.2, 4.45, 0.2, m_image("foam", "Foam and duct tape", "foam.png", rough=0.6, uvscale=(1, 1)), 32)
    elif key == "rope":
        b.cyl_v(COL_X, BEAM_Z, 0.12, 5.9, 0.215, m_image("rope", "Manila rope", "rope.png", rough=0.95, uvscale=(5, 22)), 40)
    else:
        b.cyl_v(COL_X, BEAM_Z, 0, 4.0, 0.34, P("#F2C230", 0.35, 0, 0.3), 40).cyl_v(COL_X, BEAM_Z, 4.0, 4.06, 0.345, P("#1C1D1F", 0.5), 40)
    b.done(bevel=0.004)


# ─── plans, cameras, render settings ──────────────────────────────────────
def setup_view_layers():
    """One view layer per plan, plus a cutaway twin; the planner switches their collections."""
    sc = bpy.context.scene
    for i, (name, _) in enumerate(gp.PLANS):
        if i == 0:
            sc.view_layers[0].name = name
        else:
            sc.view_layers.new(name)
        sc.view_layers.new(name + gp.CUT)
        gp.apply_layers(sc, name)
        gp.apply_colors(sc, name)
    gp.set_defaults(sc)
    return list(sc.view_layers)


def camera(name, p, t, lens, shift_y=0.0, ortho=None):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.sensor_width = 36
    cd.clip_start = 0.05
    cd.clip_end = 200
    cd.shift_y = shift_y
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    ob = bpy.data.objects.new(name, cd)
    loc, tgt = to_bl(p), to_bl(t)
    ob.location = loc
    ob.rotation_euler = (tgt - loc).to_track_quat("-Z", "Y").to_euler()
    cd.dof.use_dof = ortho is None
    cd.dof.focus_distance = (tgt - loc).length
    cd.dof.aperture_fstop = 5.6
    coll("Cameras", bpy.context.scene.collection).objects.link(ob)
    return ob


def setup_cameras():
    eye = 5.25
    n = {k: name for k, _, name in gp.CAMERAS}
    return {
        "doors": camera(n["doors"], (10.8, eye, D - 0.9), (9.6, eye, 0.0), 16.5, shift_y=0.02),
        "back": camera(n["back"], (4.2, eye, D - 5.2), (9.2, eye, 2.0), 19.0),
        "bikes": camera(n["bikes"], (W - 2.4, eye, 12.2), (0.0, eye, 7.2), 19.0),
        "entry": camera(n["entry"], (7.5, eye, 15.8), (W, eye, 9.8), 19.0),
        "toward_doors": camera(n["toward_doors"], (6.6, eye, 2.8), (11.0, eye, D), 16.5),
        "overview": camera(n["overview"], (W + 8.5, 19.5, D + 11.5), (W * 0.42, 1.2, D * 0.43), 26.0),
    }


def setup_render(samples=128, res=(1920, 1080)):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.device = "CPU"
    cy.samples = samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.015
    cy.use_denoising = True
    try:
        cy.denoiser = "OPENIMAGEDENOISE"
    except TypeError:
        pass
    cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 10, 5, 5
    cy.transmission_bounces, cy.transparent_max_bounces = 8, 8
    cy.caustics_reflective = cy.caustics_refractive = False
    cy.sample_clamp_indirect = 8.0
    cy.blur_glossy = 0.6
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "8"
    vs = sc.view_settings
    try:
        vs.view_transform = "AgX"
        vs.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    vs.exposure = -0.15
    cy.preview_samples = 64  # the Rendered viewport settles quickly
    cy.use_preview_denoising = True
    sc.unit_settings.system = "IMPERIAL"
    sc.unit_settings.length_unit = "FEET"
    world = bpy.data.worlds.new("Backdrop")  # night outside, or studio gray behind a cutaway (per view layer)
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Strength"].default_value = 1.0
    backdrop = world.node_tree.nodes.new("ShaderNodeAttribute")
    backdrop.attribute_type, backdrop.attribute_name = "VIEW_LAYER", gp.ATTR + "backdrop"
    world.node_tree.links.new(backdrop.outputs["Color"], bg.inputs["Color"])
    sc.world = world
    sc.use_nodes = True
    nt = sc.node_tree
    nt.nodes.clear()
    rl = nt.nodes.new("CompositorNodeRLayers")
    lens = nt.nodes.new("CompositorNodeLensdist")
    lens.use_fit = True
    lens.inputs["Dispersion"].default_value = 0.012
    mask = nt.nodes.new("CompositorNodeEllipseMask")
    mask.width, mask.height = 0.95, 0.95
    blur = nt.nodes.new("CompositorNodeBlur")
    blur.filter_type = "FAST_GAUSS"
    blur.use_relative = True
    blur.factor_x = blur.factor_y = 0.4
    blur.size_x = blur.size_y = 400
    vig = nt.nodes.new("CompositorNodeMixRGB")
    vig.blend_type = "MULTIPLY"
    vig.inputs["Fac"].default_value = 0.35
    comp = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(rl.outputs["Image"], lens.inputs["Image"])
    nt.links.new(mask.outputs["Mask"], blur.inputs["Image"])
    nt.links.new(lens.outputs["Image"], vig.inputs[1])
    nt.links.new(blur.outputs["Image"], vig.inputs[2])
    nt.links.new(vig.outputs["Image"], comp.inputs["Image"])


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    Ctx.root = coll("Garage", sc.collection)
    build_base()
    for k in FINISHES:
        build_walls(k)
    for k in CONCRETE:
        build_concrete(k)
    for k in SHELVES:
        build_shelves(k)
    for k in BIKES:
        build_bikes(k)
    for k in DOORWALL:
        build_doorwall(k)
    build_overhead()
    for k in LIGHTS:
        build_lights(k)
    for k in COLUMN:
        build_column(k)
    setup_render()
    layers = setup_view_layers()
    cams = setup_cameras()
    sc.camera = cams["doors"]
    gp.activate(sc, layers[0].name)
    embed_planner()
    setup_viewport()
    return layers, cams


def embed_planner():
    """Ship the planner panel inside the .blend. Blender runs a registered text block when the
    file opens, once the person allows scripts."""
    txt = bpy.data.texts.new("garage_planner.py")
    with open(os.path.join(HERE, "garage_planner.py"), encoding="utf-8") as f:
        txt.from_string(f.read())
    txt.use_module = True


def setup_viewport():
    """Open looking through the doors camera, in Material Preview, with the sidebar on the Garage tab."""
    screen = bpy.data.screens.get("Layout")
    for area in (screen.areas if screen else []):
        if area.type != "VIEW_3D":
            continue
        space = area.spaces.active
        space.shading.type = "MATERIAL"
        space.overlay.show_extras = False  # no camera and light outlines in the way
        try:
            space.shading.studio_light = "interior.exr"  # a neutral backdrop for Material Preview
        except TypeError:
            pass
        space.show_region_ui = True
        space.region_3d.view_perspective = "CAMERA"
        for region in area.regions:
            if region.type == "UI":
                try:
                    region.active_panel_category = "Garage"
                except (TypeError, AttributeError, ValueError):
                    pass


RENDERS = [  # in render order: the most useful stills first
    ("01-as-photographed-from-the-doors", "As photographed", "doors"),
    ("05-showroom-from-the-doors", "Showroom", "doors"),
    ("03-weekend-refresh-back-wall", "Weekend refresh", "back"),
    ("04-organized-from-the-doors", "Organized", "doors"),
    ("07-showroom-cutaway", "Showroom · cutaway", "overview"),
    ("02-as-photographed-back-wall", "As photographed", "back"),
    ("06-showroom-toward-the-doors", "Showroom", "toward_doors"),
]


def render_all(outdir, cams, only=None, samples=None, scale=100):
    sc = bpy.context.scene
    os.makedirs(outdir, exist_ok=True)
    if samples:
        sc.cycles.samples = samples
    sc.render.resolution_percentage = scale
    for fname, layer, cam in RENDERS:
        if only and not any(o in fname for o in only):
            continue
        for vl in sc.view_layers:
            vl.use = vl.name == layer
        cut = layer.endswith(gp.CUT)
        gp.activate(sc, layer)
        for node in sc.node_tree.nodes:
            if node.bl_idname == "CompositorNodeRLayers":
                node.layer = layer
            elif node.bl_idname == "CompositorNodeLensdist":
                # the cutaway's slab edges reach the frame corners, where fringing shows most
                node.inputs["Dispersion"].default_value = 0.004 if cut else 0.012
        sc.camera = cams[cam]
        sc.render.filepath = os.path.join(outdir, fname + ".png")
        bpy.ops.render.render(write_still=True, layer=layer)
        print("rendered", fname, flush=True)
    for vl in sc.view_layers:
        vl.use = True


# 360° panoramas for the web tour: (key, label, web position in feet, eye height 5.2 ft)
PANOS = [
    ("doors", "Garage doors", (9.5, 5.2, 18.8)),
    ("back", "Back wall", (10.6, 5.2, 5.6)),
    ("side", "House door", (14.2, 5.2, 10.8)),
]


def slug(text):
    return "".join(c if c.isalnum() else "-" for c in text.lower()).strip("-")


def render_panos(outdir, samples=24, width=4096, only=None):
    """Render an equirectangular panorama of every plan from every PANOS spot. The image's center
    faces the back wall (Blender +Y); its left and right edges meet facing the garage doors."""
    sc = bpy.context.scene
    os.makedirs(outdir, exist_ok=True)
    sc.cycles.samples = samples
    sc.render.resolution_x, sc.render.resolution_y = width, width // 2
    sc.render.resolution_percentage = 100
    sc.use_nodes = False  # no lens fringe or vignette: they would show as seams in a panorama
    for key, label, p in PANOS:
        cd = bpy.data.cameras.new("Pano · " + label)
        cd.type = "PANO"
        cd.panorama_type = "EQUIRECTANGULAR"
        cd.clip_start = 0.05
        ob = bpy.data.objects.new(cd.name, cd)
        ob.location = to_bl(p)
        ob.rotation_euler = (math.radians(90), 0, 0)
        sc.collection.objects.link(ob)
        for plan, _ in gp.PLANS:
            fname = f"{slug(plan)}-{key}"
            if only and not any(o in fname for o in only):
                continue
            for vl in sc.view_layers:
                vl.use = vl.name == plan
            gp.activate(sc, plan)
            sc.camera = ob
            sc.render.filepath = os.path.join(outdir, fname + ".png")
            bpy.ops.render.render(write_still=True, layer=plan)
            print("rendered", fname, flush=True)
    for vl in sc.view_layers:
        vl.use = True


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(HERE, "garage.blend"))
    ap.add_argument("--render", metavar="DIR", help="render the stills into DIR")
    ap.add_argument("--only", nargs="*", help="render only files whose name contains one of these")
    ap.add_argument("--samples", type=int)
    ap.add_argument("--scale", type=int, default=100, help="resolution percentage for renders")
    ap.add_argument("--res", default="1920x1080", help="render size, e.g. 1600x900")
    ap.add_argument("--no-save", action="store_true")
    ap.add_argument("--panos", metavar="DIR", help="render the 360° panoramas for the web tour into DIR")
    ap.add_argument("--pano-width", type=int, default=4096)
    ap.add_argument("--pano-samples", type=int, default=24)
    args = ap.parse_args(argv)
    _, cams = build()
    rx, ry = (int(v) for v in args.res.lower().split("x"))
    bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = rx, ry
    if not args.no_save:
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.out), compress=True)
        print("saved", args.out, flush=True)
    if args.render:
        render_all(args.render, cams, args.only, args.samples, args.scale)
    if args.panos:
        render_panos(args.panos, args.pano_samples, args.pano_width, args.only)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
