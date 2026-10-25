# carve-ast2-lab

> **Experimental. Not a contract.** Nothing here is the Carve AST 2.0. The contract is whatever the spec rules in [carve#3262](https://github.com/markup-carve/carve/issues/3262) and [carve#3598](https://github.com/markup-carve/carve/issues/3598). Do not build on the shapes in this repository. It is archived once the spec PR for 2.0 merges.

A place to try the AST 2.0 design against real trees before it goes into the spec. It reads engine output only and never parses Carve itself.

## What it does

1. **Baseline.** Runs the pinned corpus (3,056 documents in `spec/tests/corpus`) through carve-js 0.1.14 and measures the 1.2 contract: schema validity, whether `fmt` written from the serialized tree matches `fmt` from the parse, tree size and node count. Result: `results/baseline-1.2.json`.
2. **Draft 2.0 schema** (planned): `schema/ast-schema-2.0.json`, with #3262 and #3598 applied.
3. **Upgrader and downgrader** (planned): 1.2 to 2.0 and back, so the same measurements run on 2.0 trees, including the round trip `fmt` depends on.
4. **Trial consumers** (planned): a generic walker, a minimal DOCX table and caption writer, the Pandoc JSON mapping.

Every open design question gets a measurement and an entry in [DECISIONS.md](DECISIONS.md). Those entries are the evidence for the spec PR.

## Pins

- `spec/`: submodule of markup-carve/carve at `2d8e545e`, the commit the 2.0 audit read.
- `@markup-carve/carve` 0.1.14, which is carve-js `origin/main` at that time.

## Run

```sh
git submodule update --init
npm ci
npm test
npm run baseline
```

## License

MIT
