// solve.js — a fast drop-in replacement for csv-reader 1.0.0.
//
// run(input) returns, for input {text, header}, exactly csv-reader 1.0.0's answer
// {columns, rows, errors}: the first record as columns when header is true (else null),
// every record at the first record's width (short ones padded with "", long ones cut),
// and every error met on the way, in the order met. The reading follows csv-reader's
// written policy to the letter:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - a CR outside quotes that is not part of a CRLF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled (""
//     inside it is one quote; each CRLF or lone CR inside it is read as LF); what follows
//     the closing quote, up to the next comma or line break, is appended as it stands
//     (quote_junk, when the field ends and something was appended);
//   - a quote that never closes is a literal character and the text after it is read
//     again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings;
//   - each error is {code, line, row} — line the 1-based line its record starts on
//     (every LF, CRLF and lone CR inside quotes counted), row its record's index in
//     rows (null for the header) — and a short_row error carries fields (the count it
//     had) while a long_row error carries extra (the fields that were cut).
//
// Where the speed comes from: a record that lies wholly inside one line is read
// inside that line. The main loop finds the line's LF with the engine's own indexOf;
// a line with no quote in it is split on its commas in native code, and a line with
// quotes is parsed field by field with indexOf and slice — a quoted field's contents
// one slice, doubled quotes undone with replaceAll. Only a record whose first line
// holds a CR, or whose quote does not close inside the line (a field spanning
// lines, or one that never closes), goes through the general reader below, and
// even there fields are cut out with slice and indexOf, never built a character at
// a time: an unquoted field is one slice unless a stray CR splits it, a quoted
// field's closing quote is found with indexOf and its contents taken as one slice
// unless a doubled quote or a CR inside makes a rebuild necessary.

