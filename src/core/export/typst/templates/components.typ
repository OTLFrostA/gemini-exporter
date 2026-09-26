#import "theme.typ": *

#let reading(body, sticky: false) = block(width: reading-width, sticky: sticky, body)
#let wide(body) = block(width: 100%, body)

#let inline-code(code) = box(
  fill: inline-fill,
  inset: (x: 3.1pt, y: 0.9pt),
  radius: radius-inline,
  text(font: font-mono, size: 8.05pt, fill: ink-soft)[#code],
)

// Insert zero-width break opportunities into long unbroken tokens (URLs, hashes) so they wrap inside narrow cells.
#let safe-text(value, run-limit: 18) = {
  let token-pattern = regex("[A-Za-z0-9_./:?&=#%+\\-]{24,}")
  let token-char = regex("[A-Za-z0-9_./:?&=#%+\\-]")
  if value.match(token-pattern) == none {
    value
  } else {
    let run = 0
    for cluster in value.clusters() {
      cluster
      if cluster.match(token-char) == none {
        run = 0
      } else {
        run += 1
        let punctuation = cluster in ("/", "_", "-", ".", ":", "?", "&", "=", "#")
        if punctuation or run >= run-limit {
          h(0pt, weak: true)
          run = 0
        }
      }
    }
  }
}

// Typst has no CSS box-shadow blur; approximate elevation with two offset translucent rects.
#let elevated-frame(width, height, radius, fill, body, stroke: none, level: 1) = box(
  width: width,
  height: height + if level > 0 { elevation-far-y } else { 0pt },
)[
  #if level > 0 {
    place(
      top + left,
      dy: elevation-far-y - elevation-far-spread,
      dx: -elevation-far-spread,
      rect(
        width: width + 2 * elevation-far-spread,
        height: height + 2 * elevation-far-spread,
        radius: radius + elevation-far-spread,
        fill: shadow-far,
      ),
    )
    place(
      top + left,
      dy: elevation-near-y,
      rect(width: width, height: height, radius: radius, fill: shadow-near),
    )
  }
  #place(
    top + left,
    rect(width: width, height: height, radius: radius, fill: fill, stroke: stroke),
  )
  #place(top + left, body)
]

#let truncate-to-width(value, width, font-size: 8.25pt, weight: 560) = {
  if measure(text(size: font-size, weight: weight)[#value]).width <= width {
    value
  } else {
    let chars = value.clusters()
    let result = value
    while chars.len() > 3 and measure(
      text(size: font-size, weight: weight)[#(chars.join("") + "…")]
    ).width > width {
      chars = chars.slice(0, chars.len() - 1)
    }
    result = chars.join("") + "…"
    result
  }
}

#let truncate-filename-to-width(value, width, font-size: 8.25pt, weight: 560) = {
  if measure(text(size: font-size, weight: weight)[#value]).width <= width {
    value
  } else {
    let ext-match = value.match(regex("\\.[^./]+$"))
    if ext-match == none or ext-match.start == 0 {
      truncate-to-width(value, width, font-size: font-size, weight: weight)
    } else {
      let ext = ext-match.text
      let base = value.slice(0, ext-match.start)
      let ext-width = measure(text(size: font-size, weight: weight)[#ext]).width
      let base-width = calc.max(width - ext-width, 16pt)
      let chars = base.clusters()
      while chars.len() > 1 and measure(
        text(size: font-size, weight: weight)[#(chars.join("") + "…")]
      ).width > base-width {
        chars = chars.slice(0, chars.len() - 1)
      }
      chars.join("") + "…" + ext
    }
  }
}

#let user-to-assistant-gap() = v(sp-xl)
#let assistant-to-user-gap() = v(sp-turn)

#let sparkle-mark() = box(width: 6.5pt, height: 6.5pt)[
  #place(center)[
    #rotate(45deg, square(size: 3.2pt, fill: accent))
  ]
]

#let assistant-mark(model: "") = {
  if model != "" {
    reading(
      block(sticky: true)[
        #grid(
          columns: (auto, auto),
          column-gutter: 5pt,
          align: horizon,
          sparkle-mark(),
          text(size: 7.65pt, weight: 520, fill: muted)[#model],
        )
      ]
    )
  }
}

// Fit medium/long user prompts to candidate widths up to 72%, dropping elevation above
// user-elevation-max-height so multi-page prompts can break across pages.
#let user-bubble(body, plain-text: "") = layout(size => {
  let px = 12.5pt
  let py = 8.4pt
  let short-cutoff = size.width * 0.32
  let medium-cutoff = size.width * 0.54
  let max-width = size.width * 0.72

  let styled-body = block(width: 100%)[
    #set par(leading: user-leading, spacing: 0pt)
    #align(left)[#body]
  ]

  let raw-width = if plain-text == "" {
    max-width
  } else {
    measure(text(size: body-size)[#plain-text]).width + 2 * px
  }

  let bubble-width = if raw-width <= short-cutoff {
    raw-width
  } else if raw-width <= medium-cutoff {
    raw-width
  } else {
    let candidates = (
      size.width * 0.56,
      size.width * 0.62,
      size.width * 0.68,
      max-width,
    )
    let target = 31pt
    let fitting = candidates.find(w => {
      let inner = calc.max(w - 2 * px, 28pt)
      measure(width: inner, styled-body).height <= target
    })
    if fitting == none { max-width } else { fitting }
  }

  let inner-width = calc.max(bubble-width - 2 * px, 28pt)
  let content-height = measure(width: inner-width, styled-body).height
  let bubble-height = content-height + 2 * py
  let compact = bubble-height < user-elevation-max-height

  block(width: 100%, sticky: compact)[
    #align(right)[
      #if compact {
        elevated-frame(
          bubble-width,
          bubble-height,
          radius-user,
          user-fill,
          [
            #box(width: bubble-width, height: bubble-height)[
              #place(top + left, dx: px, dy: py)[
                #box(width: inner-width)[#styled-body]
              ]
            ]
          ],
          level: 1,
        )
      } else {
        block(
          width: bubble-width,
          fill: user-fill,
          inset: (x: px, y: py),
          radius: radius-user-long,
          breakable: true,
        )[#styled-body]
      }
    ]
  ]
})

