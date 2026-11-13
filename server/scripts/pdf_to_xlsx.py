"""PDF tables -> XLSX. One sheet per page that contains tabular data.
Usage: pdf_to_xlsx.py <in.pdf> <out.xlsx> <pages-csv or 'all'>
"""
import sys, re
import pdfplumber
from openpyxl import Workbook
from openpyxl.utils import get_column_letter

NUM = re.compile(r"^-?\(?[\$€£₹]?\s?\d{1,3}(,\d{3})*(\.\d+)?\)?%?$|^-?\d+(\.\d+)?$")

def to_value(v):
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    if NUM.match(s) and not (len(s) > 1 and s[0] == "0" and s[1].isdigit()):
        neg = s.startswith("(") and s.endswith(")")
        pct = s.endswith("%")
        t = re.sub(r"[,\s\$€£₹()%]", "", s)
        try:
            n = float(t)
            if neg: n = -n
            if pct: n = n / 100
            return int(n) if n.is_integer() and "." not in t and not pct else n
        except ValueError:
            return s
    return s

def main():
    src, dst, pages = sys.argv[1], sys.argv[2], sys.argv[3]
    wb = Workbook()
    wb.remove(wb.active)
    found = 0
    with pdfplumber.open(src) as pdf:
        total = len(pdf.pages)
        wanted = range(1, total + 1) if pages == "all" else [int(p) for p in pages.split(",")]
        for i, pno in enumerate(wanted):
            page = pdf.pages[pno - 1]
            tables = page.extract_tables()
            if not tables:
                t = page.extract_table({"vertical_strategy": "text", "horizontal_strategy": "text"})
                tables = [t] if t and len(t) > 1 and max(len(r) for r in t) > 1 else []
            if tables:
                ws = wb.create_sheet(f"Page {pno}")
                r = 1
                widths = {}
                for table in tables:
                    for row in table:
                        for c, cell in enumerate(row, start=1):
                            val = to_value(cell)
                            ws.cell(row=r, column=c, value=val)
                            if val is not None:
                                widths[c] = max(widths.get(c, 0), min(60, len(str(val))))
                        r += 1
                    r += 1
                    found += 1
                for c, w in widths.items():
                    ws.column_dimensions[get_column_letter(c)].width = max(8, w + 2)
            print(f"PROGRESS {i + 1} {len(wanted)}", flush=True)
    if not found:
        ws = wb.create_sheet("Text")
        with pdfplumber.open(src) as pdf:
            r = 1
            for page in pdf.pages:
                for line in (page.extract_text() or "").splitlines():
                    ws.cell(row=r, column=1, value=line)
                    r += 1
        print("NOTE No tables were detected, so the text was placed in a single column.", flush=True)
    wb.save(dst)

if __name__ == "__main__":
    main()
