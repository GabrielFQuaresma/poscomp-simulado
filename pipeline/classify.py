"""
Tag every extracted POSCOMP question with the topics it covers.

Reuses extract.py's anchor detection to know where each question starts and
ends, pulls the text of that region out of the caderno PDF (OCR where the
text layer is unusable), and scores it against the taxonomy in topics.py.
Adds a "topics" list to each entry in public/data/questions.json and writes
pipeline/topics_report.txt / pipeline/text/{year}.json for review.

Run: .venv/Scripts/python.exe classify.py [--years 2019,2022] [--dry-run]
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import fitz
import pytesseract
from PIL import Image

from extract import (
    OUT_DATA,
    ROOT,
    SOURCE,
    YEAR_CONFIGS,
    Anchor,
    CadernoSection,
    YearConfig,
    find_anchors,
)
from topics import TOPIC_BY_SLUG, TOPICS, classify, normalize

TEXT_DIR = ROOT / "text"
REPORT_PATH = ROOT / "topics_report.txt"
OUT_TOPICS = OUT_DATA.parent / "topics.json"

OCR_TEXT_ZOOM = 3.0
# below this the text layer is effectively absent (image-only page). Kept low
# on purpose: plenty of legitimate questions are one line plus five options,
# and OCR is strictly worse than a real text layer, so only fall back when
# there is nothing to work with.
MIN_USABLE_CHARS = 50
# The 2002/2003 Fundamentos booklets use subset fonts with no ToUnicode CMap,
# so get_text() returns pure mojibake ("\x1af\x08gihaj0k9"). Two independent
# signals catch that: once accents are folded away real prose is essentially
# pure printable ASCII, and it always contains a few very common Portuguese
# words. Counting *printable ASCII* rather than *letters* matters -- the
# pre-2008 math questions are legitimately half symbols and digits, and OCR
# reads their notation far worse than the real text layer does.
# Measured: the mojibake booklets land at 0.11-0.67, real text layers at
# 0.87-1.00 even for the most notation-dense math questions.
MIN_ASCII_RATIO = 0.8
# The stopword test only discriminates on text long enough to contain prose;
# a one-line math question ("A derivada de f(x) = x e igual a") legitimately
# has almost none, so it is applied above this length only.
STOPWORD_CHECK_MIN_CHARS = 250
MIN_STOPWORD_HITS = 2

_PRINTABLE_ASCII = re.compile(r"[\x20-\x7e]")
_STOPWORDS = re.compile(
    r"\b(?:de|da|do|que|para|com|uma|um|os|as|em|no|na|por|sao|seguir|alternativa|"
    r"considere|assinale|seja|abaixo|correta|apresenta)\b"
)


@dataclass
class QuestionText:
    year: int
    number: int
    text: str
    source: str  # "pdf" or "ocr"


def _clip_rects(doc: fitz.Document, start: Anchor, end: Anchor | None) -> list[tuple[int, fitz.Rect]]:
    """Page-index + rect pairs covering one question, mirroring extract.py's
    crop_question geometry so the text we read matches the image the app shows."""
    end_page = end.page_index if end else start.page_index
    rects: list[tuple[int, fitz.Rect]] = []

    if start.page_index == end_page:
        y1 = end.y0 if end else doc[start.page_index].rect.height
        rects.append((start.page_index, fitz.Rect(0, start.y0 - 4, doc[start.page_index].rect.width, y1)))
        return rects

    page = doc[start.page_index]
    rects.append((start.page_index, fitz.Rect(0, start.y0 - 4, page.rect.width, page.rect.height)))
    for p in range(start.page_index + 1, end_page):
        rects.append((p, fitz.Rect(0, 0, doc[p].rect.width, doc[p].rect.height)))
    last = doc[end_page]
    rects.append((end_page, fitz.Rect(0, 0, last.rect.width, end.y0 if end else last.rect.height)))
    return rects


def _text_layer(doc: fitz.Document, rects: list[tuple[int, fitz.Rect]]) -> str:
    return "\n".join(doc[page_index].get_text("text", clip=rect) for page_index, rect in rects)


def _looks_usable(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) < MIN_USABLE_CHARS:
        return False
    # measured on the accent-stripped text but BEFORE normalize() collapses
    # junk glyphs into spaces, which would otherwise make mojibake look clean
    folded = "".join(
        c for c in unicodedata.normalize("NFKD", stripped) if not unicodedata.combining(c)
    ).lower()
    dense = re.sub(r"\s", "", folded)
    if not dense:
        return False
    if len(_PRINTABLE_ASCII.findall(dense)) / len(dense) < MIN_ASCII_RATIO:
        return False
    if len(dense) < STOPWORD_CHECK_MIN_CHARS:
        return True
    return len(_STOPWORDS.findall(normalize(text))) >= MIN_STOPWORD_HITS


def _ocr_text(doc: fitz.Document, rects: list[tuple[int, fitz.Rect]]) -> str:
    chunks = []
    for page_index, rect in rects:
        pix = doc[page_index].get_pixmap(matrix=fitz.Matrix(OCR_TEXT_ZOOM, OCR_TEXT_ZOOM), clip=rect)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        chunks.append(pytesseract.image_to_string(img, lang="eng"))
    return "\n".join(chunks)


def extract_section_texts(cfg: YearConfig, section: CadernoSection) -> list[QuestionText]:
    doc = fitz.open(SOURCE / str(cfg.year) / section.filename)
    anchors = find_anchors(doc, 0, 0, pattern=section.pattern)

    out: list[QuestionText] = []
    for i, anchor in enumerate(anchors):
        end = anchors[i + 1] if i + 1 < len(anchors) else None
        rects = _clip_rects(doc, anchor, end)
        text = _text_layer(doc, rects)
        source = "pdf"
        if not _looks_usable(text):
            text = _ocr_text(doc, rects)
            source = "ocr"
        out.append(QuestionText(cfg.year, anchor.number, text, source))
    doc.close()
    return out


def extract_year_texts(cfg: YearConfig) -> list[QuestionText]:
    texts: list[QuestionText] = []
    for section in cfg.sections:
        texts.extend(extract_section_texts(cfg, section))
    return texts


def build_report(tagged: list[dict]) -> str:
    lines: list[str] = []
    total = len(tagged)
    untagged = [q for q in tagged if not q["topics"]]
    lines.append(f"Questoes: {total} | classificadas: {total - len(untagged)} "
                 f"({100 * (total - len(untagged)) / total:.1f}%) | sem topico: {len(untagged)}")
    lines.append("")

    primary = Counter(q["topics"][0] for q in tagged if q["topics"])
    any_topic = Counter(slug for q in tagged for slug in q["topics"])

    lines.append(f"{'topico':44} {'principal':>10} {'qualquer':>9} {'%prova':>7}")
    lines.append("-" * 74)
    for topic in TOPICS:
        p, a = primary.get(topic.slug, 0), any_topic.get(topic.slug, 0)
        lines.append(f"{topic.label[:44]:44} {p:>10} {a:>9} {100 * p / total:>6.1f}%")
    lines.append("")

    lines.append("Sem topico (revisar keywords):")
    for q in untagged:
        lines.append(f"  {q['id']} ({q['area']})")
    return "\n".join(lines)


def run(years: list[int], dry_run: bool) -> None:
    data = json.loads(OUT_DATA.read_text(encoding="utf-8"))
    by_id = {q["id"]: q for q in data["questions"]}

    TEXT_DIR.mkdir(parents=True, exist_ok=True)
    ocr_count = 0

    for year in years:
        cfg = YEAR_CONFIGS.get(year)
        if cfg is None:
            print(f"[WARN] no config for year {year}, skipping", file=sys.stderr)
            continue

        print(f"Classificando {year}...")
        texts = extract_year_texts(cfg)
        dump = {}
        for qt in texts:
            qid = f"{qt.year}-{qt.number:02d}"
            if qid not in by_id:
                print(f"[WARN] {qid}: texto extraido sem questao correspondente", file=sys.stderr)
                continue
            result = classify(qt.text)
            by_id[qid]["topics"] = result.topics
            if qt.source == "ocr":
                ocr_count += 1
            if not result.topics:
                print(f"[WARN] {qid}: nenhum topico (fonte={qt.source}, {len(qt.text)} chars)", file=sys.stderr)
            dump[qid] = {
                "source": qt.source,
                "topics": result.topics,
                "scores": dict(sorted(result.scores.items(), key=lambda kv: -kv[1])),
                "text": qt.text,
            }
        (TEXT_DIR / f"{year}.json").write_text(json.dumps(dump, ensure_ascii=False, indent=2), encoding="utf-8")

    for q in data["questions"]:
        q.setdefault("topics", [])

    tagged = data["questions"]
    report = build_report(tagged)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"\n{report}\n")
    print(f"Questoes lidas via OCR: {ocr_count}")

    if dry_run:
        print("[dry-run] questions.json nao foi alterado")
        return

    OUT_DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Topicos gravados em {OUT_DATA}")

    # the taxonomy itself ships to the app so labels/areas live in exactly one
    # place; the app derives all incidence statistics from questions.json
    OUT_TOPICS.write_text(
        json.dumps(
            {
                "generated_at": date.today().isoformat(),
                "topics": [{"slug": t.slug, "label": t.label, "area": t.area} for t in TOPICS],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Taxonomia gravada em {OUT_TOPICS}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--years", type=str, default="", help="comma separated years, default: all configured")
    parser.add_argument("--dry-run", action="store_true", help="report only, do not touch questions.json")
    args = parser.parse_args()

    years = [int(y) for y in args.years.split(",")] if args.years else sorted(YEAR_CONFIGS.keys())
    run(years, args.dry_run)
