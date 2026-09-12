// Shared deterministic ZIP writer. Inputs must come from a reviewed allowlist.
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export function validatePackagePath(relative) {
  if (typeof relative !== 'string' || !relative || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)
    || /[\\:\x00-\x1f]/.test(relative) || relative.split('/').some(part => !part || part === '..' || part === '.' || /[. ]$/.test(part))) {
    throw new Error(`Invalid package path: ${relative}`);
  }
  return relative;
}

function assertInside(root, absolute, message) {
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(message);
}

export async function sourceFile(root, relative) {
  validatePackagePath(relative);
  const absolute = path.resolve(root, relative);
  assertInside(root, absolute, `Package path escapes the project: ${relative}`);
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Package assets must be ordinary files: ${relative}`);
  assertInside(root, await realpath(absolute), `Package asset resolves outside the project: ${relative}`);
  return readFile(absolute);
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZip(contents) {
  const entries = [...contents].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (entries.length > 0xffff) throw new Error('ZIP64 is not supported.');
  const uniqueNames = new Set();
  const localEntries = [];
  const centralEntries = [];
  let offset = 0;
  for (const [name, data] of entries) {
    validatePackagePath(name);
    const identity = name.normalize('NFC').toLowerCase();
    if (uniqueNames.has(identity)) throw new Error(`Duplicate package path: ${name}`);
    uniqueNames.add(identity);
    if (!Buffer.isBuffer(data)) throw new Error(`Package entry must be a Buffer: ${name}`);
    const filename = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data, { level: 9 });
    if (filename.length > 0xffff || data.length > 0xffffffff || compressed.length > 0xffffffff) throw new Error('ZIP64 is not supported.');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x0021, 12); // 1980-01-01, independent of local time.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    localEntries.push(header, filename, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centralEntries.push(central, filename);
    offset += header.length + filename.length + compressed.length;
    if (offset > 0xffffffff) throw new Error('ZIP64 is not supported.');
  }
  const directory = Buffer.concat(centralEntries);
  if (directory.length > 0xffffffff) throw new Error('ZIP64 is not supported.');
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(directory.length, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...localEntries, directory, footer]);
}

export async function writeArchive(root, filename, contents) {
  validatePackagePath(filename);
  if (filename.includes('/') || !filename.endsWith('.zip')) throw new Error('Archive filename must be a ZIP basename.');
  const archive = buildZip(contents);
  const destination = path.join(root, 'dist', filename);
  await mkdir(path.dirname(destination), { recursive: true });
  assertInside(root, await realpath(path.dirname(destination)), 'dist resolves outside the project.');
  try {
    const existing = await lstat(destination);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Package destination must be an ordinary file.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(destination, archive);
  return { destination, files: contents.size, bytes: archive.length, sha256: sha256(archive) };
}

export function formatArchiveResult(result) {
  return `Created ${result.destination}\n${result.files} files; ${result.bytes} bytes\nSHA-256 ${result.sha256}\n`;
}
