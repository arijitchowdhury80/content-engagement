import fs from 'node:fs';
import path from 'node:path';

import { ensureSafeRawRoot } from '../config/artifact-paths.mjs';

export function writeFailurePacket(rawRoot, packet) {
  const root = ensureSafeRawRoot(rawRoot);
  if (packet?.schema !== 'FailurePacket.v1') throw new Error('Failure packet schema must be FailurePacket.v1');
  if (!packet.failureId || !/^[a-z0-9-]+$/.test(packet.failureId)) throw new Error('Failure packet ID is invalid');
  const directory = path.join(root, 'failures');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, `${packet.failureId}.json`);
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(packet, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const descriptor = fs.openSync(temporary, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  try {
    fs.linkSync(temporary, destination);
  } finally {
    fs.unlinkSync(temporary);
  }
  fs.chmodSync(destination, 0o600);
  return destination;
}
