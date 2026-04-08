import chalk from 'chalk';
import { SIGNAL_SEVERITY, SESSION_MODE, GIT_FILE_STATUS } from '../constants.js';

/**
 * Build the structured JSON session report.
 *
 * @param {object|null} baseline - Latest completed run row from DB, or null
 * @param {object} gitChanges - Output of getGitChanges()
 * @param {object} archImpact - Output of mapChangesToArchitecture()
 * @param {Array} driftSignals - Output of detectDrift()
 * @param {{mode: string, warnings: string[]}} meta - Session mode and accumulated warnings
 * @returns {{generated_at: string, baseline_run: object|null, summary: object, layers: Array, unassigned_changes: Array, drift_signals: Array, git_context: object, meta: object}}
 */
export function buildReport(baseline, gitChanges, archImpact, driftSignals, meta) {
  const allAuthors = new Set();
  for (const layer of archImpact.layers) {
    for (const a of layer.authors) allAuthors.add(a);
  }
  for (const f of archImpact.unassigned_changes) {
    for (const a of f.authors) allAuthors.add(a);
  }
  // Also collect from git commits
  for (const c of gitChanges.commits) allAuthors.add(c.author);

  const hasDrift = driftSignals.some(s => s.severity === SIGNAL_SEVERITY.CRITICAL || s.severity === SIGNAL_SEVERITY.WARNING);

  return {
    generated_at: new Date().toISOString(),
    baseline_run: baseline
      ? { completed_at: baseline.completed_at, run_id: baseline.id }
      : null,
    summary: {
      total_files_changed: gitChanges.changedFiles.length,
      layers_touched: archImpact.layers.length,
      authors: Array.from(allAuthors).filter(Boolean),
      has_drift: hasDrift,
    },
    layers: archImpact.layers,
    unassigned_changes: archImpact.unassigned_changes,
    drift_signals: driftSignals,
    git_context: {
      commit_count: gitChanges.commits.length,
      from_commit: gitChanges.fromCommitHash,
      to_commit: gitChanges.toCommitHash,
      authors: Array.from(new Set(gitChanges.commits.map(c => c.author))).filter(Boolean),
    },
    meta,
  };
}

export function formatHumanReadable(report) {
  const lines = [];

  lines.push('');
  lines.push(chalk.bold.cyan('  Arch IDE — Session Start'));
  lines.push(chalk.gray('  ' + '─'.repeat(40)));

  // Summary
  const s = report.summary;
  const modeLabel = report.meta.mode !== SESSION_MODE.NORMAL ? chalk.yellow(` [${report.meta.mode}]`) : '';
  lines.push('');
  lines.push(
    chalk.bold('  Summary') + modeLabel
  );

  if (report.meta.mode === SESSION_MODE.NO_GIT) {
    lines.push(chalk.yellow('  ⚠  No git repository detected — cannot surface changes.'));
  } else if (report.meta.mode === SESSION_MODE.FIRST_RUN) {
    lines.push(chalk.yellow('  ⚠  No previous ingestion run found. Run arch-ingest first.'));
  } else {
    lines.push(
      `  ${chalk.white(s.total_files_changed)} files changed  ·  ` +
      `${chalk.white(s.layers_touched)} layer${s.layers_touched !== 1 ? 's' : ''} touched  ·  ` +
      `${chalk.white(s.authors.length)} author${s.authors.length !== 1 ? 's' : ''}`
    );
    if (s.authors.length) {
      lines.push(chalk.gray(`  Authors: ${s.authors.join(', ')}`));
    }
  }

  // Git context
  if (report.git_context.commit_count > 0) {
    lines.push('');
    lines.push(chalk.bold('  Git Context'));
    lines.push(`  ${chalk.white(report.git_context.commit_count)} commit${report.git_context.commit_count !== 1 ? 's' : ''} since last run`);
    if (report.git_context.from_commit) {
      lines.push(chalk.gray(`  ${report.git_context.from_commit.slice(0, 7)} → ${report.git_context.to_commit?.slice(0, 7) ?? 'HEAD'}`));
    }
  }

  // Layers
  if (report.layers.length) {
    lines.push('');
    lines.push(chalk.bold('  Layers Touched'));
    for (const layer of report.layers) {
      lines.push('');
      lines.push(`  ${chalk.cyan.bold(layer.name)}  ${chalk.gray(layer.responsibility || '')}`);
      lines.push(`  ${chalk.white(layer.change_count)} change${layer.change_count !== 1 ? 's' : ''}  ·  clusters: ${layer.clusters_touched.join(', ')}`);
      if (layer.authors.length) {
        lines.push(chalk.gray(`  Authors: ${layer.authors.join(', ')}`));
      }
      for (const f of layer.files) {
        const statusColor = f.status === GIT_FILE_STATUS.ADDED ? chalk.green : f.status === GIT_FILE_STATUS.DELETED ? chalk.red : chalk.yellow;
        lines.push(`    ${statusColor(f.status.padEnd(8))}  ${f.path}`);
      }
    }
  }

  // Unassigned
  if (report.unassigned_changes.length) {
    lines.push('');
    lines.push(chalk.bold('  Unassigned Changes') + chalk.gray(' (no cluster)'));
    for (const f of report.unassigned_changes) {
      const statusColor = f.status === 'added' ? chalk.green : f.status === 'deleted' ? chalk.red : chalk.yellow;
      lines.push(`    ${statusColor(f.status.padEnd(8))}  ${f.path}`);
    }
  }

  // Drift signals
  if (report.drift_signals.length) {
    lines.push('');
    lines.push(chalk.bold('  Drift Signals'));
    for (const sig of report.drift_signals) {
      const icon =
        sig.severity === SIGNAL_SEVERITY.CRITICAL ? chalk.red('✖') :
        sig.severity === SIGNAL_SEVERITY.WARNING  ? chalk.yellow('⚠') :
        chalk.blue('ℹ');
      const label =
        sig.severity === SIGNAL_SEVERITY.CRITICAL ? chalk.red(sig.severity) :
        sig.severity === SIGNAL_SEVERITY.WARNING  ? chalk.yellow(sig.severity) :
        chalk.blue(sig.severity);
      lines.push(`  ${icon} ${label.padEnd(12)}  ${sig.message}`);
    }
  }

  // Warnings
  if (report.meta.warnings?.length) {
    lines.push('');
    for (const w of report.meta.warnings) {
      lines.push(chalk.gray(`  ⚠ ${w}`));
    }
  }

  lines.push('');

  return lines.join('\n');
}
