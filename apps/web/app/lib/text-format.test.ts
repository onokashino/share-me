/**
 * text-format.test.ts
 *
 * Unit tests for detectFormat().
 * Follows the same Vitest style as history.test.ts.
 */

import { describe, expect, test } from 'vitest';
import { detectFormat } from './text-format';

// ─── json ────────────────────────────────────────────────────────────────────

describe('detectFormat — json', () => {
  test('detects plain object', () => {
    expect(detectFormat('{"key": "value"}')).toBe('json');
  });

  test('detects array', () => {
    expect(detectFormat('[1, 2, 3]')).toBe('json');
  });

  test('detects nested object', () => {
    expect(detectFormat('{\n  "a": 1,\n  "b": [true, null]\n}')).toBe('json');
  });

  test('ignores invalid JSON that starts with {', () => {
    expect(detectFormat('{not json}')).not.toBe('json');
  });
});

// ─── env ─────────────────────────────────────────────────────────────────────

describe('detectFormat — env', () => {
  test('detects typical .env with all-caps keys', () => {
    expect(
      detectFormat('DATABASE_URL=postgres://localhost/db\nSECRET_KEY=abc123')
    ).toBe('env');
  });

  test('accepts mixed case keys as long as one is ALL_CAPS', () => {
    expect(detectFormat('PORT=3000\nApp_Name=myapp')).toBe('env');
  });

  test('accepts comments and blank lines', () => {
    expect(
      detectFormat('# comment\n\nPORT=8080\nHOST=localhost')
    ).toBe('env');
  });

  test('rejects if no ALL_CAPS key present (all lowercase)', () => {
    expect(detectFormat('port=8080\nhost=localhost')).not.toBe('env');
  });

  test('rejects if lines do not match KEY= pattern', () => {
    expect(detectFormat('just some text\nmore text')).not.toBe('env');
  });
});

// ─── key ─────────────────────────────────────────────────────────────────────

describe('detectFormat — key', () => {
  test('detects PEM private key', () => {
    expect(
      detectFormat('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----')
    ).toBe('key');
  });

  test('detects PEM certificate', () => {
    expect(
      detectFormat('-----BEGIN CERTIFICATE-----\nMIIBkTCB+...\n-----END CERTIFICATE-----')
    ).toBe('key');
  });

  test('detects SSH RSA public key', () => {
    expect(detectFormat('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ user@host')).toBe('key');
  });

  test('detects SSH ed25519 public key', () => {
    expect(
      detectFormat('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GkZU')
    ).toBe('key');
  });

  test('detects ecdsa key', () => {
    expect(detectFormat('ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAA=')).toBe('key');
  });
});

// ─── markdown ────────────────────────────────────────────────────────────────

describe('detectFormat — markdown', () => {
  test('detects heading', () => {
    expect(detectFormat('# Hello World\nSome text')).toBe('markdown');
  });

  test('detects unordered list', () => {
    expect(detectFormat('- item one\n- item two')).toBe('markdown');
  });

  test('detects ordered list', () => {
    expect(detectFormat('1. first\n2. second')).toBe('markdown');
  });

  test('detects fenced code block', () => {
    expect(detectFormat('```\nconst x = 1;\n```')).toBe('markdown');
  });

  test('detects markdown link', () => {
    expect(detectFormat('Click [here](https://example.com) for more')).toBe('markdown');
  });

  test('detects bold', () => {
    expect(detectFormat('This is **bold** text')).toBe('markdown');
  });

  test('detects blockquote', () => {
    expect(detectFormat('> This is a quote')).toBe('markdown');
  });
});

// ─── url ─────────────────────────────────────────────────────────────────────

describe('detectFormat — url', () => {
  test('detects https URL', () => {
    expect(detectFormat('https://example.com/path?q=1#anchor')).toBe('url');
  });

  test('detects http URL', () => {
    expect(detectFormat('http://localhost:3000')).toBe('url');
  });

  test('rejects URL with spaces', () => {
    expect(detectFormat('https://example.com/path with spaces')).not.toBe('url');
  });

  test('rejects non-http URL', () => {
    expect(detectFormat('ftp://example.com')).not.toBe('url');
  });
});

// ─── plain ───────────────────────────────────────────────────────────────────

describe('detectFormat — plain', () => {
  test('plain text stays plain', () => {
    expect(detectFormat('Just some ordinary text here.')).toBe('plain');
  });

  test('empty string → plain', () => {
    expect(detectFormat('')).toBe('plain');
  });

  test('whitespace only → plain', () => {
    expect(detectFormat('   \n  \t  ')).toBe('plain');
  });

  test('multi-line prose → plain', () => {
    expect(
      detectFormat('Hello there.\nHow are you today?\nEverything is fine.')
    ).toBe('plain');
  });
});

// ─── jwt ─────────────────────────────────────────────────────────────────────

