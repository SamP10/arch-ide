import ora from 'ora';
import chalk from 'chalk';
import { initRun, writeHypothesisFiles } from './state.js';
import { HYPOTHESIS_STATUS } from '../constants.js';
import { markStageComplete, getCompletedStages, markRunComplete } from './db.js';
import { walkFiles } from './walker.js';
import { parseFiles } from './parser.js';
import { buildGraphs } from './graph.js';
import { generateDiagrams } from './diagrams.js';
import { generateHypothesis } from './claude.js';
import { validateHypothesis } from './hypothesis.js';
import { runImprovement } from './improvement.js';

// DO NOT reorder STAGES — the resume logic in initRun()/getCompletedStages() depends
// on this order to determine which stages to skip. Add new stages at the end only.
// @[RELEASE] — if a stage is added or renamed, existing in-progress runs will be
// incompatible with the new stage list. Document the migration in the release notes.
const STAGES = [
  'walk_files',
  'parse_files',
  'build_graphs',
  'gen_diagrams',
  'call_claude',
  'validate',
  'improve',
  'finalize',
];

function shouldSkip(stageName, completedStages) {
  return completedStages.includes(stageName);
}

export async function runIngestion(targetPath, options = {}) {
  const { skipImprovement, dryRun, model = 'claude-opus-4-6', resume } = options;

  console.log(chalk.bold('\nArch IDE — Repo Ingestion'));
  console.log(chalk.dim(`Target: ${targetPath}\n`));

  const { db, runId, archDir, runDir, completedStages } = initRun(targetPath, resume);

  console.log(chalk.dim(`Run ID: ${runId}\n`));

  let graphData;
  let diagrams;
  let hypothesis;
  let hypothesisId;

  // --- Stage: walk_files ---
  if (!shouldSkip('walk_files', completedStages)) {
    const spinner = ora('Walking files…').start();
    try {
      const files = await walkFiles(db, targetPath);
      spinner.succeed(`Found ${files.length} source files`);
      markStageComplete(db, runId, 'walk_files');
    } catch (err) {
      spinner.fail(`File walk failed: ${err.message}`);
      throw err;
    }
  } else {
    console.log(chalk.dim('  ✓ walk_files (skipped — already complete)'));
  }

  // --- Stage: parse_files ---
  if (!shouldSkip('parse_files', completedStages)) {
    const spinner = ora('Parsing files…').start();
    try {
      const { parsed, failed, total } = await parseFiles(db, targetPath, spinner);
      spinner.succeed(`Parsed ${parsed}/${total} files (${failed} failed)`);
      markStageComplete(db, runId, 'parse_files');
    } catch (err) {
      spinner.fail(`Parsing failed: ${err.message}`);
      throw err;
    }
  } else {
    console.log(chalk.dim('  ✓ parse_files (skipped — already complete)'));
  }

  // --- Stage: build_graphs ---
  if (!shouldSkip('build_graphs', completedStages)) {
    const spinner = ora('Building dependency and call graphs…').start();
    try {
      graphData = buildGraphs(db);
      spinner.succeed(`Built graph: ${graphData.clusters.length} clusters, ${graphData.resolvedEdges.length} dependency edges`);
      markStageComplete(db, runId, 'build_graphs');
    } catch (err) {
      spinner.fail(`Graph build failed: ${err.message}`);
      throw err;
    }
  } else {
    console.log(chalk.dim('  ✓ build_graphs (skipped — already complete)'));
    // Rebuild from DB for downstream stages
    graphData = buildGraphsFromDb(db);
  }

  // --- Stage: gen_diagrams ---
  if (!shouldSkip('gen_diagrams', completedStages)) {
    const spinner = ora('Generating Mermaid diagrams…').start();
    try {
      diagrams = generateDiagrams(db, runId, archDir, graphData);
      spinner.succeed(`Diagrams written to ${archDir}/diagrams/`);
      markStageComplete(db, runId, 'gen_diagrams');
    } catch (err) {
      spinner.fail(`Diagram generation failed: ${err.message}`);
      throw err;
    }
  } else {
    console.log(chalk.dim('  ✓ gen_diagrams (skipped — already complete)'));
    diagrams = loadDiagramsFromDb(db, runId);
  }

  // --- Stage: call_claude ---
  if (!shouldSkip('call_claude', completedStages)) {
    const spinner = ora('Calling Claude to generate architectural hypothesis…').start();
    try {
      const result = await generateHypothesis(db, runId, graphData, diagrams, model, runDir);
      hypothesisId = result.id;
      hypothesis = result;
      spinner.succeed('Architectural hypothesis generated');
      markStageComplete(db, runId, 'call_claude');
    } catch (err) {
      spinner.fail(`Claude call failed: ${err.message}`);
      throw err;
    }
  } else {
    console.log(chalk.dim('  ✓ call_claude (skipped — already complete)'));
    const row = db.prepare(`SELECT * FROM hypotheses WHERE run_id = ? ORDER BY id DESC LIMIT 1`).get(runId);
    hypothesisId = row.id;
    hypothesis = JSON.parse(row.validated_json || row.raw_response_json);
  }

  // --- Stage: validate ---
  if (!shouldSkip('validate', completedStages)) {
    try {
      const result = await validateHypothesis(db, hypothesisId, hypothesis);
      if (result.status === HYPOTHESIS_STATUS.VALIDATED) {
        hypothesis = result.hypothesis;
        markStageComplete(db, runId, 'validate');
      } else {
        // Skipped — stop here, user can resume later
        console.log(chalk.dim(`\nTo resume: node scripts/ingest.js ${targetPath} --resume ${runId}\n`));
        return;
      }
    } catch (err) {
      console.error(`Validation error: ${err.message}`);
      throw err;
    }
  } else {
    console.log(chalk.dim('  ✓ validate (skipped — already complete)'));
    const row = db.prepare(`SELECT validated_json FROM hypotheses WHERE run_id = ? ORDER BY id DESC LIMIT 1`).get(runId);
    hypothesis = JSON.parse(row.validated_json);
  }

  // --- Stage: improve ---
  if (!shouldSkip('improve', completedStages)) {
    try {
      await runImprovement(db, targetPath, archDir, hypothesis, { skipImprovement, dryRun });
      if (!dryRun) markStageComplete(db, runId, 'improve');
    } catch (err) {
      console.error(`Improvement error: ${err.message}`);
      throw err;
    }
  } else {
    console.log(chalk.dim('  ✓ improve (skipped — already complete)'));
  }

  // --- Stage: finalize ---
  if (!shouldSkip('finalize', completedStages) && !dryRun) {
    writeHypothesisFiles(archDir, hypothesis);
    markStageComplete(db, runId, 'finalize');
    markRunComplete(db, runId);
  }

  console.log(chalk.bold.green('\n✓ Ingestion complete!\n'));
  console.log(`  Hypothesis:  ${archDir}/HYPOTHESIS.json`);
  console.log(`  Diagrams:    ${archDir}/diagrams/`);
  console.log(`  Database:    ${archDir}/arch.db`);
  console.log(`  Run ID:      ${runId}\n`);
}