#let file-icon() = box(width: 22pt, height: 22pt)[
  #place(center)[
    #rect(width: 22pt, height: 22pt, radius: 6pt, fill: accent-soft)
  ]
  #place(center)[
    #rect(width: 8.4pt, height: 10.6pt, radius: 1.3pt, stroke: 0.85pt + accent)
  ]
  #place(center, dy: 1.8pt)[
    #line(length: 4.3pt, stroke: 0.65pt + accent)
  ]
]

#let file-attachment-card(name, kind, size, card-width: none) = layout(size-info => {
  let px = 10.5pt
  let py = 8.3pt
  let icon-w = 22pt
  let gap = 8pt
  let resolved-width = if card-width == none { size-info.width } else { card-width }
  let card-height = attachment-card-height
  let text-area = calc.max(resolved-width - 2 * px - icon-w - gap, 32pt)
  let display-name = truncate-filename-to-width(name, text-area)
  let meta = kind + " · " + size

  elevated-frame(
    resolved-width,
    card-height,
    radius-attachment,
    page-fill,
    [
      #box(width: resolved-width, height: card-height)[
        #place(top + left, dx: px, dy: py)[#file-icon()]
        #place(top + left, dx: px + icon-w + gap, dy: py + 1pt)[
          #box(width: text-area)[
            #text(size: 8.25pt, weight: 560, fill: ink-soft)[#display-name]
            #v(2.2pt)
            #text(size: 7.1pt, fill: muted)[#meta]
          ]
        ]
      ]
    ],
    stroke: 0.45pt + rule,
    level: 2,
  )
})

#let file-attachment(name, kind, size) = layout(size-info => {
  let px = 10.5pt
  let icon-w = 22pt
  let gap = 8pt
  let name-w = measure(text(size: 8.25pt, weight: 560)[#name]).width
  let meta = kind + " · " + size
  let meta-w = measure(text(size: 7.1pt)[#meta]).width
  let natural = icon-w + gap + calc.max(name-w, meta-w) + 2 * px
  let max-width = size-info.width * attachment-single-max-ratio
  let card-width = calc.min(natural, max-width)

  block(width: 100%)[
    #align(right)[#file-attachment-card(name, kind, size, card-width: card-width)]
  ]
})

#let file-attachment-group(attachments) = layout(size => {
  let group-width = size.width * attachment-group-width-ratio
  let col-width = (group-width - attachment-grid-gap) / 2
  let stack-height = (attachments.len() * attachment-card-height
    + calc.max(attachments.len() - 1, 0) * sp-sm)
  let can-grid = col-width >= attachment-grid-min-card-width
  let use-grid = can-grid and stack-height > attachment-stack-max-height

  block(width: 100%)[
    #align(right)[
      #if use-grid {
        block(width: group-width)[
          #grid(
            columns: (1fr, 1fr),
            column-gutter: attachment-grid-gap,
            row-gutter: attachment-grid-gap,
            ..attachments.map(item => file-attachment-card(item.name, item.kind, item.size)),
          )
        ]
      } else {
        block(width: 100%)[
          #for (index, item) in attachments.enumerate() {
            file-attachment(item.name, item.kind, item.size)
            if index < attachments.len() - 1 { v(sp-sm) }
          }
        ]
      }
    ]
  ]
})

