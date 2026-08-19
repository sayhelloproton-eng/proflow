# @tomflow/proflow-module-template

Standard generator for a ProFlow Module package that conforms to the thin Platform CLI model.

## Generates

- minimal `package.json.proflow` discovery metadata;
- static/runtime Module descriptor from the same facts;
- Module-owned status observation seam;
- applicable validate/start/stop adapter surface by kind;
- `provides/requires/configSlots/documentation`;
- configuration guidance when config slots exist.

## Does not generate

- `installClass` / `installRequires`;
- Core/Optional package classification;
- package-owned single-package Platform install wrappers;
- Platform-managed service-process instructions;
- fabricated business APIs or lifecycle.

Use the stable create CLI/library entry; fill real owner facts; then run deployment conformance.
