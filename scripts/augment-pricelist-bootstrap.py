#!/usr/bin/env python3
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
"""
One-time bootstrap: augment Mario's "260604 Preisliste.xlsx" with the columns
our catalog importer needs, WITHOUT touching his calculation formulas.

For each workshop sheet it appends five columns to the right of the existing
data (append = no formula-reference shift), making every row self-describing
so the importer needs no per-sheet name/price-column logic:
    Code            stable 4-digit article number (catalog identity)
    Name            customer-facing catalog name
    Kategorie       top-level category (from the section heading)
    Unterkategorie  sub-category (from the sub-heading; blank if none)
    Einheit         sale unit (m² / lm / kg / Stk) → pricing model

The sale PRICE is NOT copied — the importer reads Mario's existing
"Preis Einheit Verkauf" column by header name (single source of truth).

Code reuse: Holz rows are matched to the existing catalog (scripts/seed-data)
by normalised name so they keep their 3xxx codes; Keramik matches the 4xxx
clay codes by product token. Metall gets a fresh 2xxx range, Textil a fresh
7xxx range, and any unmatched Holz/Keramik row continues its range.

Output: a sibling "...– mit Codes.xlsx" plus a reconciliation report.
"""
import json, re, sys
from pathlib import Path
import openpyxl

SRC = Path("/mnt/c/Users/Mike/Downloads/260604 Preisliste.xlsx")
OUT = SRC.with_name(SRC.stem + " – mit Codes.xlsx")
REPORT = Path("/tmp/pricelist_reconciliation.md")
SEED = Path("/home/michschn/werkstattwaedi/machine-auth-wt-firebase-dev-env/scripts/seed-data/catalog")
OPS = Path("/home/michschn/werkstattwaedi/machine-auth-wt-firebase-dev-env/../machine-auth-operations/scripts/seed-data/catalog")

# Pricing model → human sale-unit label written into the Einheit column.
# The importer maps the label back to the model (see shared/pricing import).
MODEL_TO_EINHEIT = {"area": "m²", "length": "lm", "weight": "kg",
                    "count": "Stk", "time": "h", "direct": "Stk", "sla": "Stk"}

def col(letter):  # 'A'->1
    return openpyxl.utils.column_index_from_string(letter)

def norm(s):
    return re.sub(r"[\s,]+", " ", str(s).strip().lower())

def fmt_staerke(raw):
    if raw is None or str(raw).strip() == "":
        return None
    s = str(raw).strip()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(mm)?$", s)
    return f"{m.group(1)} mm" if m else s

def as_price(v):
    if v is None:
        return None
    try:
        p = float(v)
    except (TypeError, ValueError):
        return None
    return p if p > 0 else None

# ── load existing catalog for code reuse ──────────────────────────────────────
def load_seed(name):
    p = OPS / name if (OPS / name).exists() else SEED / name
    return json.load(open(p))

holz_seed = load_seed("holz.json")
ker_seed = load_seed("keramik.json")
holz_by_name = {norm(i["name"]): i["code"] for i in holz_seed}
holz_max = max(int(i["code"]) for i in holz_seed)

# ── per-sheet parsing ─────────────────────────────────────────────────────────
# Each parser yields dicts: {row, name, kategorie, unterkategorie, price, model, note}
report_lines = []

def parse_holz(ws):
    PRODUCT, STAERKE, PRICE = col("E"), col("F"), col("L")
    TOP = {"Massivholz", "Holzplatten", "Dübel- und Rundstäbe", "Schleifmittel", "Varia"}
    MODEL = {"Massivholz": "area", "Holzplatten": "area",
             "Dübel- und Rundstäbe": "length", "Schleifmittel": "count", "Varia": "count"}
    top = sub = None
    cur_product = None
    out = []
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        price = as_price(ws.cell(r, PRICE).value)
        only_a = a is not None and price is None and all(
            ws.cell(r, c).value is None for c in range(2, PRICE + 1))
        if a == "Produkt" or a == "Anzahl":
            continue
        if only_a:
            txt = str(a).strip()
            if txt in TOP:
                top, sub = txt, None
            elif "Verkaufspreis =" in txt or "noch offen" in txt or "Bestellliste" in txt:
                pass  # margin note / title
            else:
                sub = txt
            continue
        if top is None or price is None:
            continue
        e = ws.cell(r, PRODUCT).value
        if e is not None:
            cur_product = str(e).strip()
        if cur_product is None:
            continue
        staerke = fmt_staerke(ws.cell(r, STAERKE).value)
        name = f"{cur_product} {staerke}" if staerke else cur_product
        # Schleifmittel repeats the same grit ("Korn 60") under several
        # sub-headings (Excenter / Rutscher / …) — those are *different*
        # products, so fold the sub-heading into the name to keep it unique.
        if top == "Schleifmittel" and sub:
            name = f"{sub} {name}"
        # Massivholz: species (the product) is the sub-category, matching the
        # existing catalog's ["Massivholz", "<species>"] grouping.
        unter = cur_product if top == "Massivholz" else (sub or "")
        out.append(dict(row=r, name=name, kategorie=top, unterkategorie=unter,
                        price=round(price, 2), model=MODEL[top], note=""))
    return out