describe('detectFormat — jwt', () => {
  test('detects a compact JWT', () => {
    expect(
      detectFormat('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMiJ9.abc')
    ).toBe('jwt');
  });

  test('detects a real-looking JWT with padding-free signature', () => {
    expect(
      detectFormat(
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
        'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      )
    ).toBe('jwt');
  });

  test('rejects JWT with whitespace (multiline)', () => {
    expect(
      detectFormat('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMiJ9.abc\nextra')
    ).not.toBe('jwt');
  });
});

// ─── diff ─────────────────────────────────────────────────────────────────────

describe('detectFormat — diff', () => {
  test('detects git diff with diff --git header', () => {
    expect(
      detectFormat('diff --git a/f b/f\n@@ -1 +1 @@\n-a\n+b')
    ).toBe('diff');
  });

  test('detects unified diff with @@ hunk header only', () => {
    expect(
      detectFormat('@@ -1,4 +1,4 @@\n context\n-old\n+new\n context')
    ).toBe('diff');
  });

  test('plain text with leading + does NOT become diff', () => {
    expect(detectFormat('+1 for this idea\n+also good')).not.toBe('diff');
  });
});

// ─── xml ─────────────────────────────────────────────────────────────────────

describe('detectFormat — xml', () => {
  test('detects simple XML element', () => {
    expect(detectFormat('<root><a/></root>')).toBe('xml');
  });

  test('detects DOCTYPE html', () => {
    expect(detectFormat('<!DOCTYPE html><html></html>')).toBe('xml');
  });

  test('detects xml declaration', () => {
    expect(
      detectFormat('<?xml version="1.0"?><root/>')
    ).toBe('xml');
  });

  test('JSON array starting with [ is NOT xml', () => {
    expect(detectFormat('[1,2,3]')).not.toBe('xml');
  });
});

// ─── toml ─────────────────────────────────────────────────────────────────────

describe('detectFormat — toml', () => {
  test('detects TOML with [section] and key = value', () => {
    expect(detectFormat('[server]\nhost = "x"\nport = 8080')).toBe('toml');
  });

  test('detects INI-style with [section] and key=value', () => {
    expect(detectFormat('[s]\nk=v')).toBe('toml');
  });

  test('env file without [section] is NOT toml', () => {
    expect(detectFormat('API_KEY=abc\nDEBUG=true')).toBe('env');
  });
});

// ─── csv ─────────────────────────────────────────────────────────────────────

describe('detectFormat — csv', () => {
  test('detects comma-separated with header row', () => {
    expect(detectFormat('a,b,c\n1,2,3')).toBe('csv');
  });

  test('detects TSV with tabs', () => {
    expect(detectFormat('name\tage\tcolor\nAlice\t30\tblue')).toBe('csv');
  });

  test('single line does NOT become csv', () => {
    expect(detectFormat('Hello, world')).not.toBe('csv');
  });

  test('JSON array is NOT csv', () => {
    expect(detectFormat('[1,2,3]')).not.toBe('csv');
  });

  test('inconsistent column counts do NOT become csv', () => {
    expect(detectFormat('a,b,c\n1,2\nx,y,z,w')).not.toBe('csv');
  });
});

// ─── yaml ─────────────────────────────────────────────────────────────────────

describe('detectFormat — yaml', () => {
  test('detects key: value pairs', () => {
    expect(detectFormat('name: John\nage: 30')).toBe('yaml');
  });

  test('detects document with --- marker', () => {
    expect(detectFormat('---\nfoo: bar')).toBe('yaml');
  });

  test('single key-value line is NOT yaml (ratio guard)', () => {
    expect(detectFormat('Note: buy milk')).not.toBe('yaml');
  });

  test('normal markdown doc is NOT yaml', () => {
    expect(
      detectFormat('# Heading\n\nSome text here.\n\n- item one\n- item two')
    ).toBe('markdown');
  });
});

// ─── disambiguation ───────────────────────────────────────────────────────────

describe('detectFormat — disambiguation', () => {
  test('API_KEY=abc\\nDEBUG=true → env (not toml, not yaml)', () => {
    expect(detectFormat('API_KEY=abc\nDEBUG=true')).toBe('env');
  });

  test('[1,2,3] → json (not csv)', () => {
    expect(detectFormat('[1,2,3]')).toBe('json');
  });

  test('"Note: buy milk" single line → plain (not yaml)', () => {
    expect(detectFormat('Note: buy milk')).toBe('plain');
  });

  test('"Hello, world" single line → plain (not csv)', () => {
    expect(detectFormat('Hello, world')).toBe('plain');
  });

  test('markdown doc with heading and list → markdown (not yaml)', () => {
    expect(
      detectFormat('# My Doc\n\n- list item\n- another item\n\nSome prose here.')
    ).toBe('markdown');
  });

  test('jwt with eyJ prefix → jwt before json check', () => {
    expect(
      detectFormat('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMiJ9.SIG')
    ).toBe('jwt');
  });
});
