"""
POSCOMP exam extraction pipeline.

Crops each question as an image straight out of the original caderno PDFs and
pairs it with the answer key extracted from the gabarito PDFs. Produces:
  - public/questions/{year}/q{NN}.webp
  - public/data/questions.json
  - pipeline/qa/index.html (visual contact sheet for review)

Run: .venv/Scripts/python.exe extract.py [--years 2019,2022] [--no-qa]
"""
from __future__ import annotations

import argparse
import io
import json
import re
import shutil
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import fitz  # PyMuPDF
import pdfplumber
import pytesseract
from PIL import Image

_tesseract_path = shutil.which("tesseract") or r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if Path(_tesseract_path).exists():
    pytesseract.pytesseract.tesseract_cmd = _tesseract_path

ROOT = Path(__file__).parent
SOURCE = ROOT / "source"
OUT_IMG_ROOT = ROOT.parent / "public" / "questions"
OUT_DATA = ROOT.parent / "public" / "data" / "questions.json"
QA_DIR = ROOT / "qa"

DPI = 150
ZOOM = DPI / 72
WEBP_QUALITY = 80

GABARITO_LINE = re.compile(
    r"(?m)^\s*(\d{1,2})[.\s\-]+\(?([A-E]\b|\*|ANULADA\b|NULA\b)\)?", re.IGNORECASE
)

AREA_RANGES = [
    (1, 20, "matematica"),
    (21, 50, "fundamentos"),
    (51, 70, "tecnologia"),
]


def area_for(number: int) -> str:
    for lo, hi, name in AREA_RANGES:
        if lo <= number <= hi:
            return name
    return "desconhecida"


DEFAULT_TOP_MARGIN_FRAC = 0.054
DEFAULT_BOTTOM_MARGIN_FRAC = 0.95


@dataclass
class CadernoSection:
    filename: str
    # explicit area bypasses area_for()'s modern 1-20/21-50/51-70 ranges --
    # needed for 2002/2003, whose 3 separate booklets use global numbering
    # 1-20/21-40/41-70 instead
    area: str | None = None
    pattern: str = "auto"


@dataclass
class YearConfig:
    year: int
    sections: list[CadernoSection]
    gabarito: str
    top_margin_frac: float = DEFAULT_TOP_MARGIN_FRAC
    bottom_margin_frac: float = DEFAULT_BOTTOM_MARGIN_FRAC
    # restrict gabarito text extraction to these page indices [start, end) --
    # needed for 2017, whose combined gabarito repeats 1..70 for tipo 2 after
    # tipo 1, which would otherwise silently overwrite the correct answers
    gabarito_page_range: tuple[int, int] | None = None


def _single(year: int, gabarito: str, **kwargs) -> YearConfig:
    return YearConfig(year=year, sections=[CadernoSection(f"caderno_{year}.pdf")], gabarito=gabarito, **kwargs)


YEAR_CONFIGS: dict[int, YearConfig] = {
    2002: YearConfig(
        year=2002,
        sections=[
            CadernoSection("caderno_matematica_2002.pdf", area="matematica"),
            CadernoSection("caderno_fundamentos_2002.pdf", area="fundamentos", pattern="ocr"),
            CadernoSection("caderno_tecnologia_2002.pdf", area="tecnologia"),
        ],
        gabarito="gabarito_2002.pdf",
    ),
    2003: YearConfig(
        year=2003,
        sections=[
            CadernoSection("caderno_matematica_2003.pdf", area="matematica"),
            CadernoSection("caderno_fundamentos_2003.pdf", area="fundamentos", pattern="ocr"),
            CadernoSection("caderno_tecnologia_2003.pdf", area="tecnologia"),
        ],
        gabarito="gabarito_2003.pdf",
    ),
    2004: _single(2004, "gabarito_2004.pdf"),
    2005: _single(2005, "gabarito_2005.pdf"),
    2006: _single(2006, "gabarito_2006.pdf"),
    2007: _single(2007, "gabarito_2007.pdf"),
    2008: _single(2008, "gabarito_2008.pdf"),
    2009: _single(2009, "gabarito_2009.pdf"),
    2010: _single(2010, "gabarito_2010.pdf"),
    2011: _single(2011, "gabarito_2011.pdf"),
    2012: _single(2012, "gabarito_2012.pdf"),
    2013: _single(2013, "gabarito_2013.pdf"),
    2014: _single(2014, "gabarito_2014.pdf"),
    2015: _single(2015, "gabarito_2015.pdf"),
    2016: _single(2016, "gabarito_2016.pdf"),
    2017: YearConfig(
        year=2017,
        sections=[CadernoSection("caderno_2017_tipo1.pdf")],
        gabarito="gabarito_2017_tipo_1_2.pdf",
        gabarito_page_range=(0, 2),  # pages 0-1 are TIPO 1; 2-3 are TIPO 2 (repeats 1..70)
    ),
    2018: _single(2018, "gabarito_2018.pdf"),
    2019: _single(2019, "gabarito-2019.pdf"),
    2022: _single(2022, "gabarito-2022.pdf"),
    2023: _single(2023, "gabarito_2023.pdf"),
    2024: _single(2024, "gabarito_2024.pdf"),
    2025: _single(2025, "gabarito_2025.pdf"),
}


