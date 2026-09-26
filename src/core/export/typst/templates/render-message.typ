#import "theme.typ": *
#import "components.typ": *
#import "render-block.typ": render-blocks

#let render-attachment(attachment) = {
  if attachment.type == "image" {
    image-attachment(
      attachment.asset,
      attachment.name,
      attachment.meta,
      width: if "width" in attachment { attachment.width * 1% } else { 50% },
    )
  } else {
    file-attachment(attachment.name, attachment.kind, attachment.size)
  }
}

#let render-attachments(attachments) = {
  let file-only = true
  for attachment in attachments {
    if attachment.type == "image" { file-only = false }
  }

  if file-only {
    file-attachment-group(attachments)
  } else {
    for (index, attachment) in attachments.enumerate() {
      render-attachment(attachment)
      if index < attachments.len() - 1 { v(sp-sm) }
    }
  }
}

#let render-user-message(message) = {
  if "attachments" in message and message.attachments.len() > 0 {
    render-attachments(message.attachments)
    v(sp-md)
  }
  user-bubble(
    render-blocks(message.blocks, scope: "user"),
    plain-text: if "plainText" in message { message.plainText } else { "" },
  )
}

#let render-assistant-message(message) = {
  if "model" in message and message.model != "" { assistant-mark(model: message.model); v(sp-xs) }
  render-blocks(message.blocks)
}

#let render-message(message) = {
  if message.role == "user" { render-user-message(message) }
  else { render-assistant-message(message) }
}

#let render-messages(messages) = {
  for (index, message) in messages.enumerate() {
    render-message(message)
    if index < messages.len() - 1 {
      let next = messages.at(index + 1)
      if message.role == "user" and next.role == "assistant" {
        user-to-assistant-gap()
      } else if message.role == "assistant" and next.role == "user" {
        assistant-to-user-gap()
      } else {
        v(sp-xl)
      }
    }
  }
}
