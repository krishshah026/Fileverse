"""Builds a PPTX where each slide is one page image, sized to the page aspect ratio.
Usage: images_to_pptx.py <out.pptx> <img1> [img2 ...]
"""
import sys
from pptx import Presentation
from pptx.util import Emu
from PIL import Image

def main():
    out, images = sys.argv[1], sys.argv[2:]
    prs = Presentation()
    with Image.open(images[0]) as im:
        w, h = im.size
    # 13.333in wide (16:9 default width) and height from the page aspect ratio
    width = Emu(12192000)
    height = Emu(int(12192000 * h / w))
    prs.slide_width, prs.slide_height = width, height
    blank = prs.slide_layouts[6]
    for i, path in enumerate(images):
        slide = prs.slides.add_slide(blank)
        slide.shapes.add_picture(path, 0, 0, width=width, height=height)
        print(f"PROGRESS {i + 1} {len(images)}", flush=True)
    prs.save(out)

if __name__ == "__main__":
    main()
