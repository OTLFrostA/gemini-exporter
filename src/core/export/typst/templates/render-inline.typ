#import "components.typ": inline-code, safe-text

// v8 keeps declaration-order recursion safety: nested children are rendered through a
// local helper inside render-inline instead of calling render-inlines before it
// exists at module initialization time.
#let render-inline(node) = {
  let children(nodes) = {
    for child in nodes { render-inline(child) }
  }

  let kind = node.type
  if kind == "text" {
    safe-text(node.text)
  } else if kind == "strong" {
    strong(children(node.children))
  } else if kind == "emphasis" {
    emph(children(node.children))
  } else if kind == "inlineCode" {
    inline-code(node.text)
  } else if kind == "link" {
    link(node.url)[#children(node.children)]
  } else if kind == "lineBreak" {
    linebreak()
  } else if kind == "inlineMath" {
    // typst is a trusted renderer-derived field, never raw provider/user input.
    if "typst" in node { eval(node.typst, mode: "math") } else { inline-code(node.latex) }
  } else {
    if "text" in node { node.text } else { [�] }
  }
}

#let render-inlines(nodes) = {
  for node in nodes { render-inline(node) }
}
