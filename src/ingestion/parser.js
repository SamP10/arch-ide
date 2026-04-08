import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getAllFiles, updateFileParseStatus,
  insertSymbol, insertImport, insertCall,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUERIES_DIR = path.join(__dirname, '..', 'queries');

// Languages we have query files for
const SUPPORTED_LANGUAGES = new Set(['javascript', 'typescript', 'python']);

// Map language → query file
const QUERY_FILE = {
  javascript: 'javascript.scm',
  typescript: 'javascript.scm', // TS uses the same query file
  python: 'python.scm',
};

let Parser;

async function loadTreeSitter() {
  if (Parser) return;
  const treeSitter = await import('tree-sitter');
  Parser = treeSitter.default; // Also has Parser.Query, Parser.Tree, etc.
}

const GRAMMAR_MODULES = {
  javascript: 'tree-sitter-javascript',
  typescript: 'tree-sitter-typescript/typescript',
  python: 'tree-sitter-python',
};

const grammarCache = {};

async function getGrammar(language) {
  if (!grammarCache[language]) {
    const mod = await import(GRAMMAR_MODULES[language]);
    grammarCache[language] = mod.default ?? mod;
  }
  return grammarCache[language];
}

const queryCache = {};

function getQuery(grammar, language) {
  if (!queryCache[language]) {
    const queryFile = path.join(QUERIES_DIR, QUERY_FILE[language]);
    const querySource = fs.readFileSync(queryFile, 'utf8');
    queryCache[language] = new Parser.Query(grammar, querySource);
  }
  return queryCache[language];
}

function getNodeText(node, source) {
  return source.slice(node.startIndex, node.endIndex);
}

function findEnclosingFunction(node) {
  let current = node.parent;
  while (current) {
    if (
      current.type === 'function_declaration' ||
      current.type === 'method_definition' ||
      current.type === 'arrow_function' ||
      current.type === 'function_definition' // Python
    ) {
      const nameNode = current.childForFieldName('name');
      if (nameNode) return nameNode.text;
    }
    current = current.parent;
  }
  return null;
}

function isExported(node) {
  return node.parent?.type === 'export_statement' ||
    node.parent?.parent?.type === 'export_statement';
}

async function parseFile(db, fileRecord, targetPath, parser) {
  const absPath = path.join(targetPath, fileRecord.path);
  let source;

  try {
    source = fs.readFileSync(absPath, 'utf8');
  } catch {
    updateFileParseStatus(db, fileRecord.id, 'failed');
    return;
  }

  const language = fileRecord.language;
  if (!SUPPORTED_LANGUAGES.has(language)) {
    updateFileParseStatus(db, fileRecord.id, 'unsupported');
    return;
  }

  let grammar;
  try {
    grammar = await getGrammar(language);
  } catch {
    updateFileParseStatus(db, fileRecord.id, 'failed');
    return;
  }

  parser.setLanguage(grammar);

  let tree;
  try {
    tree = parser.parse(source);
  } catch {
    updateFileParseStatus(db, fileRecord.id, 'failed');
    return;
  }

  const query = getQuery(grammar, language);
  const matches = query.matches(tree.rootNode);

  const seenSymbols = new Set();
  const seenImports = new Set();

  for (const match of matches) {
    for (const capture of match.captures) {
      const { name, node } = capture;

      if (name === 'import.source') {
        const specifier = node.text;
        if (!seenImports.has(specifier)) {
          seenImports.add(specifier);
          const isExternal = !specifier.startsWith('.') && !specifier.startsWith('/');
          insertImport(db, {
            file_id: fileRecord.id,
            specifier,
            resolved_file_id: null,
            is_external: isExternal ? 1 : 0,
          });
        }
      } else if (name === 'class.name') {
        const symName = node.text;
        const key = `class:${symName}:${node.startPosition.row}`;
        if (!seenSymbols.has(key)) {
          seenSymbols.add(key);
          insertSymbol(db, {
            file_id: fileRecord.id,
            name: symName,
            kind: 'class',
            is_exported: isExported(node) ? 1 : 0,
            line_start: node.startPosition.row + 1,
            line_end: node.endPosition.row + 1,
          });
        }
      } else if (name === 'function.name') {
        const symName = node.text;
        const key = `function:${symName}:${node.startPosition.row}`;
        if (!seenSymbols.has(key)) {
          seenSymbols.add(key);
          const kind = node.parent?.type === 'method_definition' ? 'method' : 'function';
          insertSymbol(db, {
            file_id: fileRecord.id,
            name: symName,
            kind,
            is_exported: isExported(node) ? 1 : 0,
            line_start: node.startPosition.row + 1,
            line_end: node.endPosition.row + 1,
          });
        }
      } else if (name === 'call.callee') {
        const calleeName = node.text;
        if (calleeName === 'require') continue; // handled as import
        const enclosingFn = findEnclosingFunction(node);
        insertCall(db, {
          file_id: fileRecord.id,
          caller_symbol_id: null, // resolved in graph stage
          callee_name: calleeName,
          callee_file_id: null,
          confidence: 'unresolved',
        });
      }
    }
  }

  updateFileParseStatus(db, fileRecord.id, 'success');
}

export async function parseFiles(db, targetPath, spinner) {
  await loadTreeSitter();
  const parser = new Parser();
  const files = getAllFiles(db).filter(f => f.parse_status === 'pending');

  let parsed = 0;
  let failed = 0;

  for (const file of files) {
    if (spinner) spinner.text = `Parsing files… ${parsed + failed}/${files.length} (${file.path})`;
    await parseFile(db, file, targetPath, parser);
    const status = db.prepare('SELECT parse_status FROM files WHERE id = ?').get(file.id)?.parse_status;
    if (status === 'success') parsed++;
    else if (status === 'failed') failed++;
  }

  return { parsed, failed, total: files.length };
}