/** How a field ended: at a comma (the record goes on), at a line break or at the end. */
const COMMA = 0;
const BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes
  // (null: the header). Every error met while reading it carries these two.
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field whose first `prefix` characters are already known (the
  // literal quote of an unterminated field, or a quoted field's value when junk
  // follows its closing quote). Returns [value, ended, added], where added counts
  // the characters this call kept — a stray CR is dropped, never kept.
  function readUnquoted(prefix) {
    if (prefix === '') {
      // The common case: the field ends at the next comma or LF, and only a CR
      // inside it (a stray, or the CR of a CRLF) needs a second look.
      const nc = text.indexOf(',', pos);
      const nn = text.indexOf('\n', pos);
      const end = nc === -1 ? nn : nn === -1 ? nc : Math.min(nc, nn);
      const seg = text.slice(pos, end === -1 ? n : end);
      const r = seg.indexOf('\r');
      if (r === -1) {
        if (end === -1) {
          pos = n;
          return [seg, END, seg.length];
        }
        pos = end + 1;
        if (end === nn) {
          line += 1;
          return [seg, BREAK, seg.length];
        }
        return [seg, COMMA, seg.length];
      }
      if (r === seg.length - 1 && end === nn && nn !== -1) {
        // The CR is the CRLF's: the field is the segment without it.
        pos = nn + 1;
        line += 1;
        const value = seg.slice(0, r);
        return [value, BREAK, value.length];
      }
      // A stray CR sits inside the field: read it the slow way below.
    }
    let i = pos;
    let seg = pos; // where the current kept run starts
    let pieces = null; // the kept runs, once a stray CR splits the field
    let added = 0;
    let ended;
    for (;;) {
      if (i >= n) {
        ended = END;
        pos = n;
        break;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        ended = COMMA;
        pos = i + 1;
        break;
      }
      if (c === 10) {
        ended = BREAK;
        pos = i + 1;
        line += 1;
        break;
      }
      if (c === 13) {
        if (text.charCodeAt(i + 1) === 10) {
          ended = BREAK;
          pos = i + 2;
          line += 1;
          break;
        }
        // A lone CR outside quotes: dropped, an error, and the field goes on.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (pieces === null) pieces = [prefix, text.slice(seg, i)];
        else pieces.push(text.slice(seg, i));
        added += i - seg;
        i += 1;
        seg = i;
        continue;
      }
      i += 1;
    }
    added += i - seg;
    if (pieces === null) return [prefix + text.slice(seg, i), ended, added];
    pieces.push(text.slice(seg, i));
    return [pieces.join(''), ended, added];
  }

  // Reads a field whose opening quote is at pos. Returns [value, ended].
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // The closing quote is the first quote that is not doubled.
    let i = open + 1;
    let q = -1;
    for (;;) {
      q = text.indexOf('"', i);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        i = q + 2;
        continue;
      }
      break;
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, the line count restarts
      // at the line the quote opened on, and the text after it is read again as
      // unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      const reread = readUnquoted('"');
      return [reread[0], reread[1]];
    }
    const raw = text.slice(open + 1, q);
    let value;
    if (raw.indexOf('\r') === -1 && raw.indexOf('"') === -1) {
      // Nothing to rewrite: the contents stand as they are; only the line count
      // moves, once per LF inside.
      value = raw;
      let k = raw.indexOf('\n');
      while (k !== -1) {
        line += 1;
        k = raw.indexOf('\n', k + 1);
      }
    } else {
      // Rebuild the contents: "" becomes ", each CR or CRLF becomes LF (and a line),
      // each LF stays (and is a line).
      const parts = [];
      const m = raw.length;
      let seg = 0;
      let j = 0;
      while (j < m) {
        const c = raw.charCodeAt(j);
        if (c === 34) {
          parts.push(raw.slice(seg, j), '"');
          j += 2;
          seg = j;
        } else if (c === 13) {
          parts.push(raw.slice(seg, j), '\n');
          line += 1;
          j += raw.charCodeAt(j + 1) === 10 ? 2 : 1;
          seg = j;
        } else {
          if (c === 10) line += 1;
          j += 1;
        }
      }
      parts.push(raw.slice(seg, m));
      value = parts.join('');
    }
    pos = q + 1;
    if (pos >= n) return [value, END];
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return [value, COMMA];
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return [value, BREAK];
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return [value, BREAK];
    }
    // What follows the closing quote is appended as it stands, up to the next comma
    // or line break; if anything was appended, the field ends with a quote_junk.
    const junk = readUnquoted(value);
    if (junk[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return [junk[0], junk[1]];
  }

  // Parses one record that lies wholly inside `seg`, one line of the text with no
  // CR in it: fields are cut out with indexOf and slice, a quoted field's contents
  // taken as one slice (doubled quotes undone with replaceAll). Returns
  // [fields, lastQuoted, junkErrors], or null when a quote opens that does not
  // close inside the line — the record then spans lines (or the quote never
  // closes) and the general reader takes it from the record's start. Junk errors
  // are only counted here and pushed by the caller on success, so a record the
  // general reader has to take over never reports one twice.
  function parseLine(seg) {
    const fields = [];
    const m = seg.length;
    let i = 0;
    let lastQuoted = false;
    let junkErrors = 0;
    for (;;) {
      if (i < m && seg.charCodeAt(i) === 34) {
        lastQuoted = true;
        let j = i + 1;
        let q = -1;
        for (;;) {
          q = seg.indexOf('"', j);
          if (q === -1) return null;
          if (seg.charCodeAt(q + 1) === 34) {
            j = q + 2;
            continue;
          }
          break;
        }
        const raw = seg.slice(i + 1, q);
        const value = raw.indexOf('"') === -1 ? raw : raw.replaceAll('""', '"');
        i = q + 1;
        if (i >= m) {
          fields.push(value);
          return [fields, lastQuoted, junkErrors];
        }
        if (seg.charCodeAt(i) === 44) {
          fields.push(value);
          i += 1;
          continue;
        }
        // Junk after the closing quote, up to the next comma or the line's end.
        let e = seg.indexOf(',', i);
        if (e === -1) e = m;
        if (e > i) junkErrors += 1;
        fields.push(value + seg.slice(i, e));
        if (e >= m) return [fields, lastQuoted, junkErrors];
        i = e + 1;
        continue;
      }
      lastQuoted = false;
      const e = seg.indexOf(',', i);
      if (e === -1) {
        fields.push(seg.slice(i));
        return [fields, lastQuoted, junkErrors];
      }
      fields.push(seg.slice(i, e));
      i = e + 1;
    }
  }

  while (pos < n) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields = null;
    let lastQuoted = false;
    // A record whose first line holds no CR is read inside that line: split on its
    // commas when it holds no quote either, else parsed field by field in the
    // line. Only a line with a CR, or a quote that does not close inside the
    // line, goes through the general reader.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? n : nl;
    let segEnd = lineEnd;
    if (nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('\r') === -1) {
      if (seg.indexOf('"') === -1) {
        fields = seg.split(',');
      } else {
        const parsed = parseLine(seg);
        if (parsed !== null) {
          fields = parsed[0];
          lastQuoted = parsed[1];
          for (let k = 0; k < parsed[2]; k++) {
            errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          }
        }
      }
      if (fields !== null) {
        pos = nl === -1 ? n : nl + 1;
        if (nl !== -1) line += 1;
      }
    }
    if (fields === null) {
      fields = [];
      let ended;
      do {
        lastQuoted = text.charCodeAt(pos) === 34;
        const field = lastQuoted ? readQuoted() : readUnquoted('');
        fields.push(field[0]);
        ended = field[1];
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its
    // stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