// Rebuild graph data from DB for resume cases (avoids re-running analysis)
function buildGraphsFromDb(db) {
  const files = db.prepare('SELECT * FROM files').all();
  const clusters = db.prepare('SELECT * FROM clusters').all().map(c => ({
    ...c,
    file_ids: db.prepare('SELECT file_id FROM cluster_files WHERE cluster_id = ?').all(c.id).map(r => r.file_id),
    external_deps: JSON.parse(c.external_deps_json),
  }));

  const fileClusterMap = new Map();
  for (const cluster of clusters) {
    for (const fileId of cluster.file_ids) fileClusterMap.set(fileId, cluster.id);
  }

  // Cross-cluster edges not stored separately — rebuild from imports
  const imports = db.prepare('SELECT * FROM imports WHERE is_external = 0 AND resolved_file_id IS NOT NULL').all();
  const crossEdgeMap = new Map();
  for (const imp of imports) {
    const fromCluster = fileClusterMap.get(imp.file_id);
    const toCluster = fileClusterMap.get(imp.resolved_file_id);
    if (fromCluster && toCluster && fromCluster !== toCluster) {
      const key = `${fromCluster}→${toCluster}`;
      crossEdgeMap.set(key, (crossEdgeMap.get(key) || 0) + 1);
    }
  }

  const topHotspots = files
    .filter(f => f.hotspot_score > 0)
    .sort((a, b) => b.hotspot_score - a.hotspot_score)
    .slice(0, 20)
    .map(f => ({ file: f.path, score: f.hotspot_score, imported_by_count: 0 }));

  return {
    files,
    clusters,
    resolvedEdges: imports.map(i => ({ from_file_id: i.file_id, to_file_id: i.resolved_file_id })),
    crossClusterEdges: [...crossEdgeMap.entries()].map(([key, count]) => {
      const [from, to] = key.split('→');
      return { from, to, edge_count: count };
    }),
    topHotspots,
    fileClusterMap,
  };
}

function loadDiagramsFromDb(db, runId) {
  const arch = db.prepare("SELECT content FROM diagrams WHERE run_id = ? AND type = 'arch'").get(runId);
  const deps = db.prepare("SELECT content FROM diagrams WHERE run_id = ? AND type = 'deps'").get(runId);
  const calls = db.prepare("SELECT content FROM diagrams WHERE run_id = ? AND type = 'calls'").get(runId);
  return {
    archMmd: arch?.content || '',
    depsMmd: deps?.content || '',
    callsMmd: calls?.content || '',
  };
}
