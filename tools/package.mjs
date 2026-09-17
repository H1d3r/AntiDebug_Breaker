#!/usr/bin/env node
// Build the store extension ZIP and its version-matched MCP + Skills download.
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFile, writeArchive, formatArchiveResult } from './package-utils.mjs';
import { prepareAgentPackage } from './package-agent.mjs';

const fixedFiles = [
  'manifest.json', 'agent-release.json', 'background.js', 'content.js', 'scripts.json',
  'extension/policy.js', 'extension/service.js', 'extension/bridge.js', 'extension/debugger.js', 'extension/user-scripts.js',
  'popup/popup.html', 'popup/popup.js', 'popup/popup.css', 'popup/library-editor.js', 'popup/library-cards.js',
  'popup/mcp.js', 'popup/mcp.css', 'popup/mcp-prompts.js', 'popup/mcp-download.js',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
  'scripts/adb_runtime.js', 'scripts/hook_log v0.1.js', 'scripts/hook_log v0.2.js',
];

export async function prepareExtensionPackage(directory) {
  const root = await realpath(directory);
  const readSource = relative => sourceFile(root, relative);
  const manifest = JSON.parse(await readSource('manifest.json'));
  const catalog = JSON.parse(await readSource('scripts.json'));
  if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) throw new Error('Invalid manifest version for package filename.');
  if (!Array.isArray(catalog)) throw new Error('scripts.json must contain an array.');
  const scriptFiles = catalog.map(script => {
    if (typeof script.id !== 'string' || !/^[A-Za-z0-9_]{1,100}$/.test(script.id)) throw new Error('Catalog contains an invalid script ID.');
    return `scripts/${script.id}.js`;
  });
  const names = [...new Set([...fixedFiles, ...scriptFiles])].sort();
  const allowed = new Set(names);
  const forbidden = /(^|\/)(?:mcp|node_modules|\.npm-cache|\.browser-cache|\.test-artifacts|\.test-profile|\.git|\.codex|\.agents|dist)(\/|$)|(^|\/)(?:\.env(?:\..*)?|mcp\.json|.*(?:token|secret|credential).*\.json)$/i;
  for (const name of names) if (forbidden.test(name)) throw new Error(`Forbidden package entry: ${name}`);

  function assertIncluded(reference, owner) {
    if (typeof reference !== 'string') return;
    const normalized = reference.replace(/^\.\//, '');
    if (!allowed.has(normalized)) throw new Error(`${owner} references an asset outside the explicit allowlist: ${reference}`);
  }
  function addIcons(value, owner) {
    if (typeof value === 'string') assertIncluded(value, owner);
    else for (const file of Object.values(value || {})) assertIncluded(file, owner);
  }
  assertIncluded(manifest.background?.service_worker, 'manifest.background');
  for (const file of manifest.background?.scripts || []) assertIncluded(file, 'manifest.background');
  assertIncluded(manifest.action?.default_popup, 'manifest.action');
  addIcons(manifest.action?.default_icon, 'manifest.action');
  addIcons(manifest.icons, 'manifest.icons');
  assertIncluded(manifest.options_ui?.page, 'manifest.options_ui');
  assertIncluded(manifest.options_page, 'manifest.options_page');
  assertIncluded(manifest.devtools_page, 'manifest.devtools_page');
  assertIncluded(manifest.side_panel?.default_path, 'manifest.side_panel');
  for (const file of Object.values(manifest.chrome_url_overrides || {})) assertIncluded(file, 'manifest.chrome_url_overrides');
  for (const entry of manifest.content_scripts || []) {
    for (const file of [...(entry.js || []), ...(entry.css || [])]) assertIncluded(file, 'manifest.content_scripts');
  }
  for (const entry of manifest.declarative_net_request?.rule_resources || []) assertIncluded(entry.path, 'manifest.declarative_net_request');

  // Expand currently supported manifest wildcards only to verify completeness. Never
  // turn wildcard discoveries into implicitly approved package entries.
  for (const entry of manifest.web_accessible_resources || []) {
    for (const resource of entry.resources || []) {
      if (!resource.includes('*')) { assertIncluded(resource, 'manifest.web_accessible_resources'); continue; }
      if (resource !== 'scripts/*.js') throw new Error(`Review the package allowlist for new manifest wildcard: ${resource}`);
      for (const file of await readdir(path.join(root, 'scripts'), { withFileTypes: true })) {
        if (file.name.endsWith('.js')) assertIncluded(`scripts/${file.name}`, 'manifest.web_accessible_resources');
      }
    }
  }

  const contents = new Map(await Promise.all(names.map(async name => [name, await readSource(name)])));
  for (const [name, data] of contents) {
    if (!name.endsWith('.html')) continue;
    const text = data.toString('utf8');
    for (const match of text.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      if (/^(?:[a-z]+:|#|\/\/)/i.test(match[1])) continue;
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1].split(/[?#]/)[0]));
      assertIncluded(relative, name);
    }
  }
  return { filename: `AntiDebug_Breaker-${manifest.version}.zip`, contents };
}

export async function packageAll(directory, { listOnly = false, log = text => process.stdout.write(text) } = {}) {
  const root = await realpath(directory);
  // Validate both before writing either artifact. A release mismatch is a build error.
  const extension = await prepareExtensionPackage(root);
  const agent = await prepareAgentPackage(root);
  if (listOnly) {
    for (const prepared of [extension, agent]) {
      log(`${prepared.filename}\n${[...prepared.contents.keys()].sort().join('\n')}\n${prepared.contents.size} approved or generated files.\n`);
    }
    return [extension, agent];
  }
  const results = [];
  for (const prepared of [extension, agent]) {
    const result = await writeArchive(root, prepared.filename, prepared.contents);
    log(formatArchiveResult(result));
    results.push(result);
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--list', '--help', '-h'].includes(arg))) throw new Error('Usage: node tools/package.mjs [--list | --help]');
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: node tools/package.mjs [--list]\nBuilds both the extension ZIP and its matching MCP + Skills ZIP in dist using explicit allowlists. No uploads.\n--list validates release versions and asset references, then prints both inventories without writing archives.\n');
  } else {
    await packageAll(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), { listOnly: args.includes('--list') });
  }
}
