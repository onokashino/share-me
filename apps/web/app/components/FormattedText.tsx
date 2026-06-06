'use client';

/**
 * FormattedText.tsx — Auto-detect and safely render formatted text.
 *
 * XSS-SAFE: renders exclusively via React elements. No dangerouslySetInnerHTML,
 * no innerHTML, no eval. Markdown links are sanitized (http/https/mailto only).
 * XML/HTML is shown as escaped source text with syntax highlighting — never
 * injected as live markup. JWT segments are base64url-decoded and JSON-parsed
 * (try/catch) — never executed or verified.
 *
 * Supports: markdown, json, env (dotenv), key (PEM/SSH), url, plain,
 *           jwt, yaml, csv, xml, toml, diff.
 * Shows a format badge + Raw ↔ Formatted toggle.
 * env and key bodies are masked by default with a Reveal toggle.
 */

import { useMemo, useState, type ReactNode, type JSX } from 'react';
import { Icons } from '@/app/icons';
import { useI18n } from '@/app/i18n/useI18n';
import { detectFormat, type TextFormat } from '@/app/lib/text-format';

// ─── URL sanitizer ────────────────────────────────────────────────────────────

function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Inline markdown renderer ─────────────────────────────────────────────────

/**
 * Parse inline markdown (bold, italic, code, links) in a segment of text.
 * Returns an array of React nodes. Keys are based on `keyPrefix`.
 * XSS-SAFE: all text is rendered as React text nodes, links are sanitized.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // Order: code span first (no inner parsing), then link, bold, italic
  const parts: ReactNode[] = [];
  // Combined regex: `code` | [text](url) | **bold** | *italic* | _italic_
  const re = /(`[^`]+?`)|(\[([^\]]*)\]\(([^)]*)\))|(\*\*(.+?)\*\*)|(\*(.+?)\*|_(.+?)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const idx = m.index;
    if (idx > last) {
      parts.push(text.slice(last, idx));
    }

    if (m[1] !== undefined) {
      // inline code
      parts.push(<code key={`${keyPrefix}-c${idx}`} className="md-code">{m[1].slice(1, -1)}</code>);
    } else if (m[2] !== undefined) {
      // link [text](url)
      const linkText = m[3] ?? '';
      const href = m[4] ?? '';
      const safe = sanitizeUrl(href);
      if (safe) {
        parts.push(
          <a key={`${keyPrefix}-a${idx}`} href={safe} target="_blank" rel="noopener noreferrer" className="md-link">
            {linkText}
          </a>
        );
      } else {
        parts.push(linkText);
      }
    } else if (m[5] !== undefined) {
      // **bold**
      const boldContent = m[6] ?? '';
      parts.push(<strong key={`${keyPrefix}-b${idx}`}>{renderInline(boldContent, `${keyPrefix}-b${idx}`)}</strong>);
    } else if (m[7] !== undefined) {
      // *italic* or _italic_
      const italicContent = m[8] ?? m[9] ?? '';
      parts.push(<em key={`${keyPrefix}-i${idx}`}>{renderInline(italicContent, `${keyPrefix}-i${idx}`)}</em>);
    }

    last = idx + m[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts;
}

// ─── Markdown block renderer ─────────────────────────────────────────────────

function renderMarkdown(text: string): ReactNode {
  const rawLines = text.split('\n');
  const nodes: JSX.Element[] = [];
  let i = 0;
  let keyIdx = 0;

  const nextKey = () => `md-${keyIdx++}`;

  while (i < rawLines.length) {
    const line = rawLines[i]!;

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i]!.trimStart().startsWith('```')) {
        codeLines.push(rawLines[i]!);
        i++;
      }
      i++; // consume closing fence
      nodes.push(
        <pre key={nextKey()} className="fmt-code">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,6})\s(.*)/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      const content = headingMatch[2]!;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      nodes.push(
        <Tag key={nextKey()} className="md-heading">
          {renderInline(content, nextKey())}
        </Tag>
      );
      i++;
      continue;
    }

    // Blockquote: consecutive > lines
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < rawLines.length && /^>\s?/.test(rawLines[i]!)) {
        quoteLines.push(rawLines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      nodes.push(
        <blockquote key={nextKey()} className="md-blockquote">
          {quoteLines.map((ql, qi) => (
            <p key={qi}>{renderInline(ql, `bq-${qi}`)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // HR
    if (/^(\*{3,}|-{3,})$/.test(line.trim())) {
      nodes.push(<hr key={nextKey()} className="md-hr" />);
      i++;
      continue;
    }

    // Unordered list: consecutive - / * / + lines
    if (/^\s*[-*+]\s/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length && /^\s*[-*+]\s/.test(rawLines[i]!)) {
        items.push(rawLines[i]!.replace(/^\s*[-*+]\s/, ''));
        i++;
      }
      nodes.push(
        <ul key={nextKey()} className="md-ul">
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, `li-${ii}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list: consecutive `N. ` lines
    if (/^\s*\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < rawLines.length && /^\s*\d+\.\s/.test(rawLines[i]!)) {
        items.push(rawLines[i]!.replace(/^\s*\d+\.\s/, ''));
        i++;
      }
      nodes.push(
        <ol key={nextKey()} className="md-ol">
          {items.map((item, ii) => (
            <li key={ii}>{renderInline(item, `oli-${ii}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Blank line — skip (paragraphs are separated by content)
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: accumulate non-blank lines until a blank or a block element
    const paraLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i]!.trim() !== '' &&
      !/^(#{1,6}\s|>\s?|\s*[-*+]\s|\s*\d+\.\s|```)/.test(rawLines[i]!) &&
      !/^(\*{3,}|-{3,})$/.test(rawLines[i]!.trim())
    ) {
      paraLines.push(rawLines[i]!);
      i++;
    }

    if (paraLines.length > 0) {
      const paraText = paraLines.join(' ');
      nodes.push(
        <p key={nextKey()} className="md-p">
          {renderInline(paraText, `p-${keyIdx}`)}
        </p>
      );
    }
  }

  return <div className="md-body">{nodes}</div>;
}

// ─── JSON syntax highlighter ─────────────────────────────────────────────────

function renderJson(text: string): ReactNode {
  let pretty: string;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return <pre className="fmt-pre">{text}</pre>;
  }

  return renderJsonPretty(pretty);
}

/**
 * Tokenise an already-pretty-printed JSON string into highlighted React nodes.
 * Extracted so JWT can reuse it for header/payload segments.
 */
