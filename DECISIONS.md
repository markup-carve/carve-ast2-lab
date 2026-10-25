# Decisions

One entry per open question from carve#3262 and carve#3598: the question, the measurement, the result, and what it means for the spec. Entries are added as the lab answers them.

## Baseline (1.2)

Corpus at `spec/` 2d8e545e, carve-js 0.1.14: 3,056 of 3,056 documents validate against `resources/ast-schema.json`, and `fmt` written from the serialized tree equals `fmt` from the parse for all 3,056. Both checks are shown able to fail in `test/measure.test.ts` (an unknown field is rejected; dropping `bulletChar` changes `fmt`). Any 2.0 draft has to keep both numbers at 3,056 after a downgrade.

## AST 2.0 draft choices

Each choice below is **draft**. The 3,056 document corpus checks the upgrader and downgrader, not the merits of a shape for foreign formats.

1. **Draft: compatibility data.** The upgrader uses `org.markup-carve.ast12` in `data` for 1.2 facts that 2.0 removes, including `resolved`, short extension names, and the presence of optional fields. It declares the namespace on the root. Rejected a private top-level compatibility field because it would add a second must-ignore area.
2. **Draft: extension names.** A 1.2 extension name that is not qualified becomes `org.markup-carve.legacy.x` followed by its UTF-8 hex bytes; its old name stays in compatibility data. Rejected a plain prefix because names such as `_` still fail the qualified-name grammar.
3. **Draft: extension fallback.** A 1.2 inline extension gets an empty text fallback. Rejected copying its authored children into the fallback because that would assert rendering semantics the 1.2 node never declared.
4. **Draft: extension version.** `version` is optional on both extension node types, while root declarations carry a version. Rejected a fabricated version on every upgraded 1.2 node because 1.2 did not publish one.
5. **Draft: source stages.** The root `stages` array names `blockImagePromotion`, `referenceResolution`, and `tableAlignment`. Upgraded paragraphs carry `blockImage: false` when 1.2 omitted it. Rejected a per-paragraph `promotionRan` flag because the refinement asks for a document-level declaration.
6. **Draft: list markers.** `marker` is either `{kind:'bullet',char}` or `{kind:'ordered',style?,delimiter?,start?,bare?}`. The ordered style `1` means decimal. Rejected retaining `ordered` beside the marker because contradictory combinations would still validate.
7. **Draft: list spacing.** `spacing` uses `tight` or `loose` on lists and definition lists. A definition list without a 1.2 `loose` flag upgrades to `tight`. Rejected a boolean because the two old fields used opposite polarity.
8. **Draft: task status.** `task.mark` keeps the authored mark and `task.status` maps ` ` to todo, `x` to done, `-` to cancelled, `_` and `>` to partial, and `?` to other. Rejected deriving status only from `checked` because that loses the other marks.
9. **Draft: table content, option A trial.** `table_cell.children` always holds blocks. An inline source cell gets one `cell_paragraph` wrapper, whose children may contain `cell_wrap`. Rejected accepting ordinary `paragraph` here because it would admit `cell_wrap` in other paragraph contexts. The wrapper and tight-cell rendering rule need review before this becomes a contract.
10. **Draft: table groups.** `table.children` holds `table_head`, `table_body`, and `table_foot`. A table without authored `rowGroups` gets a leading head from consecutive all-header rows and a body for the remainder. Compatibility data records whether `rowGroups` was authored. Rejected keeping a flat `rows` list because its row counts can become stale after edits.
11. **Draft: column defaults.** `table_column.align` is the authored value; `resolvedAlign` is the header-precedence result. `authored: true` marks columns that had a 1.2 record, so generated columns do not appear on downgrade. Rejected overwriting `align` because that would change `fmt` input.
12. **Draft: captions.** `caption.children` contains block nodes; an upgraded inline caption gets one paragraph. `short` remains inline content. A table inside a figure retains its own caption, while the figure caption describes the outer figure. Rejected moving the table caption outward because it would erase a source fact.
13. **Draft: figures.** `figure.children` replaces `target` and may contain blocks; `kind` is optional and uses `image`, `table`, `listing`, `equation`, or `other`. Rejected inferring `kind` from the first child because mixed figures cannot be classified that way.
14. **Draft: reference keys.** Uses and definitions carry `key` and a `namespace`. Rejected type-specific key names because generic reference indexing still needs branches.
15. **Draft: cross-references.** `heading_ref` becomes `xref`; its `form` values are `number`, `page`, `title`, and `full`. Rejected plain links because they cannot say which display form was requested.
16. **Draft: duplicate IDs.** The first `attrs.id` in document order wins, with a diagnostic for each later occurrence. Rejected a uniqueness rule because existing documents may contain duplicates.
17. **Draft: literal fields.** Literal payloads move to `value`; smart punctuation's source spelling moves to `source`. Rejected leaving `content`, `text`, and `value` with overlapping roles because walkers must branch on type.
18. **Draft: grouping labels.** Container labels move to `groupLabel`, and math's prefix to `numberPrefix`. Rejected retaining `label` for both because the two values serve different roles.
19. **Draft: rich metadata.** `metadataValue` permits scalars, arrays, objects, and block lists. Nodes have optional `metadata`, while `data` uses qualified namespace keys. Rejected a string-only map because abstracts and editor metadata need structure.
20. **Draft: direction.** Nodes may carry `dir` as `ltr`, `rtl`, or `auto`, with language-style inheritance. Rejected a boolean right-to-left field because it cannot express automatic direction.
21. **Draft: contents target.** `directive.tocTarget` chooses headings, figures, tables, or listings. Rejected a longer closed directive-kind enum because it would need a core change for each future contents target.
22. **Draft: loss reporting.** Downgrade reports 2.0-only fields it removes by JSON path. Rejected silently discarding custom `data`, metadata, direction, segments, and foreign node fields because consumers need to identify loss.
23. **Draft: code titles.** `code_block.title` is an inline array; a 1.2 string header becomes one text node. Rejected keeping a string here because other visible titles already hold inline content.

24. **Draft: namespace only with a key.** `namespace` belongs to the reference, so a link or image with a direct destination and no `key` carries neither; the schema requires the two together. Rejected a `namespace` on every link and image because it says nothing about a node that references nothing.

25. **Draft: downgrade loss coverage.** For trees the upgrader produced, the round trip is exact (3,056 of 3,056). For 2.0 trees written by hand, the downgrader reports what 1.2 cannot hold, but its coverage is best-effort: review found three silent drops (stale row-group counts, a non-heading `xref` namespace, fields on a caption paragraph), each now fixed with a test. Groups 1.2 can spell are written as `rowGroups` instead of being reported. A complete loss check would compare every 2.0 field against the 1.2 schema; that belongs in the engines, not in this lab.

### Open decisions

- Verify option A's `cell_paragraph` and tight-cell rule in an actual renderer and format bridge.
- Decide whether `caption.short` should also hold blocks in a later revision.
- Specify extension payload size, metadata depth, fallback recursion, and active-content limits in the normative contract.
- Specify byte-based position units and edit binding in the range sidecar. Neither ranges nor node identity belongs in the tree.
- Test duplicate ID resolution and foreign resource references in consumers before the spec PR.
