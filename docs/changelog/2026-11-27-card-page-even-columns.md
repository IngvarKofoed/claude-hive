# Card page split evenly between its two columns

The card page's two columns are now equal width in every lane. Before, the chat took 60% and the brief, spec or
plan beside it took 40%. That left the brief and the spec too narrow to read comfortably next to the chat.

## Detail
- The Refine mockup (`docs/mockups/CardRefine.dc.html`) sizes the chat and the brief at about 55/45. The even
  split is a deliberate change from it, asked for by the user.
- One shared `.columns` rule sets the split for every lane, including Try it, Ship and Done, which have no chat.
- Below 60rem the page still falls back to a single column.
