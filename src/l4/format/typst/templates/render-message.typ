#import "theme.typ": *
#import "components.typ": *
#import "render-block.typ": render-blocks

#let render-bubble-message(message) = context {
  let file-widths = message.minWidthCards.map(card => file-attachment-natural-width(card.label, card.metadata))
  user-bubble(
    render-blocks(message.blocks, scope: "bubble"),
    min-content-width: calc.max(0pt, ..file-widths),
    plain-text: if "plainText" in message { message.plainText } else { "" },
  )
}

#let render-flow-message(message) = {
  if "model" in message and message.model != "" { assistant-mark(model: message.model); v(sp-xs) }
  render-blocks(message.blocks)
}

#let render-message(message) = {
  if message.variant == "bubble" { render-bubble-message(message) }
  else { render-flow-message(message) }
}

#let render-messages(messages) = {
  for message in messages {
    render-message(message)
    if message.gapAfterPt > 0 { v(message.gapAfterPt * 1pt) }
  }
}
