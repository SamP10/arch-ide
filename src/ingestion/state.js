import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { openDb, createRun, getCompletedStages } from './db.js';

const ARCH_DIR_NAME = '.arch-ide';

export function getArchDir(targetPath) {
  return path.join(targetPath, ARCH_DIR_NAME);
}

export function initArchDir(targetPath) {
  const archDir = getArchDir(targetPath);
  fs.mkdirSync(path.join(archDir, 'diagrams'), { recursive: true });
  fs.mkdirSync(path.join(archDir, 'runs'), { recursive: true });
  return archDir;
}

export function generateRunId() {
  return crypto.randomBytes(6).toString('hex');
}

export function initRun(targetPath, resumeRunId = null) {
  const archDir = initArchDir(targetPath);
  const db = openDb(archDir);

  let runId;
  let completedStages;

  if (resumeRunId) {
    completedStages = getCompletedStages(db, resumeRunId);
    if (!completedStages) {
      throw new Error(`Run ID not found: ${resumeRunId}`);
    }
    runId = resumeRunId;
    console.log(`Resuming run ${runId} (completed stages: ${completedStages.join(', ') || 'none'})`);
  } else {
    runId = generateRunId();
    completedStages = [];
    createRun(db, runId, targetPath);
  }

  const runDir = path.join(archDir, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });

  writeMeta(runDir, { run_id: runId, started_at: new Date().toISOString(), target_path: targetPath, stages_completed: completedStages });

  return { db, runId, archDir, runDir, completedStages };
}

export function writeMeta(runDir, meta) {
  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));
}

export function writeAnalysisPayload(runDir, payload) {
  fs.writeFileSync(path.join(runDir, 'analysis_payload.json'), JSON.stringify(payload, null, 2));
}

export function writeHypothesisFiles(archDir, hypothesis) {
  fs.writeFileSync(
    path.join(archDir, 'HYPOTHESIS.json'),
    JSON.stringify(hypothesis, null, 2)
  );

  const md = formatHypothesisMarkdown(hypothesis);
  fs.writeFileSync(path.join(archDir, 'HYPOTHESIS.md'), md);
}

function formatHypothesisMarkdown(h) {
  const lines = [
    `# Architectural Hypothesis`,
    ``,
    `**Style:** ${h.architecture_style}`,
    `**Confidence:** ${Math.round(h.confidence * 100)}%`,
    ``,
    `## Reasoning`,
    h.reasoning,
    ``,
    `## Layers`,
  ];

  for (const layer of h.layers) {
    lines.push(``, `### ${layer.name}`);
    lines.push(`**Clusters:** ${layer.cluster_ids.join(', ')}`);
    lines.push(`**Responsibility:** ${layer.responsibility}`);
    if (layer.key_files?.length) {
      lines.push(`**Key files:** ${layer.key_files.join(', ')}`);
    }
    if (layer.interfaces_with?.length) {
      lines.push(`**Interfaces with:** ${layer.interfaces_with.join(', ')}`);
    }
  }

  if (h.entry_points?.length) {
    lines.push(``, `## Entry Points`);
    for (const ep of h.entry_points) lines.push(`- ${ep}`);
  }

  if (h.concerns?.length) {
    lines.push(``, `## Concerns`);
    for (const c of h.concerns) lines.push(`- ⚠ ${c}`);
  }

  return lines.join('\n');
}
