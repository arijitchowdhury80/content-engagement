import fs from 'node:fs';
import path from 'node:path';

import { ensureSafeRawRoot } from '../config/artifact-paths.mjs';

export class AppendOnlyJsonlSpool {
  #fd;
  #sequence = 0;
  #closed = false;

  constructor(rawRoot, relativePath) {
    const root = ensureSafeRawRoot(rawRoot);
    if (path.isAbsolute(relativePath)) throw new Error('Spool path must be relative');
    this.path = path.resolve(root, relativePath);
    if (!this.path.startsWith(`${root}${path.sep}`)) throw new Error('Spool path escapes raw root');
    fs.mkdirSync(path.dirname(this.path), { recursive: true, mode: 0o700 });
    this.#fd = fs.openSync(this.path, 'ax', 0o600);
    fs.chmodSync(this.path, 0o600);
  }

  append(event) {
    if (this.#closed) throw new Error('Spool is closed');
    const record = { sequence: ++this.#sequence, ...event };
    const line = `${JSON.stringify(record)}\n`;
    fs.writeSync(this.#fd, line, null, 'utf8');
    fs.fsyncSync(this.#fd);
    return record;
  }

  close() {
    if (this.#closed) return;
    fs.fsyncSync(this.#fd);
    fs.closeSync(this.#fd);
    this.#closed = true;
  }

  get sequence() { return this.#sequence; }
}

export function readSpool(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
