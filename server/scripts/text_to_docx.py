"""Builds an editable DOCX from OCR text (pages separated by form feeds, as written by
ocrmypdf --sidecar). Used for scanned PDFs, whose recognised text is otherwise an invisible layer.
Usage: text_to_docx.py <in.txt> <out.docx>
"""
import sys, re
from docx import Document
from docx.enum.text import WD_BREAK

def main():
    src, dst = sys.argv[1], sys.argv[2]
    text = open(src, encoding="utf-8", errors="replace").read()
    pages = text.split("\f")
    doc = Document()
    total = len(pages)
    for i, page in enumerate(pages):
        if i == total - 1 and not page.strip():
            break
        blocks = [b for b in re.split(r"\n\s*\n", page) if b.strip()]
        if not blocks:
            doc.add_paragraph("")
        for b in blocks:
            # Join soft-wrapped lines inside a paragraph, keep hyphenated words intact.
            line = re.sub(r"-\n(?=\w)", "", b.strip())
            line = re.sub(r"\s*\n\s*", " ", line)
            doc.add_paragraph(line)
        if i < total - 1 and any(p.strip() for p in pages[i + 1:]):
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        print(f"PROGRESS {i + 1} {total}", flush=True)
    doc.save(dst)

if __name__ == "__main__":
    main()
