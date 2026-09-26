# Bundled Fonts for Typst Sandbox

## NewCMMath-Regular.otf (1.2 MiB)

- **Source**: `NewCMMath-Regular.otf` from the `newcomputermodern` package on CTAN (`fonts/newcomputermodern/otf/`).
- **License**: GUST Font License (shipped verbatim alongside the font as `GUST-FONT-LICENSE.txt`).
- **Modification**: Internal family name renamed from `NewComputerModernMath` to `NewCMMath` (name IDs 1/4/16 + CFF TopDict FullName/FamilyName) so Typst matches `font-math = ("NewCMMath", "Noto Sans Math")` in `src/core/export/typst/templates/theme.typ`. No glyphs were altered and the OpenType MATH table is intact.
- **Why bundled**: Body/CJK text resolves from the user's locally installed fonts via the Local Font Access API; shipping the math font guarantees `eval(..., mode: "math")` always has an OpenType MATH table regardless of host fonts.
