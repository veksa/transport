// Cuts a release: `yarn release 0.0.24`. Sets the version in package.json, commits it, tags it and pushes both;
// the tag's workflow stages it on npm (approved by hand with 2FA) and makes the GitHub release. Runs from a clean,
// up-to-date master after the checks pass. A version already in package.json but never tagged (bumped in an
// earlier commit) is tagged as it is, without a commit.

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, {cwd: root, encoding: 'utf8', shell: process.platform === 'win32', ...opts});
const fail = msg => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) fail('usage: yarn release <major.minor.patch[-pre]>');

if (sh('git', ['branch', '--show-current']).trim() !== 'master') fail('not on master');
if (sh('git', ['status', '--porcelain']).trim()) fail('the working tree has changes');
sh('git', ['fetch', '--quiet', '--tags', 'origin']);
if (sh('git', ['rev-parse', 'HEAD']).trim() !== sh('git', ['rev-parse', 'origin/master']).trim()) fail('master differs from origin/master');
if (sh('git', ['tag', '--list', version]).trim()) fail(`tag ${version} exists`);

const file = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

sh('yarn', ['check-all'], {stdio: 'inherit'});

if (pkg.version !== version) {
  pkg.version = version;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  sh('git', ['commit', '--quiet', '-m', `chore(release): ${version}`, 'package.json'], {stdio: 'inherit'});
}
sh('git', ['tag', '-s', version, '-m', version], {stdio: 'inherit'});
sh('git', ['push', '--quiet', '--atomic', 'origin', 'master', version], {stdio: 'inherit'});
console.log(`release: ${version} tagged and pushed; once the workflow has staged it on npm: npm stage list @veksa/transport, then npm stage approve <id>`);
