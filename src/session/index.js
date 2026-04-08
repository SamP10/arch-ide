import { openDb } from '../ingestion/db.js';
import { getArchDir } from '../ingestion/state.js';
import { getGitChanges } from './git.js';
import { mapChangesToArchitecture } from './diff.js';
import { detectDrift } from './drift.js';
import { buildReport, formatHumanReadable } from './report.js';
import { SESSION_MODE, HYPOTHESIS_STATUS } from '../constants.js';

export async function runSessionStart(targetPath, options = {}) {
  const archDir = getArchDir(targetPath);
  const db = openDb(archDir);

  const baseline = db.prepare(
    `SELECT * FROM runs WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`
  ).get();

  const hypothesisRow = db.prepare(
    // @[SCHEMA_CHANGE] — update if hypotheses table columns change
    `SELECT validated_json FROM hypotheses WHERE status = ? ORDER BY id DESC LIMIT 1`
  ).get(HYPOTHESIS_STATUS.VALIDATED);

  const meta = { mode: SESSION_MODE.NORMAL, warnings: [] };
  if (!baseline) meta.mode = SESSION_MODE.FIRST_RUN;

  const hypothesis = hypothesisRow ? JSON.parse(hypothesisRow.validated_json) : null;
  if (!hypothesis && meta.mode !== SESSION_MODE.FIRST_RUN) meta.mode = SESSION_MODE.NO_HYPOTHESIS;

  const gitChanges = await getGitChanges(targetPath, baseline?.completed_at);
  if (gitChanges.error === 'no_git') {
    meta.mode = SESSION_MODE.NO_GIT;
  }
  if (gitChanges.meta?.warnings?.length) {
    meta.warnings.push(...gitChanges.meta.warnings);
  }

  const archImpact = mapChangesToArchitecture(db, gitChanges, hypothesis);
  const driftSignals = hypothesis ? detectDrift(archImpact, gitChanges, hypothesis) : [];
  const report = buildReport(baseline, gitChanges, archImpact, driftSignals, meta);

  if (!options.silent) console.log(formatHumanReadable(report));
  return report;
}
