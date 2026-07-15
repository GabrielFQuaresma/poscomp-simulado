"""Quick diagnostic: for each year's caderno(s), report how many question
anchors were found, whether numbering is a clean 1..N sequence, and how many
columns/pages are involved. No image rendering, just anchor detection -- fast
to run across all years to figure out per-year quirks before configuring
extract.py properly."""
import sys
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).parent))
from extract import find_anchors, SOURCE

CASES = [
    (2002, ["caderno_fundamentos_2002.pdf", "caderno_matematica_2002.pdf", "caderno_tecnologia_2002.pdf"]),
    (2003, ["caderno_fundamentos_2003.pdf", "caderno_matematica_2003.pdf", "caderno_tecnologia_2003.pdf"]),
    (2004, ["caderno_2004.pdf"]),
    (2005, ["caderno_2005.pdf"]),
    (2006, ["caderno_2006.pdf"]),
    (2007, ["caderno_2007.pdf"]),
    (2008, ["caderno_2008.pdf"]),
    (2009, ["caderno_2009.pdf"]),
    (2010, ["caderno_2010.pdf"]),
    (2011, ["caderno_2011.pdf"]),
    (2012, ["caderno_2012.pdf"]),
    (2013, ["caderno_2013.pdf"]),
    (2014, ["caderno_2014.pdf"]),
    (2015, ["caderno_2015.pdf"]),
    (2016, ["caderno_2016.pdf"]),
    (2017, ["caderno_2017_tipo1.pdf"]),
    (2018, ["caderno_2018.pdf"]),
    (2019, ["caderno_2019.pdf"]),
    (2022, ["caderno_2022.pdf"]),
    (2023, ["caderno_2023.pdf"]),
    (2024, ["caderno_2024.pdf"]),
    (2025, ["caderno_2025.pdf"]),
]

for year, files in CASES:
    for fname in files:
        path = SOURCE / str(year) / fname
        if not path.exists():
            print(f"{year} {fname}: MISSING FILE")
            continue
        doc = fitz.open(path)
        anchors = find_anchors(doc, 0, 10000, pattern="auto")
        nums = [a.number for a in anchors]
        expected = list(range(1, len(nums) + 1))
        ok = nums == expected
        # column detection: x0 spread of anchors on a page with >1 anchor
        xs = set()
        for a in anchors[:5]:
            pass
        print(f"{year} {fname}: pages={len(doc)} anchors_found={len(nums)} sequence_ok={ok} first5={nums[:5]} last5={nums[-5:]}")
        if not ok:
            missing = sorted(set(expected) - set(nums))
            dupes = sorted({n for n in nums if nums.count(n) > 1})
            print(f"    missing={missing[:15]} dupes={dupes[:15]}")
        doc.close()