@dataclass
class Anchor:
    number: int
    page_index: int
    y0: float
    y1: float
    x0: float = 0.0


@dataclass
class QuestionRecord:
    number: int
    image: Image.Image
    area: str = ""


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


DOT_ANCHOR = re.compile(r"^0*(\d{1,2})\.$")
PAREN_ANCHOR = re.compile(r"^0*(\d{1,2})\)$")
BARE_ANCHOR = re.compile(r"^0*(\d{1,2})$")

# "questao" first since it's the most specific/reliable; the numeric-only
# patterns are checked in increasing order of ambiguity/false-positive risk
ANCHOR_PATTERNS = ("questao", "dot", "paren", "bare")

OCR_ZOOM = 2.0  # render resolution for tesseract; PDF-point coords = pixel / OCR_ZOOM


def _find_anchors_ocr(doc: fitz.Document) -> list[Anchor]:
    """Fallback for PDFs with a garbled/unusable text layer (custom subset
    fonts with no ToUnicode CMap -- get_text() returns mojibake). Renders
    each page to an image and OCRs it; anchors are a bare number immediately
    followed by a "-" a few pixels to its right, e.g. "21 - Uma..."."""
    anchors: list[Anchor] = []
    for page_index in range(len(doc)):
        page = doc[page_index]
        pix = page.get_pixmap(matrix=fitz.Matrix(OCR_ZOOM, OCR_ZOOM))
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        data = pytesseract.image_to_data(img, lang="eng", output_type=pytesseract.Output.DICT)

        n = len(data["text"])
        page_anchors = []
        for i in range(n):
            text = data["text"][i].strip()
            # OCR sometimes keeps the delimiter attached to the number
            # ("26.") and sometimes splits it into its own token ("21", "-")
            combined_match = re.fullmatch(r"(\d{1,2})[.\-]", text)
            number: int | None = None
            if combined_match:
                number = int(combined_match.group(1))
            elif re.fullmatch(r"\d{1,2}", text) and i + 1 < n:
                nxt = data["text"][i + 1].strip()
                same_line = data["line_num"][i] == data["line_num"][i + 1] and data["block_num"][i] == data["block_num"][i + 1]
                gap = data["left"][i + 1] - (data["left"][i] + data["width"][i])
                if nxt in ("-", ".") and same_line and 0 <= gap <= 20:
                    number = int(text)
            if number is None:
                continue
            page_anchors.append(
                Anchor(
                    number=number,
                    page_index=page_index,
                    y0=data["top"][i] / OCR_ZOOM,
                    y1=(data["top"][i] + data["height"][i]) / OCR_ZOOM,
                    x0=data["left"][i] / OCR_ZOOM,
                )
            )
        page_anchors.sort(key=lambda a: a.y0)
        anchors.extend(page_anchors)
    return _dedupe_anchors(_filter_by_left_margin(anchors))


MARGIN_TOLERANCES = (3.0, 5.0, 8.0, 12.0)


