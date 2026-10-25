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
5. **Draft: source stages.** The root `stages` array names `blockImagePromotion`, `referenceResolution`, and `tableAlignment`. With `blockImagePromotion` declared, only a promoted paragraph carries `blockImage: true` and absence means not promoted (changed after the size breakdown, see Review of the trial results). Rejected a per-paragraph `promotionRan` flag because the refinement asks for a document-level declaration.
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

## Trial consumers

Every entry in this section is **draft**. The corpus has 3,056 documents. The 2.0 trees add 525,396 serialized bytes over 1.2. Each size row removes one feature from a fresh 2.0 tree; overlapping savings appear in more than one row, so the remainder is the delta minus the listed savings.

| Draft size cause | Bytes saved | Share of delta |
| --- | ---: | ---: |
| Paragraph `blockImage: false` | 82,745 | 15.7% |
| `cell_paragraph` wrappers | 31,902 | 6.1% |
| Caption nodes | 8,384 | 1.6% |
| Table group nodes | 12,213 | 2.3% |
| Compatibility data and root declaration | 4,662 | 0.9% |
| Root `stages` and `extensions` | 223,892 | 42.6% |
| Reference `namespace` | 20,046 | 3.8% |
| Discriminated marker, spacing, and task objects | 19,061 | 3.6% |
| Renamed keys alone | 6,247 | 1.2% |
| Unexplained remainder after summed ablations | 116,244 | 22.1% |

**Draft: walker.** A `children`-only walk reaches 14,855 of 26,623 nodes (55.8%) in 1.2 and 27,523 of 28,508 (96.5%) in 2.0. Full traversal uses 18 distinct slot names in the 1.2 role map and 15 in the 2.0 schema. Both schema or role guided walks reach every corpus node. The 2.0 walker derives its secondary slots from the schema, including nested extension slots.

**Draft: Pandoc JSON.** Pandoc 3.1.3 accepts 3,056 of 3,056 generated documents; 2,386 have no reported node losses. The most frequent losses are `comment` (291), `link_reference_definition` (171), `xref` (47), `footnote` (36), and `cell_wrap` (34). The existing 1.2 converter has 44 textual accesses to candidate nonprimary content slots; this trial converter has 5. This source count covers named node variables and the keys `caption`, `shortCaption`, `rows`, `items`, `cells`, `blocks`, `target`, `inline`, `old`, `new`, `pairs`, `fallback`, `prefix`, `suffix`, `title`, and `locator`. It is a source count, not a runtime branch count. Structural checks record one missing Pandoc table and nine missing Pandoc figures, all retained as failures in the result file.

**Draft: DOCX.** The writer ran on all 352 documents containing a table or figure (262 tables, 107 figures). Pandoc reads all 352 generated DOCX files. The writer reports 252 losses (200 before the review fixes below added inline markup and image placeholders). Structural checks list 54 missing-table reports, 13 cell-count mismatches, seven missing cell texts, and two span mismatches after the DOCX read; these remain failures in `results/consumer-formats.json`. LibreOffice could not start in the sandbox the trial ran in; run outside it, `npm run docx:soffice` converts 352 of 352 files to PDF.

**Draft: where 2.0 helped.** The shared `children` slot raises the walker share from 55.8% to 96.5%. Table head, body, and foot nodes map directly to Pandoc's table groups. `resolvedAlign` lets the table writers use a column's effective alignment. A caption node gives both writers one place to find caption content. The list marker object gives the Pandoc writer style, delimiter, and start together.

**Draft: where 2.0 got in the way.** DOCX captions require a single caption paragraph, so block captions need flattening and any nonparagraph child is reported as a loss. Pandoc has no direct `xref` form here; 47 occurrences, including occurrences inside mapped footnotes, are reported as losses. The Pandoc trial does not map `figure_group` (15 losses). Reference `namespace` adds 20,046 bytes and the trial writers do not use it.

**Draft: open decisions.** Option A's `cell_paragraph` costs 31,902 bytes and requires an unwrap in both writers; the DOCX structure failures leave its renderer behavior unresolved. `caption.short` maps to Pandoc's short caption but has no DOCX equivalent in this trial; the corpus does not establish a need for block content there. Extension payload size, metadata depth, fallback recursion, active-content limits, range position units, and edit binding were not exercised by these writers. Duplicate ID resolution and foreign resource references also remain untested. The 47 `xref` losses show that cross-reference output needs a separate mapping before that decision can be closed.

### Review of the trial results

Checked by hand after the trial run; also **draft**.

- **The DOCX structure failures are writer limits, not shape problems.** 53 of the 54 missing tables sit inside a container the trial writer does not descend into (31 in list items, 18 in block quotes, 3 in footnotes, the rest in definitions, admonitions and a figure group). The 54th is an empty CSV table with no rows, which DOCX cannot hold. The cell-count, cell-text and span mismatches are all ragged tables and span-marker edge cases (corpus 98, 106, 107, 284, 328, 579, 594), where the reader pads rows. All nine missing Pandoc figures and the one missing table are composite figures (corpus 318), which the trial maps as a loss.
- **Option A has support.** `cell_paragraph` maps one to one onto Pandoc's `Plain` and onto the `w:p` every DOCX `w:tc` must contain, so neither writer needs a special case for it. The cost is 31,902 bytes (6.1% of the delta). This counts in favor of option A for carve#3262 item 10.
- **Most of the size delta is fixed per-document overhead.** Root `stages` and `extensions` are 223,892 bytes, 73 bytes per document, on a corpus whose average 1.2 tree is 1,085 bytes. Without them the delta was 301,504 bytes, 9.1% of the 1.2 total (6.6% after the `blockImage` change below), and on a real document the fixed part is negligible.
- **`blockImage: false` on every paragraph was the largest per-node cost** (82,745 bytes, 15.7% of the delta). Applied: when the root declares `blockImagePromotion` in `stages`, an absent `blockImage` means the paragraph was not promoted, and the field is `const: true`. That keeps the refinement's meaning without repeating it on every paragraph. After the change the round trip stays exact for 3,056 of 3,056, the 2.0 trees are 13.4% larger than 1.2 (was 15.8%), and 6.6% without the fixed root overhead. `results/size-breakdown.json` has the current per-cause numbers; the table above is from before this change.
- **`namespace` on references** (20,046 bytes) is unused by both writers, but they resolve no references; a resolver or a link checker is the consumer that would use it. Not decided by this trial.
- **Loss reporting in the trial writers needed four review rounds.** Inline markup the DOCX writer cannot write, images replaced by placeholders, cell alignment written to an empty paragraph, and a Pandoc cell alignment read from the wrong column after a span marker: each was fixed with a test that fails against the old code. The trial loss counts are therefore lower bounds. The same lesson as entry 25 applies to the real writers: a loss list built by hand misses cases, so it needs a check that compares output against input, not only a list of unsupported node types.
