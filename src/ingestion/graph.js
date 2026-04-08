import path from 'path';
import {
  getAllFiles, getAllImports, getAllCalls, getAllSymbols,
  updateFileHotspotScore, insertCluster, insertClusterFile, getFileByPath,
} from './db.js';

// Resolve a relative import specifier to a file path
function resolveImport(specifier, importingFilePath, allFilePaths) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;

  const importerDir = path.dirname(importingFilePath);
  const resolved = path.normalize(path.join(importerDir, specifier));

  // Try exact match, then common extensions
  const candidates = [
    resolved,
    resolved + '.js',
    resolved + '.ts',
    resolved + '.jsx',
    resolved + '.tsx',
    resolved + '.mjs',
    resolved + '.cjs',
    resolved + '.py',
    path.join(resolved, 'index.js'),
    path.join(resolved, 'index.ts'),
    path.join(resolved, '__init__.py'),
  ];

  for (const candidate of candidates) {
    if (allFilePaths.has(candidate)) return candidate;
  }

  return null;
}

// Union-Find for clustering
class UnionFind {
  constructor() {
    this.parent = new Map();
  }

  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)));
    }
    return this.parent.get(x);
  }

  union(x, y) {
    const px = this.find(x);
    const py = this.find(y);
    if (px !== py) this.parent.set(px, py);
  }
}

export function buildGraphs(db) {
  const files = getAllFiles(db);
  const imports = getAllImports(db);
  const calls = getAllCalls(db);
  const symbols = getAllSymbols(db);

  const fileById = new Map(files.map(f => [f.id, f]));
  const fileByPath = new Map(files.map(f => [f.path, f]));
  const allFilePaths = new Set(files.map(f => f.path));

  // --- Step 1: Resolve imports ---
  const resolvedEdges = []; // { from_file_id, to_file_id }
  const incomingCount = new Map(files.map(f => [f.id, 0]));

  for (const imp of imports) {
    if (imp.is_external) continue;
    const fromFile = fileById.get(imp.file_id);
    if (!fromFile) continue;

    const resolvedPath = resolveImport(imp.specifier, fromFile.path, allFilePaths);
    if (resolvedPath) {
      const toFile = fileByPath.get(resolvedPath);
      if (toFile && toFile.id !== fromFile.id) {
        resolvedEdges.push({ from_file_id: fromFile.id, to_file_id: toFile.id });
        incomingCount.set(toFile.id, (incomingCount.get(toFile.id) || 0) + 1);
      }
    }
  }

  // --- Step 2: Compute hotspot scores ---
  // hotspot = incoming import count + call site count targeting this file's symbols
  const symbolFileMap = new Map(symbols.map(s => [s.id, s.file_id]));
  const callTargetCount = new Map(files.map(f => [f.id, 0]));

  for (const call of calls) {
    // Try to match callee_name to a symbol name in imported files
    const matchingSymbols = symbols.filter(s => s.name === call.callee_name);
    for (const sym of matchingSymbols) {
      callTargetCount.set(sym.file_id, (callTargetCount.get(sym.file_id) || 0) + 1);
    }
  }

  for (const file of files) {
    const score = (incomingCount.get(file.id) || 0) + (callTargetCount.get(file.id) || 0);
    if (score > 0) updateFileHotspotScore(db, file.id, score);
  }

  // --- Step 3: Cluster files via Union-Find on dependency edges ---
  const uf = new UnionFind();

  // Ensure every file is in the union-find
  for (const file of files) uf.find(file.id);

  for (const edge of resolvedEdges) {
    uf.union(edge.from_file_id, edge.to_file_id);
  }

  // Group files by cluster root
  const clusterMap = new Map(); // root → file_id[]
  for (const file of files) {
    const root = uf.find(file.id);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root).push(file.id);
  }

  // Assign cluster IDs (C1, C2, ...) sorted by size descending
  const sortedClusters = [...clusterMap.entries()]
    .sort((a, b) => b[1].length - a[1].length);

  const clusters = [];
  let clusterIndex = 1;

  for (const [, fileIds] of sortedClusters) {
    const clusterId = `C${clusterIndex++}`;

    // Collect external deps for files in this cluster
    const externalDeps = new Set();
    for (const fileId of fileIds) {
      const fileImports = imports.filter(i => i.file_id === fileId && i.is_external);
      for (const imp of fileImports) externalDeps.add(imp.specifier);
    }

    insertCluster(db, {
      id: clusterId,
      file_count: fileIds.length,
      external_deps_json: JSON.stringify([...externalDeps]),
    });

    for (const fileId of fileIds) {
      insertClusterFile(db, clusterId, fileId);
    }

    clusters.push({ id: clusterId, file_ids: fileIds, external_deps: [...externalDeps] });
  }

  // Build file → cluster map for diagram use
  const fileClusterMap = new Map();
  for (const cluster of clusters) {
    for (const fileId of cluster.file_ids) {
      fileClusterMap.set(fileId, cluster.id);
    }
  }

  // --- Step 4: Build cross-cluster edges ---
  const crossClusterEdges = new Map(); // `C1→C2` → count
  for (const edge of resolvedEdges) {
    const fromCluster = fileClusterMap.get(edge.from_file_id);
    const toCluster = fileClusterMap.get(edge.to_file_id);
    if (fromCluster && toCluster && fromCluster !== toCluster) {
      const key = `${fromCluster}→${toCluster}`;
      crossClusterEdges.set(key, (crossClusterEdges.get(key) || 0) + 1);
    }
  }

  // Re-read files from DB so hotspot_score values are fresh
  const freshFiles = getAllFiles(db);

  // Top hotspot files
  const topHotspots = freshFiles
    .filter(f => f.hotspot_score > 0)
    .sort((a, b) => b.hotspot_score - a.hotspot_score)
    .slice(0, 20)
    .map(f => ({ file: f.path, score: f.hotspot_score, imported_by_count: incomingCount.get(f.id) || 0 }));

  return {
    files: freshFiles,
    clusters,
    resolvedEdges,
    crossClusterEdges: [...crossClusterEdges.entries()].map(([key, count]) => {
      const [from, to] = key.split('→');
      return { from, to, edge_count: count };
    }),
    topHotspots,
    fileClusterMap,
  };
}
