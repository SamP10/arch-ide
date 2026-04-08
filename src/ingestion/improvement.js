import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { getAllFiles, getClusterForFile, getAllClusters } from './db.js';

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Build a map: file_id → layer info from the validated hypothesis
function buildFileLayerMap(hypothesis, db) {
  const fileLayerMap = new Map(); // file_id → { layerName, clusterId }

  for (const layer of hypothesis.layers) {
    for (const clusterId of layer.cluster_ids) {
      const files = db.prepare(`
        SELECT f.id FROM files f
        JOIN cluster_files cf ON cf.file_id = f.id
        WHERE cf.cluster_id = ?
      `).all(clusterId);

      for (const f of files) {
        fileLayerMap.set(f.id, { layerName: layer.name, clusterId, responsibility: layer.responsibility });
      }
    }
  }

  return fileLayerMap;
}

// Generate the arch comment block for a file
function buildArchComment(language, layerInfo, fileRecord) {
  const { layerName, clusterId, responsibility } = layerInfo;
  // Threshold must match HOTSPOT_THRESHOLD in diagrams.js — @[RELEASE] if either changes.
  const isHotspot = fileRecord.hotspot_score >= 2;

  if (language === 'python') {
    return [
      '# @arch-layer: ' + layerName,
      '# @arch-cluster: ' + clusterId,
      '# @arch-responsibility: ' + responsibility,
      isHotspot ? '# @arch-key-file: true' : null,
      '',
    ].filter(l => l !== null).join('\n');
  }

  // JS/TS default
  const lines = [
    '/**',
    ` * @arch-layer: ${layerName}`,
    ` * @arch-cluster: ${clusterId}`,
    ` * @arch-responsibility: ${responsibility}`,
  ];
  if (isHotspot) lines.push(' * @arch-key-file: true');
  lines.push(' */');
  return lines.join('\n') + '\n';
}

