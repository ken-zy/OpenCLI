import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isCliModule } from './discovery.js';

describe('discovery isCliModule', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeTemp(name: string, body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-discovery-'));
    tempDirs.push(dir);
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    return file;
  }

  it('recognizes inline cli({...}) calls', async () => {
    const file = writeTemp('inline.js', `import { cli } from 'opencli'; export const c = cli({ site: 's', name: 'n' });`);
    await expect(isCliModule(file)).resolves.toBe(true);
  });

  it('recognizes factory-style adapters (makeNewCommand, makeStatusCommand, ...)', async () => {
    const file = writeTemp('factory.js', `import { makeNewCommand } from '../_shared/desktop-commands.js';\nexport const c = makeNewCommand('demo', 'Demo');`);
    await expect(isCliModule(file)).resolves.toBe(true);
  });

  it('recognizes lifecycle hook registrations (onStartup, onBeforeExecute, onAfterExecute)', async () => {
    const file = writeTemp('hooks.js', `import { onStartup } from 'opencli'; onStartup(() => {});`);
    await expect(isCliModule(file)).resolves.toBe(true);
  });

  it('skips files with no command registration', async () => {
    const file = writeTemp('utils.js', `export function helper() { return 42; }`);
    await expect(isCliModule(file)).resolves.toBe(false);
  });

  it('does not match unrelated identifiers that happen to start with make', async () => {
    const file = writeTemp('decoy.js', `export function makeRequest() {} export function makeFoo() {}`);
    await expect(isCliModule(file)).resolves.toBe(false);
  });

  it('returns false when the file cannot be read', async () => {
    await expect(isCliModule('/nonexistent/path/to/nowhere.js')).resolves.toBe(false);
  });
});
