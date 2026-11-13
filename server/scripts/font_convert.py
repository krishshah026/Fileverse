"""Font conversion between TTF, OTF, WOFF, WOFF2 with fontTools; outline conversion via FontForge.
Usage: font_convert.py <in> <out> <target: ttf|otf|woff|woff2> [fontforge-binary]
"""
import sys, os, subprocess, tempfile
from fontTools.ttLib import TTFont

def outline_kind(font):
    return "otf" if ("CFF " in font or "CFF2" in font) else "ttf"

def main():
    src, dst, target = sys.argv[1], sys.argv[2], sys.argv[3]
    fontforge = sys.argv[4] if len(sys.argv) > 4 else "fontforge"
    font = TTFont(src, recalcBBoxes=False, recalcTimestamp=False)
    kind = outline_kind(font)
    if target in ("woff", "woff2"):
        font.flavor = target
        font.save(dst)
        print(f"INFO outlines={kind}")
        return
    if target == kind:
        font.flavor = None
        font.save(dst)
        return
    # Outline conversion (TrueType quadratic <-> CFF cubic) needs FontForge.
    with tempfile.TemporaryDirectory() as tmp:
        sfnt = os.path.join(tmp, "source." + kind)
        font.flavor = None
        font.save(sfnt)
        script = 'Open($1); Generate($2); Close()'
        subprocess.run([fontforge, "-lang=ff", "-c", script, sfnt, dst], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    print(f"NOTE Outlines were converted from {'PostScript (CFF)' if kind == 'otf' else 'TrueType'} to {'TrueType' if target == 'ttf' else 'PostScript (CFF)'}; curves are approximated with high precision.")

if __name__ == "__main__":
    main()