// Insert or replace arch comment in source
function applyArchComment(source, language, layerInfo, fileRecord) {
  const marker = '@arch-layer:';

  // If already present, replace the existing block
  if (source.includes(marker)) {
    if (language === 'python') {
      return source.replace(/^(# @arch-[^\n]*\n)+/m, buildArchComment(language, layerInfo, fileRecord));
    }
    return source.replace(/\/\*\*\s*\n(?:\s*\*[^\n]*\n)*?\s*\*\/\n(?=.*@arch-layer)/s,
      buildArchComment(language, layerInfo, fileRecord));
  }

  // Otherwise prepend
  return buildArchComment(language, layerInfo, fileRecord) + '\n' + source;
}

// Build grep tag for a symbol line
function buildGrepTag(language, symbolName, layerName, isHotspot) {
  const slug = slugify(layerName);
  const tags = [slug];
  if (isHotspot) tags.push('hotspot');

  if (language === 'python') {
    return `# @arch-tag: ${symbolName} [${tags.join(', ')}]`;
  }
  return `// @arch-tag: ${symbolName} [${tags.join(', ')}]`;
}

// Insert grep tags above function/class declarations
function applyGrepTags(source, language, symbols, layerName, isHotspotFile) {
  const lines = source.split('\n');
  const insertions = new Map(); // line_number (1-indexed) → tag string

  for (const sym of symbols) {
    if (!sym.line_start) continue;
    const lineIdx = sym.line_start - 1; // 0-indexed
    const tag = buildGrepTag(language, sym.name, layerName, isHotspotFile);

    // Don't double-insert
    const prevLine = lines[lineIdx - 1] || '';
    if (prevLine.includes('@arch-tag:')) continue;

    insertions.set(lineIdx, tag);
  }

  if (insertions.size === 0) return source;

  const result = [];
  for (let i = 0; i < lines.length; i++) {
    if (insertions.has(i)) result.push(insertions.get(i));
    result.push(lines[i]);
  }
  return result.join('\n');
}

function buildClaudeMd(hypothesis, repoName) {
  const lines = [
    `# ${repoName} — Architectural Overview`,
    '',
    `## Architecture Style`,
    `${hypothesis.architecture_style} (confidence: ${Math.round(hypothesis.confidence * 100)}%)`,
    '',
    `## Reasoning`,
    hypothesis.reasoning,
    '',
    `## Layers`,
  ];

  for (const layer of hypothesis.layers) {
    lines.push('', `### ${layer.name}`);
    lines.push(`**Clusters:** ${layer.cluster_ids.join(', ')}`);
    lines.push(`**Responsibility:** ${layer.responsibility}`);
    if (layer.key_files?.length) lines.push(`**Key files:** ${layer.key_files.join(', ')}`);
    if (layer.interfaces_with?.length) lines.push(`**Interfaces with:** ${layer.interfaces_with.join(', ')}`);
  }

  if (hypothesis.entry_points?.length) {
    lines.push('', '## Entry Points');
    for (const ep of hypothesis.entry_points) lines.push(`- \`${ep}\``);
  }

  lines.push(
    '',
    '## Navigation',
    '- Search `@arch-tag` for a navigable index of all functions and classes',
    '- Search `@arch-layer` to find all files belonging to a specific layer',
    '',
  );

  if (hypothesis.concerns?.length) {
    lines.push('## Known Concerns');
    for (const c of hypothesis.concerns) lines.push(`- ⚠ ${c}`);
    lines.push('');
  }

  return lines.join('\n');
}

export async function runImprovement(db, targetPath, archDir, hypothesis, options = {}) {
  if (options.skipImprovement) return;

  const files = getAllFiles(db).filter(f => f.parse_status === 'success');
  const fileLayerMap = buildFileLayerMap(hypothesis, db);
  const repoName = path.basename(targetPath);

  // Build preview of changes
  const pending = [];

  for (const file of files) {
    const layerInfo = fileLayerMap.get(file.id);
    if (!layerInfo) continue;

    const absPath = path.join(targetPath, file.path);
    let source;
    try { source = fs.readFileSync(absPath, 'utf8'); } catch { continue; }

    const original = source;
    let modified = source;

    // Apply arch comment
    modified = applyArchComment(modified, file.language, layerInfo, file);

    // Apply grep tags
    const symbols = db.prepare('SELECT * FROM symbols WHERE file_id = ?').all(file.id);
    if (symbols.length > 0) {
      modified = applyGrepTags(modified, file.language, symbols, layerInfo.layerName, file.hotspot_score >= 2);
    }

    if (modified !== original) {
      pending.push({ file, absPath, original, modified, originalHash: sha256(original) });
    }
  }

  const claudeMdContent = buildClaudeMd(hypothesis, repoName);

  if (pending.length === 0 && !options.dryRun) {
    console.log(chalk.dim('No improvement changes needed (files may already be annotated).\n'));
  } else {
    console.log(chalk.bold(`\nRepo Improvement Preview`));
    console.log(chalk.dim(`${pending.length} files will be modified with arch comments and grep tags.\n`));

    if (options.dryRun) {
      console.log(chalk.yellow('Dry run — no files will be written.\n'));
      for (const p of pending.slice(0, 5)) {
        console.log(`  ${chalk.cyan(p.file.path)}`);
      }
      if (pending.length > 5) console.log(`  ${chalk.dim(`… and ${pending.length - 5} more`)}`);
      return;
    }

    const { applyChoice } = await inquirer.prompt([{
      type: 'list',
      name: 'applyChoice',
      message: 'Apply these improvements?',
      choices: [
        { name: chalk.green('Yes — apply to all files'), value: 'all' },
        { name: 'Review and apply file by file', value: 'per_file' },
        { name: chalk.red('No — skip improvement'), value: 'skip' },
      ],
    }]);

    if (applyChoice === 'skip') {
      console.log(chalk.dim('Skipped repo improvement.\n'));
      return;
    }

    const log = { run_id: null, files_modified: [], per_file: {} };
    const toApply = applyChoice === 'all' ? pending : [];

    if (applyChoice === 'per_file') {
      for (const p of pending) {
        const { apply } = await inquirer.prompt([{
          type: 'confirm',
          name: 'apply',
          message: `Apply to ${chalk.cyan(p.file.path)}?`,
          default: true,
        }]);
        if (apply) toApply.push(p);
      }
    }

    for (const p of toApply) {
      fs.writeFileSync(p.absPath, p.modified, 'utf8');
      log.files_modified.push(p.file.path);
      log.per_file[p.file.path] = { original_hash: p.originalHash };
    }

    // Write CLAUDE.md to .arch-ide/
    fs.writeFileSync(path.join(archDir, 'CLAUDE.md'), claudeMdContent);

    // Offer to write to repo root
    const { writeRoot } = await inquirer.prompt([{
      type: 'confirm',
      name: 'writeRoot',
      message: `Also write CLAUDE.md to the repo root (${targetPath})?`,
      default: true,
    }]);

    if (writeRoot) {
      fs.writeFileSync(path.join(targetPath, 'CLAUDE.md'), claudeMdContent);
      log.files_modified.push('CLAUDE.md');
    }

    // Write audit log
    fs.writeFileSync(
      path.join(archDir, 'improvement_log.json'),
      JSON.stringify(log, null, 2)
    );

    console.log(chalk.green(`\n✓ Applied improvements to ${toApply.length} files.\n`));
  }
}
