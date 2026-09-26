#import "theme.typ": *
#import "components.typ": reading
#import "render-message.typ": render-messages

#let render-document(doc) = document-theme[
  #reading[
    #text(size: 18.1pt, weight: 650, fill: ink)[#doc.title]
    #v(4.5pt)
    #text(size: 7.85pt, fill: muted)[
      #doc.provider · #doc.date · #doc.messageCount messages
    ]
  ]
  #v(15.5pt)
  #render-messages(doc.messages)
]