def _raw_candidates(doc: fitz.Document, pattern: str) -> list[Anchor]:
    """Word-level scan for question anchors, unfiltered.

    PyMuPDF sometimes merges the tail of one question's answer choices and
    the start of the next question into a single text block, so matching
    only against block-leading text silently drops anchors. Word-level
    scanning catches every occurrence regardless of block grouping.

    Newer exams (~2008+) mark questions as "QUESTAO <n>" (two words). Older
    exams instead number questions as a single word "<n>.", "<n>)" or just
    bare "<n>" at the start of the line -- much more prone to false
    positives (any number in a formula/list can match), so those get run
    through _filter_by_left_margin by the caller.
    """
    raw: list[Anchor] = []
    for page_index in range(len(doc)):
        page = doc[page_index]
        words = page.get_text("words")  # (x0,y0,x1,y1,text,block,line,word_no)
        page_anchors = []
        if pattern == "questao":
            for i, w in enumerate(words[:-1]):
                # decorative border glyphs (e.g. "▬") sometimes glue directly
                # onto the word with no space ("▬QUESTAO"), so check the
                # cleaned token ends with QUESTAO rather than equals it
                token = _strip_accents(w[4]).upper()
                if not token.endswith("QUESTAO"):
                    continue
                next_word = words[i + 1][4]
                num_match = re.match(r"0*(\d+)", next_word)
                if not num_match:
                    continue
                page_anchors.append(
                    Anchor(number=int(num_match.group(1)), page_index=page_index, y0=w[1], y1=w[3], x0=w[0])
                )
        else:
            regex = {"dot": DOT_ANCHOR, "paren": PAREN_ANCHOR, "bare": BARE_ANCHOR}[pattern]
            for w in words:
                m = regex.match(w[4])
                if not m:
                    continue
                page_anchors.append(Anchor(number=int(m.group(1)), page_index=page_index, y0=w[1], y1=w[3], x0=w[0]))
        page_anchors.sort(key=lambda a: a.y0)
        raw.extend(page_anchors)
    return raw


def _filter_with_best_tolerance(raw: list[Anchor]) -> list[Anchor]:
    # The real left margin can jitter by a few points between sections of the
    # same document (different subject headers, font substitutions), but a
    # tolerance wide enough to absorb that also risks merging in a genuinely
    # different, noisy cluster for the more ambiguous patterns (esp. "bare").
    # Try increasingly generous tolerances and stop at the first one that
    # yields a clean, unbroken 1..N run; otherwise keep the longest result.
    best: list[Anchor] = []
    for tolerance in MARGIN_TOLERANCES:
        candidate = _dedupe_anchors(_filter_by_left_margin(raw, tolerance))
        if _is_clean_sequence(candidate):
            return candidate
        if len(candidate) > len(best):
            best = candidate
    return best


def _find_anchors_by_pattern(doc: fitz.Document, pattern: str) -> list[Anchor]:
    if pattern == "ocr":
        return _find_anchors_ocr(doc)
    return _filter_with_best_tolerance(_raw_candidates(doc, pattern))


def _find_anchors_combined(doc: fitz.Document, patterns: tuple[str, ...]) -> list[Anchor]:
    """Some documents switch anchor format partway through (e.g. 2004 uses
    "N." for questions 1-40 then "N)" for 41-70, likely stitched together
    from two separately-typeset sections). Merge raw candidates from
    multiple patterns before filtering so either format is picked up."""
    raw: list[Anchor] = []
    for pattern in patterns:
        raw.extend(_raw_candidates(doc, pattern))
    raw.sort(key=lambda a: (a.page_index, a.y0))
    return _filter_with_best_tolerance(raw)


def _dedupe_anchors(anchors: list[Anchor], tolerance: float = 3.0) -> list[Anchor]:
    """Some PDFs simulate bold by drawing the same text twice at a
    near-identical position (a sub-pixel offset "double strike"), which
    duplicates whichever anchor happens to be bolded. Collapse anchors with
    the same number/page sitting within a couple points of each other."""
    deduped: list[Anchor] = []
    for a in anchors:
        if deduped and deduped[-1].number == a.number and deduped[-1].page_index == a.page_index and abs(deduped[-1].y0 - a.y0) <= tolerance:
            continue
        deduped.append(a)
    return deduped


