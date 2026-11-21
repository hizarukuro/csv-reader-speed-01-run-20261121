# csv-reader, read faster

An entry for **csv-reader-speed-01-run-20261121** ("Read broken CSV files faster"):
a dependency-free `solve.js` whose `run(input)` returns, for every input
`{text, header}`, exactly csv-reader 1.0.0's answer `{columns, rows, errors}` —
every field, every error object (code, line, row, and a short row's `fields` / a
long row's `extra`), the padding and cutting to the first record's width, the line
bookkeeping that counts every LF, CRLF and lone CR inside quotes, the BOM, the
unterminated-quote re-read, quote junk, stray CRs — and reads the file several
times faster than csv-reader itself. `main.ts` is the harness driver: it reads
`/input/cases.json`, answers each case with `run`, and writes
`/output/answers.json` (outside a container, `MAKEFUN_INPUT_DIR` and
`MAKEFUN_OUTPUT_DIR` stand in for `/input` and `/output`).

## Approach

csv-reader reads one character at a time and builds each field one character at a
time. This entry never does either:

- A record that lies wholly inside one line is read inside that line. The next LF
  is found with the engine's own `indexOf`; a line holding no quote is split on
  its commas in native code, and a line holding quotes is parsed field by field
  with `indexOf` and `slice` — a quoted field's contents are one slice, doubled
  quotes undone with `replaceAll`, junk after a closing quote appended as one
  more slice.
- Only a record whose first line holds a CR, or whose quote does not close
  inside the line (a field spanning lines, or a quote that never closes), falls
  back to a general reader — and even there, an unquoted field is found with
  `indexOf` and taken as one slice unless a stray CR splits it, and a quoted
  field's closing quote is found with `indexOf`, its contents taken as one slice
  unless a doubled quote or a CR inside makes a rebuild necessary.
- Error bookkeeping stays off the fast paths: the line parser only counts junk
  errors and reports them once the record is known to parse inside the line, so
  a record the general reader has to take over never reports one twice.

## Correctness

Identical output is the gate, so it is proven, not sampled:

- The kit's own `grade-local` on the practice set: **passed, 6 of 6 cases**,
  with the L1 regrade reproducing the outputs byte for byte.
- The kit's own generator (`program/generator/draw.ts`) was run with five
  seeds of our choosing — 30 further cases, about 51 MB of CSV — and on every
  set this entry's answers are byte-for-byte identical to the house baseline
  entry's, and the kit's scorer passes 6 of 6 against the oracle's reference.
- A differential fuzzer compared `run` against csv-reader's `readCsv` on
  20,194 hand-picked and randomly mutated inputs (every broken-row corner:
  unterminated quotes, doubled quotes at end of text, lone CRs in and out of
  quotes, junk after closing quotes, blank and CR-only lines, BOMs, ragged
  rows): zero mismatches.

## Speed

On this machine (Node 24, shared box, so treat the ratios as indicative):
`run` over the practice set's 10.2 M characters takes a median of ~284 ms cold
against the baseline's ~692 ms (≈2.4×), and ~90–170 ms warm against
~410–530 ms (≈3.2–5.3×); end to end through the driver, ~0.61–0.81 s of user
CPU against ~1.38–1.61 s (≈2.0–2.3×), the JSON reading and writing both
entries share included.

## Run it

```
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=<out dir> node main.ts
```

[![make.fun bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/hizarukuro/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/hizarukuro/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
Built with make.fun — referral code c23ct4sn
