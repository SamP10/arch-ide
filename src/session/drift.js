import { DRIFT_SIGNAL_TYPE, SIGNAL_SEVERITY, GIT_FILE_STATUS } from '../constants.js';

// Tuning thresholds for drift detection.
// DO NOT CHANGE these values without re-evaluating against real repos — they were
// calibrated to minimise false positives on medium-sized codebases (50–500 files).
// cross_layer_churn_min_layers: 3 — touching 3+ distinct layers in one session
//   suggests poly-responsibility or a wide-impact refactor worth flagging.
// layer_concentration_pct: 0.80 — >80% in one layer suggests the session is
//   narrowly focused; combined with drift signals this can indicate hotspot risk.
// hotspot_score_min: 5 — score is the number of files that import this file;
//   5+ importers means a change here has a wide blast radius.
export const DRIFT_THRESHOLDS = {
  cross_layer_churn_min_layers: 3,
  layer_concentration_pct: 0.80,
  hotspot_score_min: 5,
};

/**
 * Detect drift signals from a session's architectural impact.
 * Pure function — no DB access, no I/O.
 *
 * @param {object} archImpact - Output of mapChangesToArchitecture()
 * @param {object} gitChanges - Output of getGitChanges()
 * @param {object} hypothesis - Validated hypothesis JSON from DB
 * @returns {Array<{type: string, severity: string, message: string, affected_files?: string[], affected_layer?: string, author?: string}>}
 */
export function detectDrift(archImpact, gitChanges, hypothesis) {
  const signals = [];
  const { layers, unassigned_changes, dbFileMap } = archImpact;
  const { changedFiles, fileAuthors } = gitChanges;

  const keyFiles = new Set();
  if (hypothesis?.layers) {
    for (const layer of hypothesis.layers) {
      for (const kf of (layer.key_files || [])) keyFiles.add(kf);
    }
  }

  // orphan_file: changed file absent from files table (added since last ingestion)
  for (const file of changedFiles) {
    if (!dbFileMap.has(file.path)) {
      signals.push({
        type: DRIFT_SIGNAL_TYPE.ORPHAN_FILE,
        severity: SIGNAL_SEVERITY.WARNING,
        message: `Changed file not found in DB: ${file.path}`,
        affected_files: [file.path],
      });
    }
  }

  // key_file_modified / key_file_deleted
  for (const file of changedFiles) {
    if (keyFiles.has(file.path)) {
      if (file.status === GIT_FILE_STATUS.DELETED) {
        signals.push({
          type: DRIFT_SIGNAL_TYPE.KEY_FILE_DELETED,
          severity: SIGNAL_SEVERITY.CRITICAL,
          message: `Key file was deleted: ${file.path}`,
          affected_files: [file.path],
        });
      } else {
        signals.push({
          type: DRIFT_SIGNAL_TYPE.KEY_FILE_MODIFIED,
          severity: SIGNAL_SEVERITY.INFO,
          message: `Key file was modified: ${file.path}`,
          affected_files: [file.path],
        });
      }
    }
  }

  // cross_layer_churn: ≥N layers touched by same author
  const authorLayers = new Map(); // author → Set<layer name>
  for (const layer of layers) {
    for (const author of layer.authors) {
      if (!authorLayers.has(author)) authorLayers.set(author, new Set());
      authorLayers.get(author).add(layer.name);
    }
  }
  for (const [author, touchedLayers] of authorLayers) {
    if (touchedLayers.size >= DRIFT_THRESHOLDS.cross_layer_churn_min_layers) {
      signals.push({
        type: DRIFT_SIGNAL_TYPE.CROSS_LAYER_CHURN,
        severity: SIGNAL_SEVERITY.WARNING,
        message: `${author} touched ${touchedLayers.size} layers (${Array.from(touchedLayers).join(', ')})`,
        author,
      });
    }
  }

  // layer_concentration: >X% of changes in one layer
  const totalAssigned = layers.reduce((sum, l) => sum + l.change_count, 0);
  if (totalAssigned > 0) {
    for (const layer of layers) {
      if (layer.change_count / totalAssigned > DRIFT_THRESHOLDS.layer_concentration_pct) {
        signals.push({
          type: DRIFT_SIGNAL_TYPE.LAYER_CONCENTRATION,
          severity: SIGNAL_SEVERITY.INFO,
          message: `${Math.round(layer.change_count / totalAssigned * 100)}% of changes concentrated in layer "${layer.name}"`,
          affected_layer: layer.name,
        });
      }
    }
  }

  // untracked_addition: added file with no cluster assignment
  for (const file of unassigned_changes) {
    if (file.status === GIT_FILE_STATUS.ADDED) {
      signals.push({
        type: DRIFT_SIGNAL_TYPE.UNTRACKED_ADDITION,
        severity: SIGNAL_SEVERITY.WARNING,
        message: `New file added with no cluster assignment: ${file.path}`,
        affected_files: [file.path],
      });
    }
  }

  // hotspot_churn: changed file with hotspot_score at or above threshold
  for (const file of changedFiles) {
    const dbRow = dbFileMap.get(file.path);
    if (dbRow && dbRow.hotspot_score >= DRIFT_THRESHOLDS.hotspot_score_min) {
      signals.push({
        type: DRIFT_SIGNAL_TYPE.HOTSPOT_CHURN,
        severity: SIGNAL_SEVERITY.INFO,
        message: `Hotspot file changed (score ${dbRow.hotspot_score}): ${file.path}`,
        affected_files: [file.path],
      });
    }
  }

  return signals;
}
