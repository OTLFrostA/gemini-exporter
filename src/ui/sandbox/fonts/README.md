# Bundled fonts for the Typst sandbox compile container (P1b)

## NewCMMath-Regular.otf (1.2 MiB)

- **Source**: `NewCMMath-Regular.otf` from the `newcomputermodern` package on
  CTAN (`fonts/newcomputermodern/otf/`), downloaded 2026-09-26.
- **License**: GUST Font License (shipped verbatim alongside the font as
  `GUST-FONT-LICENSE.txt` in this directory; the work is distributed under
  LPPL v1.3c or later, plus a rename request for derived works — honored by
  the rename below). NewCMMath is not in the GPL+exception subset.
- **Modification**: the upstream file's internal family name is
  `NewComputerModernMath`. It was renamed to `NewCMMath` (name IDs 1/4/16 +
  CFF TopDict FullName/FamilyName) with fontTools so Typst matches the
  pinned `font-math = ("NewCMMath", "Noto Sans Math")` stack in
  `src/core/export/typst/templates/theme.typ`. No glyphs were altered;
  the OpenType MATH table is intact (verified).
- **Why this font**: minimal math fallback. Per the PDF font strategy
  decision (2026-09-25), body/CJK text prefers the user's locally installed
  fonts via the Local Font Access API; only the math font ships with the
  package so `eval(..., mode: "math")` never depends on host font order.