def _filter_by_left_margin(anchors: list[Anchor], tolerance: float = 8.0) -> list[Anchor]:
    """Numeric-only anchors ("12." / "12)" / bare "12") show up anywhere a
    number is formatted that way -- inside matrices, enumerated sub-items,
    answer choices. Real question anchors are reliably flush against the
    page's left content margin, so cluster candidates by x0 and keep only
    the anchors sitting in the dominant column(s)."""
    if not anchors:
        return anchors

    xs = sorted(a.x0 for a in anchors)
    clusters: list[list[float]] = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= tolerance:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    if not clusters:
        return anchors

    best_cluster = max(clusters, key=len)
    lo, hi = best_cluster[0] - tolerance, best_cluster[-1] + tolerance
    threshold = max(3, int(0.3 * len(best_cluster)))
    kept_ranges = [(lo, hi)] if len(best_cluster) >= threshold else []
    # allow a second column (two-column layout) if it's comparably populated
    for cluster in clusters:
        if cluster is best_cluster:
            continue
        if len(cluster) >= max(5, 0.5 * len(best_cluster)):
            kept_ranges.append((cluster[0] - tolerance, cluster[-1] + tolerance))

    return [a for a in anchors if any(lo <= a.x0 <= hi for lo, hi in kept_ranges)]


def _is_clean_sequence(anchors: list[Anchor]) -> bool:
    nums = [a.number for a in anchors]
    # require a plausible minimum length so a small false-positive run (e.g.
    # some footnote numbers 1..5 that happen to look "clean") isn't mistaken
    # for the real, much longer question sequence
    return len(nums) >= 15 and nums == list(range(1, len(nums) + 1))


def find_anchors(doc: fitz.Document, top_margin: float, bottom_margin: float, pattern: str = "auto") -> list[Anchor]:
    if pattern != "auto":
        return _find_anchors_by_pattern(doc, pattern)

    # "QUESTAO N" is checked first since it's the least ambiguous pattern.
    # If this doc is using that convention at all (even if a handful of
    # anchors need manual fixing later), prefer it over falling through to
    # the much noisier numeric-only patterns.
    questao = _find_anchors_by_pattern(doc, "questao")
    if len(questao) >= 5:
        return questao

    # Try every numeric-only pattern (plus a combined dot+paren pass, for
    # documents that switch anchor format partway through) and keep the
    # longest *clean* sequence -- a short clean run (e.g. dot-only finding
    # a clean 1..40 when the doc is really 1..70 split dot/paren) must not
    # win over a longer clean run just because it was tried first.
    candidates = [_find_anchors_by_pattern(doc, p) for p in ("dot", "paren", "bare")]
    candidates.append(_find_anchors_combined(doc, ("dot", "paren")))

    clean = [c for c in candidates if _is_clean_sequence(c)]
    if clean:
        return max(clean, key=len)
    return max(candidates, key=len, default=[])


def crop_question(
    doc: fitz.Document, start: Anchor, end: Anchor | None, top_margin_frac: float, bottom_margin_frac: float
) -> Image.Image:
    """Crop from start anchor's top to end anchor's top (or bottom margin if
    no end), stacking pieces vertically if the question spans pages.

    Margins are fractions of page height rather than absolute points, since
    page size varies across years (A4 vs US Letter, minor point-size drift)."""
    page_width = doc[start.page_index].rect.width

    def margins_for(page_index: int) -> tuple[float, float]:
        h = doc[page_index].rect.height
        return top_margin_frac * h, bottom_margin_frac * h

    pieces: list[Image.Image] = []

    start_page = start.page_index
    end_page = end.page_index if end else start.page_index

    # tall inline math (fraction bars, superscripts) can extend a few points
    # above the anchor glyph's own bbox top, so back up slightly to avoid
    # clipping it; harmless if it overlaps a sliver of the previous question
    top_margin_start, _ = margins_for(start_page)
    start_y0 = max(top_margin_start, start.y0 - 4)

    # OCR-derived anchor positions in particular can be a few points looser
    # than the true glyph top, letting the next question's first line bleed
    # into this crop; trim a matching amount off the end boundary too
    end_y0 = end.y0 - 6 if end else None

    if start_page == end_page:
        _, bottom_margin = margins_for(start_page)
        y1 = end_y0 if end else bottom_margin
        pieces.append(render_clip(doc, start_page, start_y0, y1, page_width))
    else:
        # first page: from anchor to bottom margin
        _, bottom_margin_start = margins_for(start_page)
        pieces.append(render_clip(doc, start_page, start_y0, bottom_margin_start, page_width))
        # any full intermediate pages
        for p in range(start_page + 1, end_page):
            top_margin_p, bottom_margin_p = margins_for(p)
            pieces.append(render_clip(doc, p, top_margin_p, bottom_margin_p, page_width))
        # last page: from top margin to end anchor
        top_margin_end, bottom_margin_end = margins_for(end_page)
        end_y1 = end_y0 if end else bottom_margin_end
        pieces.append(render_clip(doc, end_page, top_margin_end, end_y1, page_width))

    if len(pieces) == 1:
        combined = pieces[0]
    else:
        total_h = sum(p.height for p in pieces)
        max_w = max(p.width for p in pieces)
        combined = Image.new("RGB", (max_w, total_h), "white")
        y = 0
        for p in pieces:
            combined.paste(p, (0, y))
            y += p.height

    # last question on a page/doc has no next-anchor to bound it, so its
    # crop runs to bottom_margin and picks up trailing blank space; trim it
    if end is None or end.page_index != start.page_index:
        combined = trim_bottom_whitespace(combined)
    return combined


