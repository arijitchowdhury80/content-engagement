"""The accented-sentence-start defect, and its siblings.

`_SENT_END` required the next sentence to start with `[A-Z0-9]`, which is ASCII-only. Any German
or French sentence beginning with an accented capital was never recognised as a sentence start,
so the two sentences stayed one over-long span -- which `MAX_CHARS` then discarded.

154 of the 237 case-study records (65%) are de/fr, and that path had NEVER run: Blog served
English on /de/ and /fr/, so every candidate filter, chrome pattern and quality gate in the
carried code was tuned on English.

FINDING ONE DEFECT BY READING STRONGLY SUGGESTS SIBLINGS THAT READING WILL NOT FIND, so this
file tests the whole class -- sentence starts, abbreviations, and the structural chrome tests
that must work with no vocabulary at all -- rather than the one word that was caught.

These now guard the PACKAGE's splitter, which is the one production runs.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from algolia_enrichment.candidates import _SENT_END, _is_ui, split_candidates

ACCENTED_STARTS = [
    ("de", "Der Umsatz stieg. Über 40 Prozent mehr Conversions."),
    ("de", "Das Team wuchs. Ähnliche Ergebnisse folgten schnell."),
    ("fr", "Algolia a transformé la recherche. Étude de cas complète ici."),
    ("fr", "Les ventes ont augmenté. À partir de 2024, tout a changé."),
    ("fr", "Le trafic a doublé. Ça représente 2 millions de visites."),
    ("es", "Las ventas subieron. Éxito total en el primer trimestre."),
    ("pt", "O tráfego dobrou. Ótimos resultados no primeiro mês."),
]

ASCII_STARTS = [
    ("en", "Algolia improved search. Results got faster."),
    ("de", "Der Umsatz stieg. Mehr Conversions folgten."),
]


@pytest.mark.parametrize("lang,text", ACCENTED_STARTS)
def test_splits_on_accented_sentence_start(lang, text):
    assert len(_SENT_END.split(text)) == 2, (
        f"[{lang}] accented sentence start not recognised; the span is kept whole and "
        f"MAX_CHARS then discards it")


@pytest.mark.parametrize("lang,text", ASCII_STARTS)
def test_ascii_starts_still_split(lang, text):
    assert len(_SENT_END.split(text)) == 2


@pytest.mark.parametrize("text,why", [
    ("Das Team erzielte 3,1 Mio. US-Dollar Umsatz im ersten Quartal des Jahres.",
     "de: Mio. is an abbreviation, not a sentence end -- it appears in every revenue figure"),
    ("Le chiffre atteint 3,1 Mrd. EUR pour toute la région européenne cette année.",
     "de/fr: Mrd."),
    ("Am 12. August 2026 startete die neue Suche für alle europäischen Märkte.",
     "de: a German date is a digit and a period, not a sentence end"),
    ("Nous avons rencontré M. Dupont pour parler de la nouvelle architecture de recherche.",
     "fr: a single-letter initial is never a sentence end"),
])
def test_abbreviations_do_not_end_a_sentence(text, why):
    cands, _ = split_candidates(f"# T\n\n{text}\n")
    assert len(cands) == 1, f"{why}: split into {[c.text for c in cands]}"


@pytest.mark.parametrize("text", [
    "Loslegen Demo buchen",          # de CTA
    "CLAIM YOUR SPOT",               # en banner
    "00 TAGE 00 STUNDEN 00 Sekunden",  # de countdown timer
    "Fermer",                        # fr nav
    "Merci !",                       # fr
    "DEMANDER UNE DÉMO",             # fr banner
])
def test_chrome_is_detected_by_shape_in_every_language(text):
    """Deliberately NOT a word list. A CTA, a nav label, an all-caps banner and a timer share a
    shape -- few words, no sentence punctuation -- and that holds in five languages with no
    vocabulary at all. A word list is the monolingual trap in a different costume."""
    assert _is_ui(text, complete=False), f"chrome not detected by shape: {text!r}"


def test_a_german_body_yields_candidates_at_all():
    """The end-to-end version of the same class: if the splitter cannot cut German, the page
    produces one over-long span, MAX_CHARS discards it, and the record reads as THIN."""
    md = ("# Bringmeister Kundenbericht\n\n"
          "Bringmeister hat seine Produktsuche mit Algolia neu aufgebaut. Über 40 Prozent mehr "
          "Conversions wurden im ersten Quartal gemessen. Ähnliche Ergebnisse zeigten sich in "
          "allen deutschen Märkten. Das Team indexiert heute 1,2 Millionen Produkte.\n")
    cands, _ = split_candidates(md)
    assert len(cands) >= 3, f"German body produced only {len(cands)} candidates"


def test_a_french_body_yields_candidates_at_all():
    md = ("# Étude de cas\n\n"
          "L'entreprise a transformé sa recherche produit avec Algolia. À partir de 2024, le "
          "taux de conversion a augmenté de 34 pour cent. Ça représente deux millions de "
          "visites supplémentaires chaque mois. Les équipes gèrent désormais le classement.\n")
    cands, _ = split_candidates(md)
    assert len(cands) >= 3, f"French body produced only {len(cands)} candidates"