def parse_metall(ws):
    A_B, A, B, STAERKE, PRODUCT, GRADE, PRICE = col("C"), col("C"), col("D"), col("E"), col("F"), col("F"), col("L")
    top = None
    out = []
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        price = as_price(ws.cell(r, PRICE).value)
        # heading: col A populated, no price (covers "Rundstahl..." sub-heads too)
        if a is not None and price is None and a not in ("Anzahl",):
            txt = str(a).strip()
            if "Verkaufspreis =" in txt or "Bestellliste" in txt:
                continue
            top = txt
            continue
        if top is None or price is None:
            continue
        aa = ws.cell(r, A).value
        bb = ws.cell(r, B).value
        st = ws.cell(r, STAERKE).value
        dims = "×".join(str(x).strip() for x in (aa, bb, st) if x is not None and str(x).strip() != "")
        name = f"{top} {dims}".strip()
        grade = ws.cell(r, GRADE).value
        out.append(dict(row=r, name=name, kategorie=top, unterkategorie="",
                        price=round(price, 2), model="length",
                        note=f"Stahl: {grade}" if grade else ""))
    return out

def parse_keramik(ws):
    PRODUCT, BESCHRIEB, PRICE = col("C"), col("D"), col("J")
    top = None
    out = []
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        c = ws.cell(r, PRODUCT).value
        price = as_price(ws.cell(r, PRICE).value)
        if a is not None and c is None:
            txt = str(a).strip()
            if "Verkaufspreis =" in txt or "Bestellliste" in txt:
                continue
            top = txt
            continue
        if c is None or price is None:
            continue
        d = ws.cell(r, BESCHRIEB).value
        name = f"{str(c).strip()}, {str(d).strip()}" if d else str(c).strip()
        out.append(dict(row=r, name=name, kategorie=top or "Tone", unterkategorie="",
                        price=round(price, 2), model="weight", note="", product=str(c).strip()))
    return out

def parse_textil(ws):
    PRODUCT, BESCHRIEB, FORMAT, PRICE = col("C"), col("D"), col("E"), col("L")
    top = None
    out = []
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        c = ws.cell(r, PRODUCT).value
        price = as_price(ws.cell(r, PRICE).value)
        if a is not None and c is None:
            txt = str(a).strip()
            if "Verkaufspreis =" in txt or "Bestellliste" in txt:
                continue
            top = txt
            continue
        if c is None or price is None:
            continue
        fmt = ws.cell(r, FORMAT).value
        name = f"{str(c).strip()} {str(fmt).strip()}" if fmt else str(c).strip()
        out.append(dict(row=r, name=name, kategorie=top or "Textil", unterkategorie="",
                        price=round(price, 2), model="count", note=""))
    return out

