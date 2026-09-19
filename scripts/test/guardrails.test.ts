/* guardrails: allow-banned-content */
// This suite must contain banned values (a console call, a purple colour, an
// emoji and an em dash) in order to prove the checker detects them. The marker
// above opts this file out of the repository wide scan.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const SCRIPT = join(process.cwd(), 'scripts', 'check-guardrails.mjs');

// Built from code points so this file never has to contain the characters the
// guardrails ban.
const EM_DASH = String.fromCharCode(0x2014);
const NEWLINE = String.fromCharCode(0x0a);
const CHECK_MARK = String.fromCodePoint(0x2705);

/**
 * The guardrails exist to enforce standards automatically, so the checker
 * itself has to be proven to catch what it claims to catch.
 */
describe('guardrail checker', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fueltrack-guardrails-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function run(): Promise<{ code: number; stdout: string }> {
    try {
      const { stdout } = await execFileAsync(process.execPath, [SCRIPT, root]);
      return { code: 0, stdout };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string };
      return { code: failure.code ?? 1, stdout: failure.stdout ?? '' };
    }
  }

  async function write(relativePath: string, contents: string): Promise<void> {
    const target = join(root, relativePath);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }

  it('passes a clean file', async () => {
    await write('src/clean.ts', `export const value = 1;${NEWLINE}`);
    const result = await run();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Guardrail check passed');
  });

  it('rejects console logging', async () => {
    await write(
      'src/bad.ts',
      ['function go(): void {', "  console.log('hello');", '}', ''].join(NEWLINE),
    );
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('console logging is prohibited');
  });

  it('allows the word console inside a comment', async () => {
    await write(
      'src/doc.ts',
      `// console.log is banned by policy${NEWLINE}export const ok = true;${NEWLINE}`,
    );
    const result = await run();
    expect(result.code).toBe(0);
  });

  it('rejects emoji', async () => {
    await write('src/emoji.ts', `export const note = 'done ${CHECK_MARK}';${NEWLINE}`);
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('emoji');
  });

  it('rejects em dashes', async () => {
    await write('docs/note.md', `This is a sentence ${EM_DASH} with an em dash.${NEWLINE}`);
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('em dash is not allowed');
  });

  it('rejects a purple hex colour and a purple colour name', async () => {
    await write(
      'src/theme.css',
      ['.a { color: #800080; }', '.b { color: violet; }', ''].join(NEWLINE),
    );
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('purple hue range');
    expect(result.stdout).toContain('purple hue colour name');
  });

  it('accepts colours outside the purple hue range', async () => {
    await write(
      'src/theme.css',
      ['.a { color: #2f7fd1; }', '.b { color: #2f9e5f; }', '.c { color: #c2413a; }', ''].join(
        NEWLINE,
      ),
    );
    const result = await run();
    expect(result.code).toBe(0);
  });

  it('ignores build output and dependencies', async () => {
    await write('node_modules/pkg/index.js', `console.log('third party');${NEWLINE}`);
    await write('dist/bundle.js', `console.log('generated');${NEWLINE}`);
    const result = await run();
    expect(result.code).toBe(0);
  });
});