function renderJsonPretty(pretty: string): ReactNode {
  // Tokenize into spans by type
  const tokenRe = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(true|false|null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let ki = 0;

  while ((m = tokenRe.exec(pretty)) !== null) {
    const before = pretty.slice(last, m.index);
    if (before) nodes.push(before);

    const matched = m[0];
    let cls: string;
    if (m[1] !== undefined) {
      cls = 'tok-key';
    } else if (m[2] !== undefined) {
      cls = 'tok-str';
    } else if (m[3] !== undefined) {
      cls = 'tok-bool';
    } else {
      cls = 'tok-num';
    }

    nodes.push(<span key={`tok-${ki++}`} className={cls}>{matched}</span>);
    last = m.index + matched.length;
  }

  if (last < pretty.length) nodes.push(pretty.slice(last));

  return <pre className="fmt-pre fmt-code">{nodes}</pre>;
}

// ─── .env renderer ───────────────────────────────────────────────────────────

function renderEnv(text: string, revealed: boolean): ReactNode {
  const lines = text.split('\n');
  const rows = lines.map((line, idx) => {
    if (line.trim() === '') {
      return <span key={idx} className="env-blank">{'\n'}</span>;
    }
    if (line.trim().startsWith('#')) {
      return (
        <span key={idx} className="tok-comment">
          {line}
          {'\n'}
        </span>
      );
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx);
      const val = line.slice(eqIdx + 1);
      const displayVal = revealed
        ? val
        : '•'.repeat(Math.min(val.length, 24));
      return (
        <span key={idx}>
          <span className="tok-key">{key}</span>
          {'='}
          <span className={revealed ? 'tok-str' : 'tok-masked'}>{displayVal}</span>
          {'\n'}
        </span>
      );
    }
    return <span key={idx}>{line}{'\n'}</span>;
  });

  return <pre className="fmt-pre fmt-code">{rows}</pre>;
}