# ── code assignment ───────────────────────────────────────────────────────────
def assign_codes(rows, sheet):
    global holz_max
    if sheet == "Holz BL":
        nxt = holz_max + 1
        used = set()  # guard against assigning the same code to two rows
        matched = new = 0
        for row in rows:
            code = holz_by_name.get(norm(row["name"]))
            if code and code not in used:
                matched += 1
            else:
                code = str(nxt); nxt += 1; new += 1
                row["note"] = (row["note"] + " · NEU (kein Match im Katalog)").strip(" ·")
            row["code"] = code; used.add(code)
        report_lines.append(f"**Holz**: {len(rows)} Zeilen — {matched} mit bestehendem Code, {new} neu ({holz_max+1}–{nxt-1}).")
    elif sheet == "Keramik BL":
        # match clay by product token appearing in existing catalog name
        ops_codes = [(i["code"], norm(i["name"])) for i in ker_seed]
        used = set()
        nxt = max(int(i["code"]) for i in ker_seed) + 1
        matched = new = 0
        for row in rows:
            tok = norm(row.get("product", row["name"]))
            hit = next((cd for cd, nm in ops_codes if cd not in used and (nm.startswith(tok) or tok in nm)), None)
            if hit:
                row["code"] = hit; used.add(hit); matched += 1
            else:
                row["code"] = str(nxt); nxt += 1; new += 1
                row["note"] = (row["note"] + " · NEU/prüfen").strip(" ·")
        report_lines.append(f"**Keramik**: {len(rows)} Zeilen — {matched} per Produkt-Token gematcht, {new} neu/prüfen.")
    elif sheet == "Metall BL":
        nxt = 2001
        for row in rows:
            row["code"] = str(nxt); nxt += 1
        report_lines.append(f"**Metall**: {len(rows)} Zeilen — neue Codes 2001–{nxt-1}. Namen aus Profil+Mass synthetisiert; Hierarchie bitte prüfen.")
    elif sheet == "Textil BL":
        nxt = 7001
        for row in rows:
            row["code"] = str(nxt); nxt += 1
        report_lines.append(f"**Textil**: {len(rows)} Zeilen — neue Codes 7001–{nxt-1}.")
    return rows

# ── write columns into the workbook ───────────────────────────────────────────
def last_content_col(ws, header_row):
    last = 1
    for c in range(1, ws.max_column + 1):
        if ws.cell(header_row, c).value is not None:
            last = c
    return last

PARSERS = {"Holz BL": (parse_holz, 8), "Metall BL": (parse_metall, 6),
           "Keramik BL": (parse_keramik, 6), "Textil BL": (parse_textil, 6)}

def main():
    wb_vals = openpyxl.load_workbook(SRC, data_only=True)   # read values
    wb = openpyxl.load_workbook(SRC, data_only=False)        # preserve formulas for write
    total = 0
    skipped_report = []
    for sheet, (parser, header_row) in PARSERS.items():
        rows = parser(wb_vals[sheet])
        rows = assign_codes(rows, sheet)
        ws = wb[sheet]
        anchor = last_content_col(wb_vals[sheet], header_row) + 2  # gap col between
        headers = ["Code", "Name", "Kategorie", "Unterkategorie", "Einheit"]
        for i, h in enumerate(headers):
            ws.cell(header_row, anchor + i, h)
        for row in rows:
            r = row["row"]
            ws.cell(r, anchor + 0, row["code"])
            ws.cell(r, anchor + 1, row["name"])
            ws.cell(r, anchor + 2, row["kategorie"])
            ws.cell(r, anchor + 3, row["unterkategorie"])
            ws.cell(r, anchor + 4, MODEL_TO_EINHEIT.get(row["model"], "Stk"))
        total += len(rows)
        letter = openpyxl.utils.get_column_letter(anchor)
        report_lines.append(f"  ↳ Spalten Code/Name/Kategorie/Unterkategorie/Einheit ab Spalte **{letter}** in *{sheet}*.\n")
    wb.save(OUT)
    # report
    md = ["# Preislisten-Bootstrap — Reconciliation\n",
          f"Quelle: `{SRC.name}`  →  Ausgabe: `{OUT.name}`\n",
          f"**{total} importierbare Zeilen** über 4 Werkstätten.\n",
          "## Code-Zuteilung\n"] + report_lines + [
          "\n## Annahmen / bitte prüfen\n",
          "- **Metall**: Spalte F ist die Stahlsorte (kein Produktname). Namen wurden aus Überschrift + Mass synthetisiert (z. B. `Flachstahl 15×2`). Stahlsorte wandert in die Beschreibung. Kategorie-Hierarchie (ist *Blankstahl* übergeordnet?) konnte ich nicht eindeutig ableiten — alle Überschriften wurden als Top-Kategorie gesetzt.\n",
          "- **Metall/Textil**: Zeilen mit Preis 0 oder `#DIV/0!` wurden übersprungen (Daten noch nicht fertig).\n",
          "- **Massivholz**: Unterkategorie = Holzart (entspricht dem bestehenden Katalog, keine Änderung).\n",
          "- **Holzplatten/Dübel/Schleifmittel**: bestehende 3-stufige Kategorien werden auf 2 Stufen vereinfacht — beim Import als Änderung sichtbar.\n",
          "- **Codes sind ab jetzt stabil**: nicht umnummerieren/wiederverwenden. Neue Produkte = nächste freie Nummer.\n"]
    REPORT.write_text("".join(md))
    print("".join(md))
    print(f"\n✓ geschrieben: {OUT}")

if __name__ == "__main__":
    main()
