import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const scratch = mkdtempSync(join(tmpdir(), 'cookiemail-package-'));
try {
  execFileSync(npm, ['pack', '--ignore-scripts', '--pack-destination', scratch], {
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync(
    npm,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(
        scratch,
        'cookiemail-' + JSON.parse(readFileSync('package.json', 'utf8')).version + '.tgz',
      ),
      'react@19',
    ],
    { cwd: scratch, stdio: 'pipe', shell: process.platform === 'win32' },
  );
  writeFileSync(
    join(scratch, 'smoke.mjs'),
    `import {createCookieMail} from 'cookiemail';import {sqliteStore} from 'cookiemail/sqlite';import {CookieMail,SubscribeForm} from 'cookiemail/react';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);if(typeof require('cookiemail').createCookieMail!=='function'||typeof CookieMail!=='function'||typeof SubscribeForm!=='function')throw Error('Bad exports');const store=sqliteStore(':memory:');await store.close();console.log('ESM, CJS, React and SQLite package exports pass');`,
  );
  execFileSync(process.execPath, [join(scratch, 'smoke.mjs')], { stdio: 'inherit' });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
