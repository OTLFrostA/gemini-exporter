#import "components.typ": inline-code, safe-text

// Inline images sit on the text baseline with a font-relative size budget:
// never taller than a few line boxes (4.5em ≈ 3.3 body line boxes) and never
// wider than the enclosing column. `fit: "contain"` preserves the aspect
// ratio; nothing here is keyed to any particular fixture image. alt is a data
// parameter (never interpolated into source), so no markup escaping applies.

// v8 keeps declaration-order recursion safety: nested children are rendered through a
// local helper inside render-inline instead of calling render-inlines before it
// exists at module initialization time.
#let render-inline(node) = {
  let children(nodes) = {
    for child in nodes { render-inline(child) }
  }

  // asset is an adapter-controlled virtual path, never user text.
  let inline-image(path, alt: none) = image(
    path,
    height: 4.5em,
    width: 100%,
    fit: "contain",
    alt: alt,
  )

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
  } else if kind == "image" {
    inline-image(node.asset, alt: if "alt" in node { node.alt } else { none })
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
