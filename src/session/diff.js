export function mapChangesToArchitecture(db, gitChanges, hypothesis) {
  const { changedFiles, fileAuthors } = gitChanges;

  if (!changedFiles.length) {
    return {
      layers: [],
      unassigned_changes: [],
      dbFileMap: new Map(),
    };
  }

  const paths = changedFiles.map(f => f.path);
  const placeholders = paths.map(() => '?').join(', ');

  const rows = db.prepare(`
    SELECT f.path, f.id, f.hotspot_score, cf.cluster_id
    FROM files f
    LEFT JOIN cluster_files cf ON cf.file_id = f.id
    WHERE f.path IN (${placeholders})
  `).all(...paths);

  const dbFileMap = new Map(rows.map(r => [r.path, r]));

  // Build cluster → layer map from hypothesis
  const clusterToLayer = new Map();
  if (hypothesis?.layers) {
    for (const layer of hypothesis.layers) {
      for (const clusterId of (layer.cluster_ids || [])) {
        clusterToLayer.set(clusterId, layer);
      }
    }
  }

  // Group changes by layer
  const layerChanges = new Map(); // layer name → { layer, files: [] }
  const unassigned_changes = [];

  for (const file of changedFiles) {
    const dbRow = dbFileMap.get(file.path);
    const authors = fileAuthors.get(file.path) || [];

    if (!dbRow || !dbRow.cluster_id) {
      unassigned_changes.push({ path: file.path, status: file.status, authors });
      continue;
    }

    const layer = clusterToLayer.get(dbRow.cluster_id);
    if (!layer) {
      unassigned_changes.push({ path: file.path, status: file.status, authors });
      continue;
    }

    if (!layerChanges.has(layer.name)) {
      layerChanges.set(layer.name, {
        name: layer.name,
        responsibility: layer.responsibility,
        clusters_touched: new Set(),
        change_count: 0,
        authors: new Set(),
        files: [],
      });
    }

    const entry = layerChanges.get(layer.name);
    entry.clusters_touched.add(dbRow.cluster_id);
    entry.change_count++;
    for (const a of authors) entry.authors.add(a);
    entry.files.push({ path: file.path, status: file.status, authors });
  }

  const layers = Array.from(layerChanges.values()).map(l => ({
    name: l.name,
    responsibility: l.responsibility,
    clusters_touched: Array.from(l.clusters_touched),
    change_count: l.change_count,
    authors: Array.from(l.authors),
    files: l.files,
  }));

  return { layers, unassigned_changes, dbFileMap };
}
