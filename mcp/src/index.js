#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs, readConfig, setupConfig } from './config.js';
import { ExtensionBridge } from './bridge.js';
import { createMcpServer } from './tools.js';

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write('AntiDebug Breaker MCP\n\nUsage: node src/index.js [--config <path>]\n       node src/index.js --setup [--config <path>]\n\n--setup creates or displays pairing information. Normal mode uses stdout only for MCP stdio.\n');
    return;
  }
  if (options.setup) {
    const result = await setupConfig(options.configPath);
    process.stdout.write(`${result.created ? 'Created' : 'Using existing'} pairing config: ${result.path}\nExtension WebSocket URL: ws://127.0.0.1:${result.config.port}/extension\nPairing token: ${result.config.token}\nEnter these values in the extension pairing settings, then run this command without --setup.\n`);
    return;
  }
  const config = await readConfig(options.configPath);
  const bridge = new ExtensionBridge(config);
  const { BrowserController } = await import('./browser.js');
  const browser = new BrowserController({ bridge });
  const server = createMcpServer({ bridge, browser });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.allSettled([browser.disconnect(), server.close(), bridge.stop()]);
  };
  bridge.on('bridgeError', error => process.stderr.write(`[AntiDebug MCP] ${error.code}: ${error.message}\n`));
  await bridge.start();
  const transport = new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 2 * 1024 * 1024 });
  server.server.onclose = () => { void stop(); };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  process.stdin.once('end', () => { void stop(); });
  try {
    await server.connect(transport);
    process.stderr.write(`[AntiDebug MCP] Listening on 127.0.0.1:${config.port}; waiting for the paired extension.\n`);
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`[AntiDebug MCP] ${error.code ? `${error.code}: ` : ''}${error.message}\n`); process.exitCode = 1; });
}
