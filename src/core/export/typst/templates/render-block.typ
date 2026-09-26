#import "theme.typ": *
#import "components.typ": *
#import "render-inline.typ": render-inlines

#let block-gap(previous, current) = {
  let a = previous.type
  let b = current.type
  if b == "heading" { sp-lg }
  else if a == "heading" { sp-xs }
  else if a == "paragraph" and b == "paragraph" { sp-sm }
  else if b == "list" or a == "list" { sp-sm }
  else if b == "code" or a == "code" { sp-md }
  else if b == "table" or a == "table" { sp-md }
  else if b == "image" or a == "image" { sp-md }
  else if b == "math" or a == "math" { sp-sm }
  else { sp-sm }
}

#let in-flow(body, scope, sticky: false) = {
  if scope == "user" { block(width: 100%, sticky: sticky)[#body] }
  else { reading(body, sticky: sticky) }
}

#let render-paragraph(node, scope, sticky: false) = in-flow([
  #render-inlines(node.children)
], scope, sticky: sticky)

#let render-heading(node, scope) = {
  if scope == "user" {
    block(width: 100%, sticky: true)[#heading(level: node.level)[#render-inlines(node.children)]]
  } else {
    reading(sticky: true)[#heading(level: node.level)[#render-inlines(node.children)]]
  }
}

#let render-list(node, scope) = {
  let items = node.items.map(item => [#render-inlines(item.children)])
  let body = if node.ordered { [#enum(..items)] } else { [#list(..items)] }
  in-flow(body, scope)
}

#let render-code(node, scope) = code-surface(node.language, node.text)

#let render-math(node, scope) = {
  if "typst" in node {
    let math = eval(node.typst, mode: "math")
    if scope == "user" { block(width: 100%)[#align(center)[#math]] } else { math-surface(math) }
  } else {
    quiet-note[
      无法排版该公式；保留原始 LaTeX：#inline-code(node.latex)
    ]
  }
}

#let render-table(node, scope) = {
  let headers = node.headers.map(cell => [#render-inlines(cell)])
  let rows = node.rows.map(row => row.map(cell => [#render-inlines(cell)]))
  let cols = if "columns" in node { node.columns } else { none }
  let aligns = if "aligns" in node { node.aligns } else { none }
  modern-table(headers, rows, columns: cols, aligns: aligns)
}

#let render-image(node, scope) = image-surface(
  node.asset,
  caption: if "caption" in node { node.caption } else { none },
)
#let render-file(node, scope) = file-attachment(node.name, node.kind, node.size)

#let render-quote(node, scope) = {
  if scope == "user" {
    block(width: 100%, stroke: (left: 1pt + rule-strong), inset: (left: 7pt))[#render-inlines(node.children)]
  } else {
    quote-surface(render-inlines(node.children))
  }
}

#let render-note(node, scope) = quiet-note(render-inlines(node.children))

#let render-unknown(node, scope) = unknown-surface(
  if "sourceType" in node { "Unsupported · " + node.sourceType } else { "Unsupported content" },
  if "fallback" in node { node.fallback } else { [Content preserved in archive but unavailable in this renderer.] },
)

#let render-block(node, scope: "assistant", sticky: false) = {
  let kind = node.type
  if kind == "paragraph" { render-paragraph(node, scope, sticky: sticky) }
  else if kind == "heading" { render-heading(node, scope) }
  else if kind == "list" { render-list(node, scope) }
  else if kind == "code" { render-code(node, scope) }
  else if kind == "math" { render-math(node, scope) }
  else if kind == "table" { render-table(node, scope) }
  else if kind == "image" { render-image(node, scope) }
  else if kind == "file" { render-file(node, scope) }
  else if kind == "quote" { render-quote(node, scope) }
  else if kind == "note" { render-note(node, scope) }
  else { render-unknown(node, scope) }
}

// Generic keep-with-next grammar. The rule is semantic and type-based, never
// keyed to a fixture/page number. All target blocks are either naturally small
// or page-breakable; images additionally have a page-relative height budget in v8.
#let should-keep-with-next(blocks, index) = {
  if index >= blocks.len() - 1 { false }
  else {
    let current = blocks.at(index)
    let next = blocks.at(index + 1)
    current.type == "paragraph" and next.type in ("table", "image", "math", "code")
  }
}

#let render-blocks(blocks, scope: "assistant") = {
  for (index, node) in blocks.enumerate() {
    if index > 0 { v(block-gap(blocks.at(index - 1), node)) }
    render-block(node, scope: scope, sticky: should-keep-with-next(blocks, index))
  }
}
