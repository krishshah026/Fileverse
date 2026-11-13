"""PDF -> DOCX using pdf2docx (layout-aware: paragraphs, tables, images, columns).
Usage: pdf_to_docx.py <in.pdf> <out.docx> [password]
Progress lines on stdout: PROGRESS <done> <total>
"""
import sys, os, logging, re

class ProgressHandler(logging.Handler):
    rx = re.compile(r"\((\d+)/(\d+)\)")
    def emit(self, record):
        m = self.rx.search(record.getMessage())
        if m:
            print(f"PROGRESS {m.group(1)} {m.group(2)}", flush=True)

def main():
    src, dst = sys.argv[1], sys.argv[2]
    password = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    logging.getLogger().setLevel(logging.INFO)
    logging.getLogger().addHandler(ProgressHandler())
    from pdf2docx import Converter
    cv = Converter(src, password=password)
    try:
        pages = len(cv.fitz_doc)
        multi = pages >= 24 and (os.cpu_count() or 1) > 1
        cv.convert(dst, start=0, end=None, multi_processing=multi, cpu_count=min(os.cpu_count() or 1, 4))
    finally:
        cv.close()

if __name__ == "__main__":
    main()
