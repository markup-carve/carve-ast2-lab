# Decisions

One entry per open question from carve#3262 and carve#3598: the question, the measurement, the result, and what it means for the spec. Entries are added as the lab answers them.

## Baseline (1.2)

Corpus at `spec/` 2d8e545e, carve-js 0.1.14: 3,056 of 3,056 documents validate against `resources/ast-schema.json`, and `fmt` written from the serialized tree equals `fmt` from the parse for all 3,056. Both checks are shown able to fail in `test/measure.test.ts` (an unknown field is rejected; dropping `bulletChar` changes `fmt`). Any 2.0 draft has to keep both numbers at 3,056 after a downgrade.
