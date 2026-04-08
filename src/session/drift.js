export const DRIFT_THRESHOLDS = {
  cross_layer_churn_min_layers: 3,
  layer_concentration_pct: 0.80,
  hotspot_score_min: 5,
};

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

  // orphan_file: changed file absent from files table
  for (const file of changedFiles) {
    if (!dbFileMap.has(file.path)) {
      signals.push({
        type: 'orphan_file',
        severity: 'warning',
        message: `Changed file not found in DB: ${file.path}`,
        affected_files: [file.path],
      });
    }
  }

  // key_file_modified / key_file_deleted
  for (const file of changedFiles) {
    if (keyFiles.has(file.path)) {
      if (file.status === 'deleted') {
        signals.push({
          type: 'key_file_deleted',
          severity: 'critical',
          message: `Key file was deleted: ${file.path}`,
          affected_files: [file.path],
        });
      } else {
        signals.push({
          type: 'key_file_modified',
          severity: 'info',
          message: `Key file was modified: ${file.path}`,
          affected_files: [file.path],
        });
      }
    }
  }

  // cross_layer_churn: ≥3 layers touched by same author
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
        type: 'cross_layer_churn',
        severity: 'warning',
        message: `${author} touched ${touchedLayers.size} layers (${Array.from(touchedLayers).join(', ')})`,
        author,
      });
    }
  }

  // layer_concentration: >80% of changes in one layer
  const totalAssigned = layers.reduce((sum, l) => sum + l.change_count, 0);
  if (totalAssigned > 0) {
    for (const layer of layers) {
      if (layer.change_count / totalAssigned > DRIFT_THRESHOLDS.layer_concentration_pct) {
        signals.push({
          type: 'layer_concentration',
          severity: 'info',
          message: `${Math.round(layer.change_count / totalAssigned * 100)}% of changes concentrated in layer "${layer.name}"`,
          affected_layer: layer.name,
        });
      }
    }
  }

  // untracked_addition: added file with no cluster
  for (const file of unassigned_changes) {
    if (file.status === 'added') {
      signals.push({
        type: 'untracked_addition',
        severity: 'warning',
        message: `New file added with no cluster assignment: ${file.path}`,
        affected_files: [file.path],
      });
    }
  }

  // hotspot_churn: changed file with hotspot_score >= threshold
  for (const file of changedFiles) {
    const dbRow = dbFileMap.get(file.path);
    if (dbRow && dbRow.hotspot_score >= DRIFT_THRESHOLDS.hotspot_score_min) {
      signals.push({
        type: 'hotspot_churn',
        severity: 'info',
        message: `Hotspot file changed (score ${dbRow.hotspot_score}): ${file.path}`,
        affected_files: [file.path],
      });
    }
  }

  return signals;
}
