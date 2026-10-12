
## The editor (`web/`)

A 3-D bigraphical reactive system editor, in the browser (TypeScript, Vite, three.js). `cd web && npm run dev`;
`npm test` runs the engine's tests. The engine (`web/src/engine/`) is an implementation of the Lean spec in
`../chrysalis` (`Spec/Carrier.lean`, `Rule.lean`, `Match.lean`, `Axes/Reaction.lean`): reaction is composition,
checked by composing every occurrence's decomposition back to its state. Anything not in the spec is marked
PROVISIONAL (rates, the one-at-a-time policy) or as a kaleidoscope convention (`engine/text.ts` header).
The Python package (`kaleidoscope/`) is the earlier MAPK prototype; its rules live on in `web/src/systems/mapk.ts`.