// ─── Key / PEM renderer ──────────────────────────────────────────────────────

function isKeyHeader(line: string): boolean {
  return (
    /^-----(?:BEGIN|END) [A-Z ]+-----$/.test(line.trim()) ||
    /^(ssh-rsa|ssh-ed25519|ssh-dss|ecdsa-sha2-)/.test(line.trim())
  );
}

function renderKey(text: string, revealed: boolean): ReactNode {
  const lines = text.split('\n');
  const rows = lines.map((line, idx) => {
    if (line.trim() === '') {
      return <span key={idx}>{'\n'}</span>;
    }
    if (isKeyHeader(line)) {
      return (
        <span key={idx} className="tok-key">
          {line}
          {'\n'}
        </span>
      );
    }
    const displayLine = revealed
      ? line
      : line.replace(/\S/g, '').padEnd(0) + '•'.repeat(Math.min(line.replace(/\s/g, '').length, 48));
    return (
      <span key={idx} className={revealed ? '' : 'tok-masked'}>
        {displayLine}
        {'\n'}
      </span>
    );
  });

  return <pre className="fmt-pre fmt-code key-body">{rows}</pre>;
}

// ─── JWT renderer ─────────────────────────────────────────────────────────────

/**
 * Decode a base64url segment. Returns a pretty-printed JSON string on success,
 * or null if decoding/parsing fails.
 * XSS-SAFE: pure string decode + JSON.parse, no eval, no DOM.
 */
