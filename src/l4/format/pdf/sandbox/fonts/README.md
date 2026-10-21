# Bundled Fonts for Typst Sandbox

## 1. NewCMMath-Regular.otf (1.2 MiB)

- **Source**: `NewCMMath-Regular.otf` from the `newcomputermodern` package on CTAN (`fonts/newcomputermodern/otf/`).
- **License**: GUST Font License (shipped verbatim alongside the font as `GUST-FONT-LICENSE.txt`).
- **Modification**: Internal family name renamed from `NewComputerModernMath` to `NewCMMath` (name IDs 1/4/16 + CFF TopDict FullName/FamilyName) so Typst matches `font-math = ("NewCMMath", "Noto Sans Math")` in `src/l4/format/typst/templates/theme.typ`. No glyphs were altered and the OpenType MATH table is intact.
- **Why bundled**: Guarantees `eval(..., mode: "math")` always has an OpenType MATH table regardless of host environment.

## 2. NotoSansCJKsc-Regular.otf (15.7 MiB)

- **Copyright** (font name table, verbatim): © 2014-2021 Adobe (http://www.adobe.com/).
- **Source**: <https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf>
- **License**: SIL Open Font License 1.1, reproduced verbatim in `OFL-NotoSansCJK.txt`.
- **SHA256**: `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`.
- **Modification**: None. Full upstream font, not a test-character subset.
- **Why bundled**: Preserves CJK and Latin text when Local Font Access is denied, unavailable, or returns no suitable fonts. Loaded from extension assets with no runtime network requests. Installed fonts remain preferred when authorized.

## 3. NotoSansMono-Variable.ttf (1.6 MiB)

- **Copyright**: Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)
- **Source**: <https://github.com/google/fonts/blob/45e3d5269e4a17d823f6d84470bc084dc5ae46f6/ofl/notosansmono/NotoSansMono%5Bwdth,wght%5D.ttf>
- **License**: SIL Open Font License 1.1; verbatim copyright and license in `OFL-NotoSansMono.txt`.
- **SHA256**: `2cb2adb378a8f574213e23df697050b83c54c27df465a2015552740b2769a081`.
- **Modification**: None; file renamed for a stable asset path, font name tables unchanged.
- **Why bundled**: Keeps code and ASCII diagrams monospaced even when device fonts are unavailable. CJK characters in code fall back to Noto Sans CJK SC.
