#!/usr/bin/env node
// Build the separately downloadable MCP + Skills bundle. Never upload anything.
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFile, sha256, writeArchive, formatArchiveResult } from './package-utils.mjs';

// New runtime or skill resources require an explicit packaging review.
export const agentFiles = Object.freeze([
  'agent-release.json',
  'docs/agent-install.md',
  'mcp/package.json',
  'mcp/package-lock.json',
  'mcp/README.md',
  'mcp/src/index.js',
  'mcp/src/config.js',
  'mcp/src/bridge.js',
  'mcp/src/browser.js',
  'mcp/src/cookies.js',
  'mcp/src/extension-browser.js',
  'mcp/src/tools.js',
  'skills/antidebug-breaker-skills/SKILL.md',
  'skills/antidebug-breaker-skills/agents/openai.yaml',
  'skills/antidebug-breaker-skills/references/antidebug-breaker-scripts.md',
  'skills/antidebug-breaker-skills/references/crypto-delivery.md',
  'skills/antidebug-breaker-skills/references/mcp-usage.md',
  'skills/antidebug-breaker-skills/references/route-evidence.md',
]);

export function validateRelease(release, manifest, pkg, lock) {
  if (!release || release.schemaVersion !== 1 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(release.repository || '')) {
    throw new Error('Invalid agent-release.json schema or repository.');
  }
  if (!/^\d+(?:\.\d+){0,3}$/.test(release.extensionVersion || '') || release.extensionVersion !== manifest.version) {
    throw new Error('Agent release extensionVersion must match manifest.version.');
  }
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(release.mcpVersion || '') || release.mcpVersion !== pkg.version) {
    throw new Error('Agent release mcpVersion must match mcp/package.json.');
  }
  if (release.tag !== `v${release.extensionVersion}` || release.assetName !== `AntiDebug_Breaker-Agent-${release.extensionVersion}.zip`) {
    throw new Error('Agent release tag and assetName must match extensionVersion.');
  }
  const locked = lock?.packages?.[''];
  if (lock?.lockfileVersion !== 3 || lock.version !== pkg.version || lock.name !== pkg.name || locked?.version !== pkg.version || locked?.name !== pkg.name) {
    throw new Error('MCP package-lock.json must match package.json before distribution.');
  }
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const sorted = value => JSON.stringify(Object.entries(value || {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    if (sorted(pkg[key]) !== sorted(locked[key])) throw new Error(`MCP package-lock.json has stale ${key}. Run npm install before packaging.`);
  }
}

function assertRuntimeImports(contents) {
  for (const [name, data] of contents) {
    if (!name.startsWith('mcp/src/') || !name.endsWith('.js')) continue;
    const code = data.toString('utf8');
    for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
      if (!contents.has(dependency)) throw new Error(`${name} imports a runtime file outside the explicit allowlist: ${match[1]}`);
    }
  }
}

export async function prepareAgentPackage(directory) {
  const root = await realpath(directory);
  const contents = new Map(await Promise.all([...agentFiles].sort().map(async name => [name, await sourceFile(root, name)])));
  const release = JSON.parse(contents.get('agent-release.json'));
  const manifest = JSON.parse(await sourceFile(root, 'manifest.json'));
  const pkg = JSON.parse(contents.get('mcp/package.json'));
  const lock = JSON.parse(contents.get('mcp/package-lock.json'));
  validateRelease(release, manifest, pkg, lock);
  assertRuntimeImports(contents);

  const prefix = release.assetName.slice(0, -4);
  const files = new Map();
  for (const [source, data] of contents) files.set(source === 'docs/agent-install.md' ? '安装说明.md' : source, data);
  files.set('README.md', Buffer.from(`# AntiDebug Breaker MCP + Skills\n\n请先阅读 [安装说明](安装说明.md)，再按 [MCP 说明](mcp/README.md) 配置 Agent。\n\n配套扩展版本：${release.extensionVersion}；MCP 版本：${release.mcpVersion}。本包不包含 Chrome 扩展、Node.js 或已安装的依赖。\n\n[项目源码](https://github.com/${release.repository}) · [对应版本](https://github.com/${release.repository}/releases/tag/${release.tag})\n`, 'utf8'));
  const inventory = Object.fromEntries([...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, data]) => [name, { bytes: data.length, sha256: sha256(data) }]));
  files.set('bundle-manifest.json', Buffer.from(`${JSON.stringify({ ...release, files: inventory }, null, 2)}\n`, 'utf8'));
  return {
    filename: release.assetName,
    release,
    contents: new Map([...files].map(([name, data]) => [`${prefix}/${name}`, data])),
  };
}

export async function packageAgent(directory, { listOnly = false, log = text => process.stdout.write(text) } = {}) {
  const root = await realpath(directory);
  const prepared = await prepareAgentPackage(root);
  if (listOnly) {
    log(`${[...prepared.contents.keys()].sort().join('\n')}\n${prepared.contents.size} approved or generated files; release versions, lockfile and runtime imports verified.\n`);
    return prepared;
  }
  const result = await writeArchive(root, prepared.filename, prepared.contents);
  log(formatArchiveResult(result));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--list', '--help', '-h'].includes(arg))) throw new Error('Usage: node tools/package-agent.mjs [--list | --help]');
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: node tools/package-agent.mjs [--list]\nBuilds the version-pinned MCP + Skills ZIP locally. No uploads or dependency installation.\n--list validates approved inputs and prints the bundle inventory without writing an archive.\n');
  } else {
    await packageAgent(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), { listOnly: args.includes('--list') });
  }
}
