# @onokashino/share-me-cli

[![npm](https://img.shields.io/npm/v/@onokashino/share-me-cli)](https://www.npmjs.com/package/@onokashino/share-me-cli)
[![license](https://img.shields.io/npm/l/@onokashino/share-me-cli)](https://github.com/onokashino/share-me/blob/master/LICENSE)

End-to-end-encrypted file and text sharing from the command line.

`share-me` (short alias `shm`) is the console client for [share·me](https://github.com/onokashino/share-me). It performs the **same end-to-end encryption as the web app**, so the server only ever stores ciphertext: files, folders, and text are encrypted on your machine before upload, and the decryption key lives only in the share link fragment (`#k=...`), which never reaches the server.

## Install

```bash
npm install -g @onokashino/share-me-cli   # installs `share-me` + `shm`
# or run once, without installing:
npx @onokashino/share-me-cli up ./report.pdf
```

Requires Node.js 20 or newer. The package ships as a single self-contained bundle with no runtime dependencies.

## Quick start

Point it at an instance (your own or the public demo). The first server you add becomes the default:

```bash
shm servers add demo https://share-me.onokami.space
```

Send and receive:

```bash
shm up ./report.pdf            # encrypt + upload a file, prints a share link
shm up ./folder                # a folder is zipped into an archive first
shm up --text "secret note"    # share text
shm down "<share link>"        # text is shown; a file prompts for a save name
```

Run `shm` with no arguments for an interactive menu (send / receive / servers / presets / language).

## Settings and presets

Choose options interactively, pick a preset, or pass flags directly (flags override the preset):

| Flag | Meaning |
|---|---|
| `-e, --expires <dur>` | lifetime: `1h`, `7d`, `2w` |
| `-m, --max-downloads <n>` | download limit (`0` = unlimited) |
| `--burn` | burn after reading (1 download) |
| `--unlock <dur>` | time-lock: not downloadable until `now + dur` |
| `-p, --password` | password-protect (prompted, or `SHARE_ME_PASSWORD`) |
| `-P, --preset <name>` | use a saved or built-in preset |
| `--zip` | archive a folder without asking |
| `-y, --yes` | skip interactive prompts (scripting) |

Built-in presets cover the common cases (single download, long storage, burn-after-read, and more); add your own with `shm presets add`.

## Language

The interface is available in English, Russian, and Traditional Chinese:

```bash
shm lang ru                    # set and remember the language
shm --lang zh up ./file        # one-off override
```

It also follows `LC_ALL` / `LANG` when no language is configured.

## Security

Payloads are encrypted with AES-256-GCM in a segmented STREAM construction, with per-message sub-keys derived via HKDF and a key-committing header. Optional password protection derives the key with Argon2id. The server is zero-knowledge: it stores only ciphertext and never receives the key, which travels only in the link fragment. Full protocol details are in the [main repository](https://github.com/onokashino/share-me).

## License

[AGPL-3.0-only](https://github.com/onokashino/share-me/blob/master/LICENSE)
