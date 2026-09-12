import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

export const DEFAULT_PORT = 19876;
export const defaultConfigPath = () => join(homedir(), '.antidebug-breaker', 'mcp.json');
const configSchema = z.object({
  port: z.number().int().min(1024).max(65535),
  token: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export function parseArgs(argv) {
  const options = { setup: false, help: false, configPath: defaultConfigPath() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--setup') options.setup = true;
    else if (argv[i] === '--help' || argv[i] === '-h') options.help = true;
    else if (argv[i] === '--config' && argv[i + 1] && !argv[i + 1].startsWith('--')) options.configPath = resolve(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}. Use --help.`);
  }
  return options;
}

export async function readConfig(path = defaultConfigPath()) {
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Pairing config not found: ${path}. Run node src/index.js --setup (or --setup --config <path>) first.`);
    throw new Error(`Cannot read pairing config: ${path} (${error.code ?? 'read error'}).`);
  }
  try { return configSchema.parse(JSON.parse(raw)); }
  catch { throw new Error(`Invalid pairing config: ${path}. Expected a port and a 32+ character base64url token.`); }
}

export async function setupConfig(path = defaultConfigPath()) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const config = { port: DEFAULT_PORT, token: randomBytes(32).toString('base64url') };
  try {
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (process.platform !== 'win32') await chmod(path, 0o600);
    return { config, path, created: true };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return { config: await readConfig(path), path, created: false };
  }
}
