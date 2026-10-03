const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const suites = fs.readdirSync(__dirname).filter(name => name.endsWith('.cjs') && name !== 'run.cjs').sort();
let failed = 0;
const syntax = spawnSync(process.execPath, ['--check', path.join(__dirname, '..', 'index.js')], { stdio: 'inherit' });
if (syntax.status !== 0) failed++;
for (const name of suites) {
    console.log(`\n${name}`);
    const result = spawnSync(process.execPath, [path.join(__dirname, name)], { stdio: 'inherit', timeout: 30000 });
    if (result.status !== 0 || result.error) { failed++; if (result.error) console.error(result.error.message); }
}
console.log(`\n${suites.length} suites; ${failed} failures (including syntax check)`);
if (failed) process.exitCode = 1;