def trim_bottom_whitespace(img: Image.Image, pad: int = 12, threshold: int = 250) -> Image.Image:
    gray = img.convert("L")
    w, h = gray.size
    pixels = gray.load()
    last_content_row = 0
    for y in range(h - 1, -1, -1):
        row_has_content = any(pixels[x, y] < threshold for x in range(0, w, 4))
        if row_has_content:
            last_content_row = y
            break
    new_h = min(h, last_content_row + pad)
    if new_h >= h:
        return img
    return img.crop((0, 0, w, new_h))


def render_clip(doc: fitz.Document, page_index: int, y0: float, y1: float, width: float) -> Image.Image:
    if y1 <= y0:
        y1 = y0 + 1
    page = doc[page_index]
    clip = fitz.Rect(0, y0, width, y1)
    pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), clip=clip)
    return Image.open(io.BytesIO(pix.tobytes("png")))


def extract_section(cfg: YearConfig, section: CadernoSection) -> list[QuestionRecord]:
    pdf_path = SOURCE / str(cfg.year) / section.filename
    doc = fitz.open(pdf_path)
    anchors = find_anchors(doc, 0, 0, pattern=section.pattern)

    nums = [a.number for a in anchors]
    if nums and nums != list(range(nums[0], nums[0] + len(nums))):
        missing = sorted(set(range(min(nums), max(nums) + 1)) - set(nums))
        print(f"[WARN] {cfg.year} {section.filename}: gaps in anchor sequence, missing {missing}", file=sys.stderr)
    elif not nums:
        print(f"[WARN] {cfg.year} {section.filename}: no anchors found at all", file=sys.stderr)

    records = []
    for i, anchor in enumerate(anchors):
        end = anchors[i + 1] if i + 1 < len(anchors) else None
        img = crop_question(doc, anchor, end, cfg.top_margin_frac, cfg.bottom_margin_frac)
        if img.height < 80:
            print(f"[WARN] {cfg.year} q{anchor.number:02d}: suspiciously short crop ({img.height}px)", file=sys.stderr)
        if img.height > 2500:
            print(f"[WARN] {cfg.year} q{anchor.number:02d}: suspiciously tall crop ({img.height}px)", file=sys.stderr)
        area = section.area or area_for(anchor.number)
        records.append(QuestionRecord(number=anchor.number, image=img, area=area))
    doc.close()
    return records


def extract_year(cfg: YearConfig) -> list[QuestionRecord]:
    records: list[QuestionRecord] = []
    for section in cfg.sections:
        records.extend(extract_section(cfg, section))
    return records


def _make_answer(letter_raw: str) -> dict:
    letter_raw = letter_raw.upper()
    if letter_raw in ("*", "ANULADA", "NULA"):
        return {"answer": None, "annulled": True}
    return {"answer": letter_raw, "annulled": False}


# same-line "N  letter" / "N. (letter)" / "N-letter", one entry per line.
# Matches most years (2003-2023-ish). "*" here also matches U+2217 (∗), a
# lookalike asterisk some gabaritos use for annulled questions instead of
# the ASCII one.
GABARITO_LINE = re.compile(
    r"(?m)^\s*(\d{1,2})[.\s\-]+\(?(?:QUEST[ÃA]O\s+)?([A-E]\b|[*∗]|ANULADA\b|NULA\b)\)?", re.IGNORECASE
)

# "01 - D 02 - * 03 - E ..." -- several entries packed on one line, no
# line-start anchor possible. Needs a plausible hit-count check by the
# caller since an unanchored scan is more prone to false positives.
GABARITO_INLINE = re.compile(r"\b0*(\d{1,2})\s*-\s*([A-E]\b|[*∗])", re.IGNORECASE)


