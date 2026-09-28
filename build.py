#!/usr/bin/env python3
"""Bundle the garage planner into single-file HTML, and build the photoreal tour.

    python3 build.py                      # writes index.html and tour.html (open either in a browser)
    python3 build.py --fragment OUT       # also writes the body-only planner page for the hosted artifact
    python3 build.py --tour-fragment OUT  # also writes the body-only tour page for its hosted artifact
    python3 build.py --panos DIR          # first imports panoramas rendered by blender/build_garage.py --panos DIR

src/garage.html holds the markup and CSS, src/app.js the script, and
src/assets/ the photo-derived images. Assets are inlined as data URIs, so the
output has no local file dependencies (three.js and the fonts load from CDNs).

src/tour.html is the 360° tour. Its panoramas live in tour/ as JPEGs, a
4096 × 2048 render plus a 1024 × 512 preview each; the page lists the ones there.
"""
import argparse
import base64
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
TOUR = ROOT / "tour"
PLANNER_URL = "https://claude.ai/artifact/5up8WHkrETmcXTX7hXCFN9"  # the hosted planner, linked from the hosted tour
TOUR_URL = "https://claude.ai/artifact/4bSj1ae3Lv4Rkora9AjArd"  # the hosted tour, linked from the hosted planner


def data_uri(name: str) -> str:
    path = SRC / "assets" / name
    mime = "image/png" if path.suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def fragment(tour_url: str = "tour.html") -> str:
    html = (SRC / "garage.html").read_text(encoding="utf-8")
    js = (SRC / "app.js").read_text(encoding="utf-8")
    html = html.replace("<!--APP_JS-->", "<script>\n" + js + "</script>").replace("%%TOUR_URL%%", tour_url)
    return re.sub(r"%%ASSET:([\w.-]+)%%", lambda m: data_uri(m.group(1)), html)


def standalone(frag: str) -> str:
    head, body = frag.split("<!--BODY-->", 1)
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        f"{head.strip()}\n</head>\n<body>\n{body.strip()}\n</body>\n</html>\n"
    )


def import_panos(src: pathlib.Path) -> None:
    """Convert rendered PNG panoramas to the tour's JPEGs: full size and a small preview."""
    from PIL import Image  # only needed here

    TOUR.mkdir(exist_ok=True)
    for png in sorted(src.glob("*.png")):
        im = Image.open(png).convert("RGB")
        im.save(TOUR / f"{png.stem}.jpg", quality=84, optimize=True, progressive=True)
        im.resize((1024, 512), Image.LANCZOS).save(TOUR / f"{png.stem}-preview.jpg", quality=78, optimize=True, progressive=True)
        print(f"tour/{png.stem}.jpg")


def panos() -> list:
    return sorted(p.stem for p in TOUR.glob("*.jpg") if not p.stem.endswith("-preview")
                  and (TOUR / f"{p.stem}-preview.jpg").exists())


def tour_fragment(planner_url: str) -> str:
    html = (SRC / "tour.html").read_text(encoding="utf-8")
    html = html.replace("/*PANOS*/[]/*END*/", "/*PANOS*/" + json.dumps(panos()) + "/*END*/")
    return html.replace("%%PLANNER_URL%%", planner_url)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fragment", type=pathlib.Path, help="also write the body-only artifact page here")
    ap.add_argument("--tour-fragment", type=pathlib.Path, help="also write the body-only tour page here")
    ap.add_argument("--panos", type=pathlib.Path, help="import rendered panoramas (PNG) from this folder first")
    args = ap.parse_args()
    if args.panos:
        import_panos(args.panos)
    frag = fragment()
    (ROOT / "index.html").write_text(standalone(frag), encoding="utf-8")
    print(f"index.html  {len(standalone(frag)) // 1024} KB")
    if args.fragment:
        hosted = fragment(TOUR_URL)
        args.fragment.write_text(hosted, encoding="utf-8")
        print(f"{args.fragment}  {len(hosted) // 1024} KB")
    (ROOT / "tour.html").write_text(standalone(tour_fragment("index.html")), encoding="utf-8")
    print(f"tour.html  {len(panos())} panoramas")
    if args.tour_fragment:
        args.tour_fragment.write_text(tour_fragment(PLANNER_URL), encoding="utf-8")
        print(f"{args.tour_fragment}  {len(panos())} panoramas")


if __name__ == "__main__":
    main()
