# Office fixtures: two-sheet XLSX, two-slide PPTX, multi-page ODT source.
import sys, os
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches, Pt
out = sys.argv[1]
wb = Workbook(); ws = wb.active; ws.title = "Sales"
ws.append(["Month", "Units", "Revenue"]);
for m, u in [("Jan", 10), ("Feb", 14), ("Mar", 9)]: ws.append([m, u, u * 12.5])
ws["D1"] = "Total"; ws["D2"] = "=SUM(C2:C4)"
ws2 = wb.create_sheet("Notes"); ws2.append(["Note"]); ws2.append(["Ünïcödé ✓"])
wb.save(os.path.join(out, "sample.xlsx"))
prs = Presentation()
for i in range(2):
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = f"Slide {i + 1}"
    s.placeholders[1].text = "Converted by Fileverse"
prs.save(os.path.join(out, "sample.pptx"))
# multi-page document via HTML page breaks -> ODT is produced later by LibreOffice from this .html
html = "".join(f"<h1>Page {i}</h1><p>{'Lorem ipsum dolor sit amet. ' * 40}</p><p style='page-break-after: always'></p>" for i in range(1, 6))
with open(os.path.join(out, "multipage.html"), "w") as f: f.write(f"<html><body>{html}</body></html>")
os.system(f"cd {out} && soffice --headless -env:UserInstallation=file:///tmp/fixture-lo --convert-to odt multipage.html >/dev/null 2>&1")
os.remove(os.path.join(out, "multipage.html"))