def _parse_gabarito_text(text: str, pattern: re.Pattern) -> dict[int, dict]:
    answers: dict[int, dict] = {}
    for m in pattern.finditer(text):
        num = int(m.group(1))
        if num not in answers:  # first occurrence wins (e.g. duplicate tables)
            answers[num] = _make_answer(m.group(2))
    return answers


def _parse_gabarito_paired_rows(text: str) -> dict[int, dict]:
    """2018-style: a line of question numbers, then a line of answers
    beneath it, both space-separated and the same length, e.g.:
        1 2 3 4 5 ... 20
        D A B E E ... A
    """
    lines = text.split("\n")
    answers: dict[int, dict] = {}
    for i in range(len(lines) - 1):
        nums = lines[i].split()
        ans = lines[i + 1].split()
        if len(nums) < 5 or len(nums) != len(ans):
            continue
        if not all(re.fullmatch(r"\d{1,2}", t) for t in nums):
            continue
        if not all(re.fullmatch(r"[A-Ea-e*∗]", t) for t in ans):
            continue
        for n, a in zip(nums, ans):
            num = int(n)
            if num not in answers:
                answers[num] = _make_answer(a)
    return answers


def _ocr_gabarito_text(pdf_path: Path, page_range: tuple[int, int] | None) -> str:
    """OCR a gabarito that's a scanned image with no text layer at all.

    A single full-page OCR pass badly mangles dense answer tables (table
    gridlines confuse tesseract's word segmentation and it drops most
    middle cells in a row). Isolating each row to a narrow, gridline-free
    band and re-OCRing it at high zoom recovers those dropped cells, so we
    do a coarse low-zoom pass just to locate row y-positions, then a tight
    high-zoom pass per row.
    """
    ROW_ANCHOR = re.compile(r"\d{1,2}\s*-\s*[A-Za-z*]")
    COARSE_ZOOM = 3.0
    ROW_ZOOM = 6.0
    ROW_HEIGHT_PAD = 8  # pixels, at COARSE_ZOOM, above/below the detected anchor

    doc = fitz.open(pdf_path)
    pages = range(*page_range) if page_range else range(len(doc))
    chunks = []
    for page_index in pages:
        page = doc[page_index]
        coarse_pix = page.get_pixmap(matrix=fitz.Matrix(COARSE_ZOOM, COARSE_ZOOM))
        coarse_img = Image.open(io.BytesIO(coarse_pix.tobytes("png")))
        data = pytesseract.image_to_data(coarse_img, config="--psm 11", output_type=pytesseract.Output.DICT)

        row_spans = sorted(
            (data["top"][i], data["top"][i] + data["height"][i])
            for i in range(len(data["text"]))
            if ROW_ANCHOR.search(data["text"][i])
        )
        clusters: list[list[tuple[int, int]]] = []
        for span in row_spans:
            if clusters and span[0] - clusters[-1][-1][0] <= 10:
                clusters[-1].append(span)
            else:
                clusters.append([span])

        if not clusters:
            # not a row-based table; fall back to a plain full-page OCR
            chunks.append(pytesseract.image_to_string(coarse_img, lang="eng"))
            continue

        for cluster in clusters:
            y0 = (min(top for top, _ in cluster) - ROW_HEIGHT_PAD) / COARSE_ZOOM
            y1 = (max(bottom for _, bottom in cluster) + ROW_HEIGHT_PAD) / COARSE_ZOOM
            row_pix = page.get_pixmap(matrix=fitz.Matrix(ROW_ZOOM, ROW_ZOOM), clip=fitz.Rect(0, y0, page.rect.width, y1))
            row_img = Image.open(io.BytesIO(row_pix.tobytes("png")))
            chunks.append(pytesseract.image_to_string(row_img, config="--psm 6", lang="eng"))
    doc.close()
    text = "\n".join(chunks)
    # OCR frequently misreads a leading zero as the letter O ("O1"/"o1" -> "01")
    return re.sub(r"\bo(\d)", r"0\1", text, flags=re.IGNORECASE)


