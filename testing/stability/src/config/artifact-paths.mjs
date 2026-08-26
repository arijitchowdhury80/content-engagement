import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { REPOSITORY_ROOT } from './constants.mjs';

const SYNC_SEGMENTS = new Set(['dropbox', 'onedrive', 'icloud drive', 'google drive', 'box']);

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function existingAncestor(candidate) {
  let current = candidate;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

function canonicalCandidate(candidate) {
  const ancestor = existingAncestor(candidate);
  const realAncestor = fs.realpathSync.native(ancestor);
  return path.resolve(realAncestor, path.relative(ancestor, candidate));
}

function synchronizedRoot(candidate) {
  const parsed = path.parse(candidate);
  const parts = candidate.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = path.join(current, part);
    if (SYNC_SEGMENTS.has(part.toLowerCase())) return current;
    if (/^mobile documents$/i.test(part)) return current;
  }
  return null;
}

export function assertSafeRawRoot(input, { repositoryRoot = REPOSITORY_ROOT } = {}) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) {
    throw new Error('Raw evidence root must be an absolute path');
  }
  const requested = path.resolve(input);
  if (fs.existsSync(requested) && fs.lstatSync(requested).isSymbolicLink()) {
    throw new Error('Raw evidence root cannot be a symbolic link');
  }
  const candidate = canonicalCandidate(requested);
  const repository = fs.realpathSync.native(path.resolve(repositoryRoot));
  if (candidate === path.parse(candidate).root) throw new Error('Filesystem root cannot be a raw evidence directory');
  if (isWithin(repository, candidate)) throw new Error('Raw evidence cannot be stored inside the repository');
  const syncRoot = synchronizedRoot(candidate);
  if (syncRoot) throw new Error(`Raw evidence cannot be stored in a synchronized root: ${syncRoot}`);
  return candidate;
}

export function ensureSafeRawRoot(input, options = {}) {
  const candidate = assertSafeRawRoot(input, options);
  fs.mkdirSync(candidate, { recursive: true, mode: 0o700 });
  fs.chmodSync(candidate, 0o700);
  const stat = fs.statSync(candidate);
  if ((stat.mode & 0o077) !== 0) throw new Error('Raw evidence root permissions must be 0700');
  return candidate;
}

export function writePrivateFile(root, relativePath, content) {
  const safeRoot = ensureSafeRawRoot(root);
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) throw new Error('Private file path must be relative');
  const destination = path.resolve(safeRoot, relativePath);
  if (!isWithin(safeRoot, destination)) throw new Error('Private file path escapes the raw evidence root');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destination, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.chmodSync(destination, 0o600);
  return destination;
}

export const DEFAULT_RAW_RETENTION_DAYS = 7;

export function retentionDeadline(closedAt, days = DEFAULT_RAW_RETENTION_DAYS) {
  const date = new Date(closedAt);
  if (!Number.isFinite(date.getTime())) throw new Error('Run closure timestamp is invalid');
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Raw retention must be between 1 and 30 days');
  return new Date(date.getTime() + days * 86_400_000).toISOString();
}

export function recommendedRawRoot(runId) {
  return path.join(os.tmpdir(), 'algolia-stability-raw', runId);
}
