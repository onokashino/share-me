/**
 * text-format.ts — Auto-detect the format of arbitrary plaintext.
 *
 * Pure TypeScript, no React, no external deps. Used by FormattedText.tsx
 * to choose a renderer. Priority order (specific → loose):
 *   1. key      — PEM headers / SSH public keys
 *   2. jwt      — ^eyJ….<base64url>.<base64url>.<base64url>$ (single token)
 *   3. diff     — requires `diff --git ` or unified `@@ -N +N @@` header
 *   4. json     — starts { or [ and parses cleanly
 *   5. xml      — trimmed starts < and has XML/DOCTYPE/element open-tag
 *   6. url      — single https?:// token, no whitespace
 *   7. toml     — has [section] header AND key = value lines
 *   8. env      — all-KEY=val lines with at least one ALL_CAPS key
 *   9. csv      — ≥2 non-empty lines, every line same comma or tab count (≥1)
 *  10. yaml     — starts with --- OR ≥2 key: lines making up ≥60% of content
 *  11. markdown — headings / lists / code-fences / links / bold / blockquotes
 *  12. plain
 */

export type TextFormat =
  | 'markdown'
  | 'json'
  | 'env'
  | 'key'
  | 'url'
  | 'plain'
  | 'jwt'
  | 'yaml'
  | 'csv'
  | 'xml'
  | 'toml'
  | 'diff';

/**
 * Detect the most likely text format for a given string.
 * Empty / whitespace-only → 'plain'.
 */
export function detectFormat(text: string): TextFormat {
  if (!text || !text.trim()) return 'plain';

  // 1. Private key / SSH public key
  if (/-----BEGIN [A-Z ]+-----/.test(text)) return 'key';
  // ssh-rsa / ssh-ed25519 / ssh-dss → must have a space after the type token
  // ecdsa-sha2- → matches the prefix (nistp256 etc. follows before the space)
  if (/^(ssh-rsa|ssh-ed25519|ssh-dss)\s/m.test(text)) return 'key';
  if (/^ecdsa-sha2-\S+\s/m.test(text)) return 'key';

  const trimmed = text.trim();

  // 2. JWT — single token matching ^eyJ<seg>.<seg>.<seg>$ (no whitespace)
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(trimmed)) {
    return 'jwt';
  }

  // 3. Diff — requires strong structural marker
  if (/^diff --git /m.test(text) || /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m.test(text)) {
    return 'diff';
  }

  // 4. JSON — starts { or [ and parses
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // not valid JSON — fall through
    }
  }

  // 5. XML — trimmed starts with < and has a recognised XML open
  if (
    trimmed.startsWith('<') &&
    (/^<\?xml/i.test(trimmed) ||
      /^<!DOCTYPE/i.test(trimmed) ||
      /^<[A-Za-z][A-Za-z0-9_:-]*(\s|>|\/)/.test(trimmed)) &&
    trimmed.includes('>')
  ) {
    return 'xml';
  }

  // 6. URL (single, no whitespace)
  if (!/\s/.test(trimmed) && /^https?:\/\/\S+$/.test(trimmed)) return 'url';

  const lines = text.split('\n');
  const dataLines = lines.filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

  // 7. TOML — has ≥1 [section] header AND ≥1 key = value line
  const hasSectionHeader = lines.some((l) => /^\s*\[[^\]]+\]\s*$/.test(l));
  const hasKvLine = lines.some((l) => /^\s*[\w.-]+\s*=\s*\S/.test(l));
  if (hasSectionHeader && hasKvLine) return 'toml';

  // 8. dotenv: every non-empty, non-comment line must look like KEY=…
  //    and at least one key must be ALL_CAPS (A-Z0-9_).
  if (dataLines.length > 0) {
    const allEnvLike = dataLines.every((l) => /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l));
    const hasAllCaps = dataLines.some((l) => /^[A-Z][A-Z0-9_]*\s*=/.test(l));
    if (allEnvLike && hasAllCaps) return 'env';
  }

  // 9. CSV/TSV — ≥2 non-empty lines; every line has the same delimiter count (≥1)
  const nonEmptyLines = lines.filter((l) => l.trim() !== '');
  if (nonEmptyLines.length >= 2) {
    for (const delim of [',', '\t'] as const) {
      const counts = nonEmptyLines.map((l) => {
        // Simple count — split by delimiter (unquoted fields good enough for detection)
        let count = 0;
        for (const ch of l) if (ch === delim) count++;
        return count;
      });
      const first = counts[0]!;
      if (first >= 1 && counts.every((c) => c === first)) {
        return 'csv';
      }
    }
  }

  // 10. YAML — starts with --- OR ≥2 key: lines making up ≥60% of content
  if (trimmed.startsWith('---')) return 'yaml';
  const nonEmptyNonComment = lines.filter(
    (l) => l.trim() !== '' && !l.trim().startsWith('#')
  );
  if (nonEmptyNonComment.length >= 2) {
    const yamlKeyLines = nonEmptyNonComment.filter((l) =>
      /^\s*[\w.-]+:(\s+\S.*)?$/.test(l)
    );
    if (
      yamlKeyLines.length >= 2 &&
      yamlKeyLines.length / nonEmptyNonComment.length >= 0.6
    ) {
      return 'yaml';
    }
  }

  // 11. Markdown
  if (
    /^#{1,6}\s/m.test(text) ||
    /^\s*([-*+]|\d+\.)\s/m.test(text) ||
    /```/.test(text) ||
    /\[.+?\]\(.+?\)/.test(text) ||
    /^>\s/m.test(text) ||
    /\*\*.+?\*\*/.test(text)
  ) {
    return 'markdown';
  }

  return 'plain';
}