def parse_gabarito(cfg: YearConfig, expected_numbers: set[int]) -> dict[int, dict]:
    pdf_path = SOURCE / str(cfg.year) / cfg.gabarito
    with pdfplumber.open(pdf_path) as pdf:
        page_indices = range(*cfg.gabarito_page_range) if cfg.gabarito_page_range else range(len(pdf.pages))
        text = "\n".join(pdf.pages[i].extract_text() or "" for i in page_indices)

    if not text.strip():
        text = _ocr_gabarito_text(pdf_path, cfg.gabarito_page_range)

    candidates = [
        _parse_gabarito_text(text, GABARITO_LINE),
        _parse_gabarito_paired_rows(text),
        _parse_gabarito_text(text, GABARITO_INLINE),
    ]

    best = max(candidates, key=lambda c: len(expected_numbers & c.keys()))
    return best


def save_images(year: int, records: list[QuestionRecord]) -> None:
    out_dir = OUT_IMG_ROOT / str(year)
    out_dir.mkdir(parents=True, exist_ok=True)
    for rec in records:
        path = out_dir / f"q{rec.number:02d}.webp"
        rec.image.save(path, "WEBP", quality=WEBP_QUALITY)


def build_qa_page(all_questions: list[dict]) -> None:
    QA_DIR.mkdir(parents=True, exist_ok=True)
    by_year: dict[int, list[dict]] = {}
    for q in all_questions:
        by_year.setdefault(q["year"], []).append(q)

    html = ["<html><head><meta charset='utf-8'><title>POSCOMP QA</title>",
            "<style>body{font-family:sans-serif} .q{display:inline-block;margin:8px;border:1px solid #ccc;padding:6px;vertical-align:top;max-width:340px}",
            "img{max-width:320px;display:block} .meta{font-size:13px;margin-top:4px} .annulled{color:red;font-weight:bold}</style></head><body>"]
    for year in sorted(by_year):
        html.append(f"<h2>{year} ({len(by_year[year])} questoes)</h2>")
        for q in sorted(by_year[year], key=lambda x: x["number"]):
            rel = f"../public/questions/{year}/q{q['number']:02d}.webp"
            ans = "ANULADA" if q.get("annulled") else (q.get("answer") or "?")
            cls = "annulled" if q.get("annulled") else ""
            html.append(
                f"<div class='q'><img src='{rel}'><div class='meta'>Q{q['number']:02d} ({q['area']}) "
                f"gabarito: <span class='{cls}'>{ans}</span></div></div>"
            )
    html.append("</body></html>")
    (QA_DIR / "index.html").write_text("\n".join(html), encoding="utf-8")


def run(years: list[int]) -> None:
    all_questions: list[dict] = []
    for year in years:
        cfg = YEAR_CONFIGS.get(year)
        if cfg is None:
            print(f"[WARN] no config for year {year}, skipping", file=sys.stderr)
            continue

        print(f"Processing {year}...")
        records = extract_year(cfg)
        record_numbers = {r.number for r in records}
        answers = parse_gabarito(cfg, record_numbers)

        answer_numbers = set(answers.keys())
        if record_numbers != answer_numbers:
            missing_answers = record_numbers - answer_numbers
            extra_answers = answer_numbers - record_numbers
            if missing_answers:
                print(f"[WARN] {year}: questions with no gabarito entry: {sorted(missing_answers)}", file=sys.stderr)
            if extra_answers:
                print(f"[WARN] {year}: gabarito entries with no matching question: {sorted(extra_answers)}", file=sys.stderr)

        save_images(year, records)

        for r in records:
            ans = answers.get(r.number, {"answer": None, "annulled": False})
            all_questions.append({
                "id": f"{year}-{r.number:02d}",
                "year": year,
                "number": r.number,
                "area": r.area,
                "image": f"questions/{year}/q{r.number:02d}.webp",
                "answer": ans["answer"],
                "annulled": ans["annulled"],
            })

    OUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": date.today().isoformat(),
        "years": sorted({q["year"] for q in all_questions}),
        "questions": all_questions,
    }
    OUT_DATA.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(all_questions)} questions to {OUT_DATA}")

    build_qa_page(all_questions)
    print(f"QA contact sheet: {QA_DIR / 'index.html'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=str, default="", help="comma separated years, default: all configured")
    args = parser.parse_args()

    if args.years:
        years = [int(y) for y in args.years.split(",")]
    else:
        years = sorted(YEAR_CONFIGS.keys())

    run(years)
