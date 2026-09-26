#let page-fill = rgb("#FCFCFB")
#let ink = rgb("#202327")
#let ink-soft = rgb("#34383E")
#let muted = rgb("#737A84")
#let muted-2 = rgb("#A3A9B1")
#let rule = rgb("#E8EAED")
#let rule-strong = rgb("#DDE1E6")
#let user-fill = rgb("#EFF4F9")
#let embedded-fill = rgb("#F6F7F8")
#let header-fill = rgb("#F7F8F9")
#let inline-fill = rgb("#F1F3F5")
#let accent = rgb("#4E7CF6")
#let accent-soft = rgb("#EAF1FF")

#let shadow-near = rgb("#111827").transparentize(96%)
#let shadow-far = rgb("#111827").transparentize(98.4%)

#let font-ui = (
  "SF Pro Text",
  "SF Pro Display",
  "PingFang SC",
  "Helvetica Neue",
  "Arial",
  "Noto Sans CJK SC",
  "Noto Sans",
  "DejaVu Sans",
)

#let font-mono = (
  "SF Mono",
  "Menlo",
  "Monaco",
  "JetBrains Mono",
  "DejaVu Sans Mono",
)

#let font-math = (
  "NewCMMath",
  "Noto Sans Math",
)

#let body-size = 9.6pt
#let body-leading = 3.55pt
#let user-leading = 3.45pt
#let code-size = 8.15pt
#let reading-width = 147mm

#let page-width = 210mm
#let page-height = 297mm
#let page-margin-top = 18.5mm
#let page-margin-bottom = 18mm
#let page-margin-left = 22mm
#let page-margin-right = 22mm
#let page-body-height = page-height - page-margin-top - page-margin-bottom

#let radius-inline = 3.2pt
#let radius-code = 9pt
#let radius-user = 12pt
#let radius-user-long = 9.5pt
#let radius-attachment = 10pt
#let radius-image = 9pt

#let elevation-near-y = 0.75pt
#let elevation-far-y = 1.8pt
#let elevation-far-spread = 1.0pt

#let user-elevation-max-height = 120pt

#let figure-max-page-ratio = 0.60
#let figure-max-height = page-body-height * figure-max-page-ratio
#let figure-caption-max-width = 115mm

#let attachment-single-max-ratio = 48%
#let attachment-group-width-ratio = 70%
#let attachment-grid-gap = 7pt
#let attachment-card-height = 38.6pt
#let attachment-grid-min-card-width = 118pt
#let attachment-stack-max-height = 145pt

#let sp-micro = 3pt
#let sp-xs = 5pt
#let sp-sm = 7.5pt
#let sp-md = 10pt
#let sp-lg = 15.5pt
#let sp-xl = 19pt
#let sp-turn = 25pt

#let document-theme(body) = {
  set page(
    width: page-width,
    height: page-height,
    fill: page-fill,
    margin: (top: page-margin-top, bottom: page-margin-bottom, left: page-margin-left, right: page-margin-right),
    numbering: none,
    footer: context align(right)[
      #text(size: 6.8pt, fill: muted-2)[#counter(page).display("1")]
    ],
  )

  set text(
    font: font-ui,
    size: body-size,
    fill: ink,
    lang: "zh",
    cjk-latin-spacing: auto,
  )
  show math.equation: set text(font: font-math)
  set par(leading: body-leading, spacing: 0pt, justify: false)
  set list(indent: 0pt, body-indent: 0.66em, spacing: 2.6pt)
  set heading(numbering: none)

  show heading.where(level: 1): it => block(
    sticky: true,
    above: 0pt,
    below: 0pt,
    text(size: 14.4pt, weight: 650, fill: ink, it.body),
  )
  show heading.where(level: 2): it => block(
    sticky: true,
    above: 0pt,
    below: 0pt,
    text(size: 11.55pt, weight: 630, fill: ink, it.body),
  )
  show heading.where(level: 3): it => block(
    sticky: true,
    above: 0pt,
    below: 0pt,
    text(size: 10.1pt, weight: 620, fill: ink, it.body),
  )

  show link: set text(fill: accent)
  show raw.where(block: true): set text(font: font-mono, size: code-size)

  body
}
