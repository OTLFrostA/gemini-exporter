# Bundled Fonts for Typst Sandbox

## 1. NewCMMath-Regular.otf (1.2 MiB)

- **Source**: `NewCMMath-Regular.otf` from the `newcomputermodern` package on CTAN (`fonts/newcomputermodern/otf/`).
- **License**: GUST Font License (shipped verbatim alongside the font as `GUST-FONT-LICENSE.txt`).
- **Modification**: Internal family name renamed from `NewComputerModernMath` to `NewCMMath` (name IDs 1/4/16 + CFF TopDict FullName/FamilyName) so Typst matches `font-math = ("NewCMMath", "Noto Sans Math")` in `src/core/export/typst/templates/theme.typ`. No glyphs were altered and the OpenType MATH table is intact.
- **Why bundled**: Guarantees `eval(..., mode: "math")` always has an OpenType MATH table regardless of host environment.

## 2. NotoSansSC-Regular.ttf (10 MiB)

- **Source**: Google Fonts Noto Sans SC (`googlefonts/noto-cjk`).
- **License**: SIL Open Font License 1.1 (shipped verbatim as `OFL-NotoSansSC.txt`).
- **Modification**: None, official upstream release.
- **Why bundled**: Guarantees that CJK (Simplified Chinese) and universal Latin typography render cleanly and reliably across all operating systems, sandboxed iframes, and headless test environments without relying on unstable `window.queryLocalFonts()` runtime prompts.
