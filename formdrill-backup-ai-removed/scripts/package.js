'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 Table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(d) {
  const date = d || new Date();
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const dt = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, date: dt };
}

function createZip(files, outPath) {
  const localChunks = [];
  const cdChunks = [];
  let offset = 0;

  for (const file of files) {
    const rawData = fs.readFileSync(file.absPath);
    const stat = fs.statSync(file.absPath);
    const { time, date } = toDosDateTime(stat.mtime);
    const fileCrc = crc32(rawData);

    const compressed = zlib.deflateRawSync(rawData);
    const useDeflate = compressed.length < rawData.length;
    const data = useDeflate ? compressed : rawData;
    const method = useDeflate ? 8 : 0;

    const nameBuf = Buffer.from(file.relPath.replace(/\\/g, '/'), 'utf8');

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed: 2.0
    localHeader.writeUInt16LE(0, 6);          // General flags
    localHeader.writeUInt16LE(method, 8);     // Compression method
    localHeader.writeUInt16LE(time, 10);      // Mod time
    localHeader.writeUInt16LE(date, 12);      // Mod date
    localHeader.writeUInt32LE(fileCrc, 14);   // CRC-32
    localHeader.writeUInt32LE(data.length, 18);    // Compressed size
    localHeader.writeUInt32LE(rawData.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // Name length
    localHeader.writeUInt16LE(0, 28);              // Extra field length
    nameBuf.copy(localHeader, 30);

    localChunks.push(localHeader, data);

    // Central directory header
    const cdHeader = Buffer.alloc(46 + nameBuf.length);
    cdHeader.writeUInt32LE(0x02014b50, 0); // CD signature
    cdHeader.writeUInt16LE(20, 4);         // Version made by
    cdHeader.writeUInt16LE(20, 6);         // Version needed
    cdHeader.writeUInt16LE(0, 8);          // General flags
    cdHeader.writeUInt16LE(method, 10);    // Compression method
    cdHeader.writeUInt16LE(time, 12);      // Mod time
    cdHeader.writeUInt16LE(date, 14);      // Mod date
    cdHeader.writeUInt32LE(fileCrc, 16);   // CRC-32
    cdHeader.writeUInt32LE(data.length, 20);    // Compressed size
    cdHeader.writeUInt32LE(rawData.length, 24); // Uncompressed size
    cdHeader.writeUInt16LE(nameBuf.length, 28); // Name length
    cdHeader.writeUInt16LE(0, 30);              // Extra field length
    cdHeader.writeUInt16LE(0, 32);              // Comment length
    cdHeader.writeUInt16LE(0, 34);              // Disk start
    cdHeader.writeUInt16LE(0, 36);              // Internal attributes
    cdHeader.writeUInt32LE(0, 38);              // External attributes
    cdHeader.writeUInt32LE(offset, 42);         // Local header offset
    nameBuf.copy(cdHeader, 46);

    cdChunks.push(cdHeader);
    offset += localHeader.length + data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of cdChunks) cdSize += c.length;

  // End of Central Directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4);          // Disk number
  eocd.writeUInt16LE(0, 6);          // Disk with CD
  eocd.writeUInt16LE(files.length, 8);  // Number of entries
  eocd.writeUInt16LE(files.length, 10); // Total entries
  eocd.writeUInt32LE(cdSize, 12);       // Size of CD
  eocd.writeUInt32LE(cdOffset, 16);     // Offset of CD
  eocd.writeUInt16LE(0, 20);            // Comment length

  const fullZip = Buffer.concat([...localChunks, ...cdChunks, eocd]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, fullZip);
  return fullZip.length;
}

function collectFiles(dir, baseDir, excludePatterns = []) {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (excludePatterns.some((pattern) => {
      if (typeof pattern === 'string') return relPath === pattern || relPath.startsWith(pattern + '/') || entry.name === pattern;
      return pattern.test(relPath) || pattern.test(entry.name);
    })) {
      continue;
    }

    if (entry.isDirectory()) {
      result.push(...collectFiles(fullPath, baseDir, excludePatterns));
    } else if (entry.isFile()) {
      result.push({ absPath: fullPath, relPath });
    }
  }
  return result;
}

const rootDir = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'extension', 'manifest.json'), 'utf8'));
const version = manifest.version;
const distDir = path.join(rootDir, 'dist');
fs.mkdirSync(distDir, { recursive: true });

// 1. Extension package (for Chrome Web Store or unpacked distribution)
const extFiles = collectFiles(path.join(rootDir, 'extension'), path.join(rootDir, 'extension'));
const extZipPath = path.join(distDir, `formdrill-${version}.zip`);
const extCleanZipPath = path.join(distDir, `formdrill-extension-${version}.zip`);
const extSize = createZip(extFiles, extZipPath);
fs.copyFileSync(extZipPath, extCleanZipPath);
console.log(`Created Chrome extension package: ${extZipPath} (${extSize} bytes, ${extFiles.length} files)`);
console.log(`Created Chrome extension package alias: ${extCleanZipPath}`);

// 2. Full project package (complete source code, tests, server, docs, no temp/build artifacts)
const projectExcludes = [
  'node_modules',
  '.git',
  'dist',
  '.DS_Store',
  'Thumbs.db',
  /^formdrill-e2e-/,
  /^\.system_generated/,
  'test.zip'
];
const projectFiles = collectFiles(rootDir, rootDir, projectExcludes);
const projectZipPath = path.join(distDir, `formdrill-project-${version}.zip`);
const projectSize = createZip(projectFiles, projectZipPath);
console.log(`Created complete source project package: ${projectZipPath} (${projectSize} bytes, ${projectFiles.length} files)`);
