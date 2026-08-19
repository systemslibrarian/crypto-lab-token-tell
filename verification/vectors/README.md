# Hand-authored vectors

Everything else this lab checks against was captured from a reference implementation.
These were written by hand, on purpose.

`canonicalization.json` pins what a canonical serialization of a small object should be.
Both the lab's TypeScript and the independent verifier are held to it. If either had
produced the expectations, agreement between them would mean only that they share an
assumption; because a person wrote them, agreement means both match something outside
either implementation.
