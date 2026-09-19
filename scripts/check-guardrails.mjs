#!/usr/bin/env node
/**
 * Repository guardrails. Enforces the coding standards that review tends to
 * miss: no console logging, no emoji, no em dashes and no purple hues anywhere
 * in source, styles or documentation.
 *
 * Run with: npm run guardrails
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// An optional root argument lets the test suite run the checker against a
// temporary fixture directory.
const ROOT =
  process.argv[2] === undefined
    ? join(fileURLToPath(new URL('.', import.meta.url)), '..')
    : resolve(process.argv[2]);

const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.html',
  '.css',
  '.yml',
  '.yaml',
]);

/** Extensions where a console call would be executable code. */
const CODE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs']);

/**
 * A file may opt out, for example a test that has to contain a banned value in
 * order to prove the checker catches it. The marker is greppable and reviewable.
 */
const OPT_OUT_MARKER = 'guardrails: allow-banned-content';

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git', '.next', 'build']);

const SKIPPED_FILES = new Set([
  'package-lock.json',
  // The policy file necessarily contains the literal words and colours it bans.
  'check-guardrails.mjs',
]);

/**
 * Emoji and pictograph ranges, plus variation selectors and dingbats. Written
 * as explicit code point tests rather than a character class so the intent
 * stays readable and no regex lint rule has to be suppressed.
 */
function findEmoji(line) {
  for (const character of line) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    const isEmoji =
      (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
      (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
      (codePoint >= 0x2b00 && codePoint <= 0x2bff) ||
      codePoint === 0xfe0f ||
      (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff);
    if (isEmoji) {
      return character;
    }
  }
  return null;
}

const EM_DASH_PATTERN = /\u2014/g;

const CONSOLE_PATTERN = /\bconsole\s*\./;

const NAMED_PURPLES = [
  'purple',
  'violet',
  'magenta',
  'fuchsia',
  'orchid',
  'lavender',
  'plum',
  'thistle',
  'amethyst',
  'mauve',
  'lilac',
  'periwinkle',
  'indigo',
];

const HEX_PATTERN = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

/** Hue window treated as a purple hue, in degrees. */
const PURPLE_HUE_MIN = 250;
const PURPLE_HUE_MAX = 320;

function hexToHue(hex) {
  const value = hex.slice(1);
  let r;
  let g;
  let b;
  if (value.length === 3 || value.length === 4) {
    r = parseInt(value[0] + value[0], 16);
    g = parseInt(value[1] + value[1], 16);
    b = parseInt(value[2] + value[2], 16);
  } else {
    r = parseInt(value.slice(0, 2), 16);
    g = parseInt(value.slice(2, 4), 16);
    b = parseInt(value.slice(4, 6), 16);
  }
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta === 0) {
    return { hue: 0, saturation: 0, lightness: max };
  }
  let hue;
  if (max === rn) {
    hue = ((gn - bn) / delta) % 6;
  } else if (max === gn) {
    hue = (bn - rn) / delta + 2;
  } else {
    hue = (rn - gn) / delta + 4;
  }
  hue *= 60;
  if (hue < 0) {
    hue += 360;
  }
  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  return { hue, saturation, lightness };
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (SKIPPED_FILES.has(entry.name)) {
      continue;
    }
    if (!SCANNED_EXTENSIONS.has(extname(entry.name))) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function checkFile(relativePath, contents) {
  const violations = [];
  const lines = contents.split('\n');

  if (lines.slice(0, 3).some((line) => line.includes(OPT_OUT_MARKER))) {
    return violations;
  }

  const isCode = CODE_EXTENSIONS.has(extname(relativePath));
  // Colour rules apply to code and stylesheets. Documentation may legitimately
  // describe the rule itself, for example "no purple hues in the frontend".
  const isStyled = isCode || ['.css', '.html'].includes(extname(relativePath));

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    const isComment =
      trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');

    if (isCode && !isComment && CONSOLE_PATTERN.test(line)) {
      violations.push(
        `${relativePath}:${lineNumber} console logging is prohibited, use the Logger`,
      );
    }

    const emoji = findEmoji(line);
    if (emoji !== null) {
      violations.push(`${relativePath}:${lineNumber} emoji "${emoji}" is not allowed`);
    }

    if (EM_DASH_PATTERN.test(line)) {
      violations.push(`${relativePath}:${lineNumber} em dash is not allowed`);
    }

    if (isStyled) {
      const lower = line.toLowerCase();
      for (const name of NAMED_PURPLES) {
        if (lower.includes(name)) {
          violations.push(
            `${relativePath}:${lineNumber} purple hue colour name "${name}" is not allowed`,
          );
        }
      }

      for (const match of line.matchAll(HEX_PATTERN)) {
        const { hue, saturation, lightness } = hexToHue(match[0]);
        const isPurple =
          hue >= PURPLE_HUE_MIN &&
          hue <= PURPLE_HUE_MAX &&
          saturation > 0.2 &&
          lightness > 0.05 &&
          lightness < 0.95;
        if (isPurple) {
          violations.push(
            `${relativePath}:${lineNumber} colour ${match[0]} falls in the purple hue range`,
          );
        }
      }
    }
  });

  return violations;
}

async function main() {
  const files = await collectFiles(ROOT);
  const violations = [];

  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    violations.push(...checkFile(relative(ROOT, file), contents));
  }

  if (violations.length > 0) {
    process.stdout.write(
      `Guardrail check failed with ${violations.length} violation(s):\n${violations
        .map((violation) => `  ${violation}`)
        .join('\n')}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`Guardrail check passed across ${files.length} files.\n`);
}

await main();