function decodeJwtSegment(seg: string): string | null {
  try {
    // base64url → base64: replace - with + and _ with /
    let b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    // Pad to multiple of 4
    while (b64.length % 4 !== 0) b64 += '=';
    const decoded = atob(b64);
    // atob gives a binary string; decode as UTF-8
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    const text = new TextDecoder().decode(bytes);
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function renderJwt(text: string): ReactNode {
  const parts = text.trim().split('.');
  if (parts.length < 3) return <pre className="fmt-pre">{text}</pre>;

  const [rawHeader, rawPayload, rawSig] = parts as [string, string, string];

  const headerJson = decodeJwtSegment(rawHeader);
  const payloadJson = decodeJwtSegment(rawPayload);

  const headerBlock = headerJson
    ? renderJsonPretty(headerJson)
    : <pre className="fmt-pre fmt-code">{rawHeader}</pre>;

  const payloadBlock = payloadJson
    ? renderJsonPretty(payloadJson)
    : <pre className="fmt-pre fmt-code">{rawPayload}</pre>;

  return (
    <div className="jwt-parts">
      <div className="jwt-part">
        <span className="jwt-label">Header</span>
        {headerBlock}
      </div>
      <div className="jwt-part">
        <span className="jwt-label">Payload</span>
        {payloadBlock}
      </div>
      <div className="jwt-part">
        <span className="jwt-label">Signature</span>
        <pre className="fmt-pre fmt-code jwt-sig">{rawSig}</pre>
      </div>
    </div>
  );
}

// ─── YAML renderer ────────────────────────────────────────────────────────────

function renderYaml(text: string): ReactNode {
  const lines = text.split('\n');
  let ki = 0;
  const rows = lines.map((line, idx) => {
    const trimmed = line.trim();

    // Comment
    if (trimmed.startsWith('#')) {
      return (
        <span key={idx} className="tok-comment">
          {line}{'\n'}
        </span>
      );
    }

    // Document markers
    if (trimmed === '---' || trimmed === '...') {
      return (
        <span key={idx} className="tok-comment">
          {line}{'\n'}
        </span>
      );
    }

    // List dash only (leading `- ` with no key)
    if (/^\s*-\s/.test(line) && !/^\s*-\s*\w+:/.test(line)) {
      const dashMatch = /^(\s*-\s)(.*)$/.exec(line);
      if (dashMatch) {
        return (
          <span key={idx}>
            <span className="tok-comment">{dashMatch[1]}</span>
            {dashMatch[2]}{'\n'}
          </span>
        );
      }
    }

    // key: value  or  key:
    const kvMatch = /^(\s*)([\w."-]+)(\s*:\s*)(.*)$/.exec(line);
    if (kvMatch) {
      const indent = kvMatch[1]!;
      const key = kvMatch[2]!;
      const colon = kvMatch[3]!;
      const value = kvMatch[4]!;

      let valueNode: ReactNode = value;
      if (/^["'].*["']$/.test(value.trim())) {
        valueNode = <span className="tok-str">{value}</span>;
      }

      return (
        <span key={idx}>
          {indent}
          <span key={`yk-${ki++}`} className="tok-key">{key}</span>
          {colon}
          {valueNode}{'\n'}
        </span>
      );
    }

    return <span key={idx}>{line}{'\n'}</span>;
  });

  return <pre className="fmt-pre fmt-code">{rows}</pre>;
}

// ─── CSV renderer ─────────────────────────────────────────────────────────────

/**
 * Minimally parse a single CSV/TSV line, respecting "quoted,fields".
 * For complex quoting this falls back to a plain split — acceptable for display.
 */
function parseCsvLine(line: string, delim: string): string[] {
  if (delim === '\t') return line.split('\t');

  // Simple quoted-field parser for comma delimiter
  const fields: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function renderCsv(text: string): ReactNode {
  const lines = text.split('\n').filter((l) => l.trim() !== '');

  // Re-derive delimiter: tabs win if every line has consistent tab count
  let delim = ',';
  const tabCounts = lines.map((l) => l.split('\t').length - 1);
  if (tabCounts[0]! >= 1 && tabCounts.every((c) => c === tabCounts[0])) {
    delim = '\t';
  }

  const rows = lines.map((l) => parseCsvLine(l, delim));
  const [headerRow, ...bodyRows] = rows as [string[], ...string[][]];

  return (
    <div className="fmt-table-wrap">
      <table className="fmt-table">
        <thead>
          <tr>
            {headerRow.map((cell, ci) => (
              <th key={ci}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── XML renderer (source text, escaped) ─────────────────────────────────────

/**
 * Tokenise XML/HTML source into React spans with syntax colouring.
 * The angle brackets are just text strings React escapes automatically —
 * we NEVER inject live markup. XSS-SAFE by construction.
 */
function renderXml(text: string): ReactNode {
  // Token types we care about:
  //   <!-- comment -->
  //   <?...?>  processing instruction
  //   <!DOCTYPE...>
  //   <tagName  attr="val"  ...>   (opening/void)
  //   </tagName>                   (closing)
  //   text nodes between tags

  const nodes: ReactNode[] = [];
  let ki = 0;
  let pos = 0;

  while (pos < text.length) {
    const ltIdx = text.indexOf('<', pos);
    if (ltIdx === -1) {
      // Remaining text node
      nodes.push(text.slice(pos));
      break;
    }
    if (ltIdx > pos) {
      // Text before next tag
      nodes.push(text.slice(pos, ltIdx));
    }

    // Comment <!-- ... -->
    if (text.startsWith('<!--', ltIdx)) {
      const end = text.indexOf('-->', ltIdx);
      const endPos = end === -1 ? text.length : end + 3;
      nodes.push(
        <span key={`x-${ki++}`} className="tok-comment">
          {text.slice(ltIdx, endPos)}
        </span>
      );
      pos = endPos;
      continue;
    }

    // Find closing >
    const gtIdx = text.indexOf('>', ltIdx);
    if (gtIdx === -1) {
      nodes.push(text.slice(ltIdx));
      break;
    }

    const rawTag = text.slice(ltIdx, gtIdx + 1); // e.g. <div class="x">

    // Processing instruction or DOCTYPE — render as comment-style dim
    if (rawTag.startsWith('<?') || rawTag.startsWith('<!')) {
      nodes.push(
        <span key={`x-${ki++}`} className="tok-comment">
          {rawTag}
        </span>
      );
      pos = gtIdx + 1;
      continue;
    }

    // Closing tag </name>
    if (rawTag.startsWith('</')) {
      const nameMatch = /^<\/([A-Za-z][A-Za-z0-9_:-]*)/.exec(rawTag);
      const name = nameMatch ? nameMatch[1]! : '';
      nodes.push(
        <span key={`x-${ki++}`}>
          <span className="tok-tag">{'</'}</span>
          <span className="tok-tag">{name}</span>
          <span className="tok-tag">{'>'}</span>
        </span>
      );
      pos = gtIdx + 1;
      continue;
    }

    // Opening / void tag — parse name + attributes
    // rawTag: <name attr="val" attr2='val2' boolattr />
    const tagNameMatch = /^<([A-Za-z][A-Za-z0-9_:-]*)/.exec(rawTag);
    if (!tagNameMatch) {
      nodes.push(rawTag);
      pos = gtIdx + 1;
      continue;
    }

    const tagName = tagNameMatch[1]!;
    // Rest after tag name, before >
    const rest = rawTag.slice(1 + tagName.length, rawTag.endsWith('/>') ? -2 : -1);
    const selfClose = rawTag.endsWith('/>');

    // Tokenise attributes from `rest`
    const attrNodes: ReactNode[] = [];
    const attrRe = /\s+([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"?|'([^']*)'?|(\S+)))?/g;
    let am: RegExpExecArray | null;
    let attrLast = 0;
    while ((am = attrRe.exec(rest)) !== null) {
      if (am.index > attrLast) {
        attrNodes.push(rest.slice(attrLast, am.index));
      }
      const aName = am[1]!;
      const aVal = am[2] ?? am[3] ?? am[4];
      if (aVal !== undefined) {
        const raw = am[0]!;
        // Find the = in the original segment and determine quote style
        const eqIdx = raw.indexOf('=');
        const beforeEq = raw.slice(0, eqIdx + 1); // " attrName="
        const afterEq = raw.slice(eqIdx + 1);     // "value" or 'value' or value
        attrNodes.push(
          <span key={`a-${ki++}`}>
            {' '}
            <span className="tok-attr">{aName}</span>
            {'='}
            <span className="tok-str">{afterEq}</span>
          </span>
        );
      } else {
        attrNodes.push(
          <span key={`a-${ki++}`}>
            {' '}
            <span className="tok-attr">{aName}</span>
          </span>
        );
      }
      attrLast = am.index + am[0]!.length;
    }
    if (attrLast < rest.length) attrNodes.push(rest.slice(attrLast));

    nodes.push(
      <span key={`x-${ki++}`}>
        <span className="tok-tag">{'<'}</span>
        <span className="tok-tag">{tagName}</span>
        {attrNodes}
        {selfClose
          ? <span className="tok-tag">{'/>'}</span>
          : <span className="tok-tag">{'>'}</span>}
      </span>
    );
    pos = gtIdx + 1;
  }

  return <pre className="fmt-pre fmt-code">{nodes}</pre>;
}

// ─── TOML renderer ────────────────────────────────────────────────────────────

function renderToml(text: string): ReactNode {
  const lines = text.split('\n');
  let ki = 0;
  const rows = lines.map((line, idx) => {
    const trimmed = line.trim();

    // Comment (; or #)
    if (trimmed.startsWith('#') || trimmed.startsWith(';')) {
      return (
        <span key={idx} className="tok-comment">
          {line}{'\n'}
        </span>
      );
    }

    // [section] or [[array]]
    if (/^\s*\[/.test(line) && line.includes(']')) {
      return (
        <span key={idx}>
          <strong className="tok-key">{line}</strong>{'\n'}
        </span>
      );
    }

    // key = value
    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1) {
      const key = line.slice(0, eqIdx);
      const val = line.slice(eqIdx + 1);
      let valNode: ReactNode = val;
      const trimVal = val.trim();
      if (/^["']/.test(trimVal) || /^"""/.test(trimVal)) {
        valNode = <span key={`tv-${ki++}`} className="tok-str">{val}</span>;
      }
      return (
        <span key={idx}>
          <span className="tok-key">{key}</span>
          {'='}
          {valNode}{'\n'}
        </span>
      );
    }

    return <span key={idx}>{line}{'\n'}</span>;
  });

  return <pre className="fmt-pre fmt-code">{rows}</pre>;
}

// ─── Diff renderer ────────────────────────────────────────────────────────────

function renderDiff(text: string): ReactNode {
  const lines = text.split('\n');
  const rows = lines.map((line, idx) => {
    // Meta lines: diff/index/+++ /---
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('+++ ') ||
      line.startsWith('--- ')
    ) {
      return (
        <span key={idx} className="diff-meta">
          {line}{'\n'}
        </span>
      );
    }
    // Hunk header @@ ... @@
    if (line.startsWith('@@')) {
      return (
        <span key={idx} className="diff-hunk">
          {line}{'\n'}
        </span>
      );
    }
    // Added lines (but not +++)
    if (line.startsWith('+')) {
      return (
        <span key={idx} className="diff-add">
          {line}{'\n'}
        </span>
      );
    }
    // Removed lines (but not ---)
    if (line.startsWith('-')) {
      return (
        <span key={idx} className="diff-del">
          {line}{'\n'}
        </span>
      );
    }
    return <span key={idx}>{line}{'\n'}</span>;
  });

  return <pre className="fmt-pre fmt-code">{rows}</pre>;
}

// ─── Badge meta ───────────────────────────────────────────────────────────────

const FORMAT_META: Record<
  TextFormat,
  { icon: keyof typeof Icons; label: string }
> = {
  markdown: { icon: 'hash',     label: 'Markdown' },
  json:     { icon: 'files',    label: 'JSON' },
  env:      { icon: 'key',      label: '.env' },
  key:      { icon: 'lock',     label: 'Key' },
  url:      { icon: 'globe',    label: 'URL' },
  plain:    { icon: 'hash',     label: 'Text' },
  jwt:      { icon: 'shield',   label: 'JWT' },
  yaml:     { icon: 'files',    label: 'YAML' },
  csv:      { icon: 'hash',     label: 'CSV' },
  xml:      { icon: 'globe',    label: 'XML' },
  toml:     { icon: 'key',      label: 'TOML' },
  diff:     { icon: 'bolt',     label: 'Diff' },
};

// ─── Main component ───────────────────────────────────────────────────────────

export function FormattedText({ text }: { text: string }) {
  const { L } = useI18n();
  const format = useMemo(() => detectFormat(text), [text]);
  const [raw, setRaw] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const meta = FORMAT_META[format];
  const BadgeIcon = Icons[meta.icon];
  const needsReveal = format === 'env' || format === 'key';

  let body: ReactNode;
  if (raw) {
    body = <pre className="fmt-pre">{text}</pre>;
  } else {
    switch (format) {
      case 'markdown':
        body = renderMarkdown(text);
        break;
      case 'json':
        body = renderJson(text);
        break;
      case 'env':
        body = renderEnv(text, revealed);
        break;
      case 'key':
        body = renderKey(text, revealed);
        break;
      case 'url': {
        const safe = sanitizeUrl(text.trim());
        body = safe
          ? (
            <a className="fmt-url" href={safe} target="_blank" rel="noopener noreferrer">
              {text}
            </a>
          )
          : <pre className="fmt-pre">{text}</pre>;
        break;
      }
      case 'jwt':
        body = renderJwt(text);
        break;
      case 'yaml':
        body = renderYaml(text);
        break;
      case 'csv':
        body = renderCsv(text);
        break;
      case 'xml':
        body = renderXml(text);
        break;
      case 'toml':
        body = renderToml(text);
        break;
      case 'diff':
        body = renderDiff(text);
        break;
      default:
        body = <pre className="fmt-pre">{text}</pre>;
    }
  }

  return (
    <div className="fmt-root">
      <div className="fmt-bar">
        <span className="fmt-badge">
          <BadgeIcon sw={2} />
          {meta.label}
        </span>
        <div className="fmt-controls">
          {needsReveal && (
            <button
              className="fmt-toggle-btn"
              onClick={() => setRevealed((v) => !v)}
              type="button"
            >
              <Icons.eye sw={2} />
              {revealed ? L.hide : L.reveal}
            </button>
          )}
          <button
            className="fmt-toggle-btn"
            onClick={() => setRaw((v) => !v)}
            type="button"
          >
            {raw ? L.fmtRich : L.fmtRaw}
          </button>
        </div>
      </div>
      <div className="fmt-body">{body}</div>
    </div>
  );
}
