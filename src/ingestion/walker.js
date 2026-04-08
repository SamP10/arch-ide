import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import ignore from 'ignore';
import { insertFile } from './db.js';

const LANGUAGE_MAP = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.py': 'python',
  '.go': 'go',
  '.java': 'java',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.cs': 'c_sharp',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.r': 'r',
  '.lua': 'lua',
  '.sh': 'bash',
  '.bash': 'bash',
};

const HARD_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', '__pycache__', '.pytest_cache', 'venv', '.venv', 'env',
  'vendor', 'target', '.gradle', '.idea', '.vscode',
]);

const HARD_EXCLUDE_PATTERNS = [
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.lock',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
];

function isBinary(filePath) {
  try {
    const buffer = Buffer.alloc(512);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function buildIgnoreFilter(targetPath) {
  const ig = ignore();

  // Apply hard excludes
  for (const pattern of HARD_EXCLUDE_PATTERNS) {
    ig.add(pattern);
  }

  // Walk up looking for .gitignore files in target
  const gitignorePath = path.join(targetPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, 'utf8'));
  }

  return ig;
}

export async function walkFiles(db, targetPath) {
  const ig = buildIgnoreFilter(targetPath);

  const allFiles = await glob('**/*', {
    cwd: targetPath,
    nodir: true,
    dot: false,
    absolute: false,
  });

  const fileRecords = [];

  for (const relPath of allFiles) {
    const parts = relPath.split(path.sep);

    // Skip hard-excluded dirs
    if (parts.some(p => HARD_EXCLUDE_DIRS.has(p))) continue;

    // Skip ignored files
    if (ig.ignores(relPath)) continue;

    const ext = path.extname(relPath).toLowerCase();
    const language = LANGUAGE_MAP[ext] || null;

    // Skip files with no recognised language
    if (!language) continue;

    const absPath = path.join(targetPath, relPath);

    // Skip binary files
    if (isBinary(absPath)) continue;

    let size_bytes = 0;
    try {
      size_bytes = fs.statSync(absPath).size;
    } catch {
      continue;
    }

    const record = {
      path: relPath,
      language,
      size_bytes,
      git_hash: null,
      parse_status: 'pending',
    };

    const id = insertFile(db, record);
    fileRecords.push({ id, ...record });
  }

  return fileRecords;
}