// Allow the caption container to exceed small image widths (up to 62% column width) so filenames don't wrap prematurely.
#let image-attachment(path, name, meta, width: 50%) = block(width: 100%)[
  #align(right)[
    #layout(size => {
      let img-w = width * size.width
      let img = image(path, width: img-w)
      let dims = measure(img)
      let cap-natural = measure(text(size: 7.35pt)[#(name + "  " + meta)]).width + 8pt
      let figure-w = calc.min(calc.max(img-w, cap-natural), size.width * 0.62)
      block(width: figure-w, breakable: false)[
        #align(right)[
          #elevated-frame(
            img-w,
            dims.height,
            radius-image,
            page-fill,
            [
              #box(width: img-w, height: dims.height)[
                #place(top + left)[
                  #block(width: img-w, height: dims.height, radius: radius-image, clip: true)[#img]
                ]
              ]
            ],
            stroke: 0.35pt + rule,
            level: 1,
          )
        ]
        #v(4.5pt)
        #grid(
          columns: (1fr, auto),
          column-gutter: 8pt,
          text(size: 7.35pt, weight: 510, fill: ink-soft)[#name],
          text(size: 6.95pt, fill: muted)[#meta],
        )
      ]
    })
  ]
]

#let code-surface(lang, code) = wide(
  block(
    width: 100%,
    fill: embedded-fill,
    stroke: 0.35pt + rule,
    radius: radius-code,
    clip: true,
    breakable: true,
  )[
    #block(sticky: true, inset: (left: 12pt, right: 12pt, top: 7pt, bottom: 2pt))[
      #text(size: 7.05pt, weight: 530, fill: muted)[#lang]
    ]
    #block(inset: (left: 12pt, right: 12pt, top: 2.5pt, bottom: 9.5pt))[
      #raw(code, block: true, lang: lang, theme: "quiet-light.tmTheme")
    ]
  ]
)

#let math-surface(body) = reading(
  block(width: 100%, breakable: false)[#align(center)[#body]]
)

#let image-surface(path, caption: none) = wide(
  layout(size => {
    let full = image(path, width: size.width)
    let natural = measure(full)
    let scaled = natural.height > figure-max-height
    let img-h = if scaled { figure-max-height } else { natural.height }
    let img-w = if scaled { size.width * (figure-max-height / natural.height) } else { size.width }
    let img = image(path, width: img-w)
    let caption-natural = if caption == none or caption == "" {
      img-w
    } else {
      calc.min(
        measure(text(size: 7.35pt)[#caption]).width + 4pt,
        figure-caption-max-width,
      )
    }
    let figure-w = calc.min(calc.max(img-w, caption-natural), size.width)

    block(width: 100%, breakable: false)[
      #align(center)[
        #block(width: figure-w)[
          #align(center)[
            #elevated-frame(
              img-w,
              img-h,
              radius-image,
              page-fill,
              [
                #box(width: img-w, height: img-h)[
                  #place(top + left)[
                    #block(width: img-w, height: img-h, radius: radius-image, clip: true)[#img]
                  ]
                ]
              ],
              stroke: 0.3pt + rule,
              level: 1,
            )
          ]
          #if caption != none and caption != "" {
            v(4.5pt)
            text(size: 7.35pt, fill: muted)[#caption]
          }
        ]
      ]
    ]
  })
)

#let quiet-note(body) = reading(
  block(stroke: (left: 1pt + rule-strong), inset: (left: 7.5pt, y: 1pt))[
    #text(size: 8.1pt, fill: muted)[#body]
  ]
)

#let quote-surface(body) = reading(
  block(stroke: (left: 1pt + rule-strong), inset: (left: 8pt, y: 0pt))[
    #text(fill: ink-soft)[#body]
  ]
)

#let unknown-surface(label, body) = reading(
  block(fill: embedded-fill, radius: 7pt, inset: 8pt)[
    #text(size: 7.2pt, fill: muted)[#label]
    #v(3pt)
    #body
  ]
)

#let modern-table(headers, rows, columns: none, aligns: none) = wide(
  block(width: 100%)[
    #set text(size: 8.5pt)
    #let cols = if columns == none {
      if headers.len() > 0 { headers.len() }
      else if rows.len() > 0 { rows.first().len() }
      else { 1 }
    } else { columns.map(x => x * 1fr) }
    #let al = if aligns == none { left } else {
      aligns.map(x => if x == "center" { center } else if x == "right" { right } else { left })
    }
    #let header-cells = headers.map(h => table.cell(
      fill: header-fill,
      stroke: (bottom: 0.4pt + rule),
      text(size: 8.1pt, weight: 600)[#h],
    ))
    #let body-cells = rows.flatten().map(cell => table.cell(
      stroke: (bottom: 0.3pt + rule),
      cell,
    ))
    #let header-arg = if headers.len() > 0 {
      (table.header(repeat: true, ..header-cells),)
    } else { () }
    #table(
      columns: cols,
      inset: (x: 7pt, y: 6.5pt),
      align: al,
      stroke: none,
      ..header-arg,
      ..body-cells,
    )
  ]
)
