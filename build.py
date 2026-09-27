#!/usr/bin/env python3
"""Bundle the garage planner into single-file HTML.

    python3 build.py                 # writes index.html (open it in any browser)
    python3 build.py --fragment OUT  # also writes the body-only page used for the hosted artifact

src/garage.html holds the markup and CSS, src/app.js the script, and
src/assets/ the photo-derived images. Assets are inlined as data URIs, so the
output has no local file dependencies (three.js and the fonts load from CDNs).
"""
import argparse
import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"


def data_uri(name: str) -> str:
    path = SRC / "assets" / name
    mime = "image/png" if path.suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def fragment() -> str:
    html = (SRC / "garage.html").read_text(encoding="utf-8")
    js = (SRC / "app.js").read_text(encoding="utf-8")
    html = html.replace("<!--APP_JS-->", "<script>\n" + js + "</script>")
    return re.sub(r"%%ASSET:([\w.-]+)%%", lambda m: data_uri(m.group(1)), html)


def standalone(frag: str) -> str:
    head, body = frag.split("<!--BODY-->", 1)
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        f"{head.strip()}\n</head>\n<body>\n{body.strip()}\n</body>\n</html>\n"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fragment", type=pathlib.Path, help="also write the body-only artifact page here")
    args = ap.parse_args()
    frag = fragment()
    (ROOT / "index.html").write_text(standalone(frag), encoding="utf-8")
    print(f"index.html  {len(standalone(frag)) // 1024} KB")
    if args.fragment:
        args.fragment.write_text(frag, encoding="utf-8")
        print(f"{args.fragment}  {len(frag) // 1024} KB")


if __name__ == "__main__":
    main()
