# Code style

- Use descriptive names for variables, functions, parameters and types. No abbreviations
  (`parent` not `p`, `element` not `el`, `index` not `i`, `label` not `l`).
  - Only exceptions: universally known acronyms (`id`, `url`, `json`, `html`, `ui`).
- Keep it DRY: extract repeated logic into a well-named function instead of duplicating it.
- Clean code:
  - small functions that do one thing, named after what they do
  - names explain intent, so comments explain *why*, not *what*
  - no dead code, commented-out code or unused parameters
  - early returns over deep nesting
- Use blank lines to separate contexts, so code reads in blocks:
  - between functions and methods (including methods inside object literals)
  - between a group of variable declarations and the code that follows
  - between logical steps inside a function (setup → work → return)
  - before a `return` that follows other statements
  - never more than one blank line in a row
- Code (names, comments, logs) in English.
- JS/Vue formatting follows `.prettierrc.json` (single quotes, no semicolons).
