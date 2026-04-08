import fs from 'fs';
import path from 'path';
import { getAllFiles, getFilesInCluster, insertDiagram } from './db.js';

const HOTSPOT_THRESHOLD = 2;
const MAX_CALL_GRAPH_NODES = 20;

function sanitizeId(str) {
  return str.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '');
}

function shortPath(filePath) {
  const parts = filePath.split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : filePath;
}

// Architectural diagram: clusters as nodes, cross-cluster edges
function buildArchDiagram(clusters, crossClusterEdges, db) {
  const lines = ['graph TD'];

  // Detect isolated clusters (no cross-cluster edges)
  const connectedClusters = new Set();
  for (const edge of crossClusterEdges) {
    connectedClusters.add(edge.from);
    connectedClusters.add(edge.to);
  }

  for (const cluster of clusters) {
    const files = getFilesInCluster(db, cluster.id);
    const label = cluster.id;
    const fileList = files.slice(0, 3).map(f => shortPath(f.path)).join('<br/>');
    const suffix = files.length > 3 ? `<br/>+${files.length - 3} more` : '';
    const isolated = !connectedClusters.has(cluster.id) ? ' 🔵' : '';
    lines.push(`  ${label}["${label} (${files.length} files)<br/>${fileList}${suffix}${isolated}"]`);
  }

  lines.push('');

  for (const edge of crossClusterEdges) {
    lines.push(`  ${edge.from} -->|${edge.edge_count}| ${edge.to}`);
  }

  return lines.join('\n');
}

// Dependency diagram: file-level, filtered to hotspot files
function buildDepsDiagram(files, resolvedEdges, fileClusterMap) {
  const hotspotFiles = new Set(
    files.filter(f => f.hotspot_score >= HOTSPOT_THRESHOLD).map(f => f.id)
  );

  // Only include edges where at least one end is a hotspot
  const relevantEdges = resolvedEdges.filter(
    e => hotspotFiles.has(e.from_file_id) || hotspotFiles.has(e.to_file_id)
  );

  const nodeIds = new Set();
  for (const edge of relevantEdges) {
    nodeIds.add(edge.from_file_id);
    nodeIds.add(edge.to_file_id);
  }

  const nodeMap = new Map(files.map(f => [f.id, f]));

  const lines = ['graph TD'];

  // Group into subgraphs by cluster
  const clusterNodes = new Map();
  for (const nodeId of nodeIds) {
    const clusterId = fileClusterMap.get(nodeId) || 'ungrouped';
    if (!clusterNodes.has(clusterId)) clusterNodes.set(clusterId, []);
    clusterNodes.get(clusterId).push(nodeId);
  }

  for (const [clusterId, ids] of clusterNodes) {
    lines.push(`  subgraph ${clusterId}`);
    for (const id of ids) {
      const file = nodeMap.get(id);
      if (file) {
        const nodeId = sanitizeId(file.path);
        const label = shortPath(file.path);
        const hotspot = hotspotFiles.has(id) ? ' ⭐' : '';
        lines.push(`    ${nodeId}["${label}${hotspot}"]`);
      }
    }
    lines.push('  end');
  }

  lines.push('');

  for (const edge of relevantEdges) {
    const from = nodeMap.get(edge.from_file_id);
    const to = nodeMap.get(edge.to_file_id);
    if (from && to) {
      lines.push(`  ${sanitizeId(from.path)} --> ${sanitizeId(to.path)}`);
    }
  }

  return lines.join('\n');
}

// Call graph: top hotspot files and their symbols
function buildCallsDiagram(files, calls, symbols) {
  const symbolById = new Map(symbols.map(s => [s.id, s]));
  const fileById = new Map(files.map(f => [f.id, f]));

  // Top hotspot files
  const topFiles = [...files]
    .sort((a, b) => b.hotspot_score - a.hotspot_score)
    .slice(0, MAX_CALL_GRAPH_NODES);

  const topFileIds = new Set(topFiles.map(f => f.id));

  const lines = ['graph LR'];

  for (const file of topFiles) {
    const nodeId = sanitizeId(file.path);
    const label = shortPath(file.path);
    lines.push(`  ${nodeId}["${label}\\n(score: ${file.hotspot_score})"]`);
  }

  lines.push('');

  // Cross-file calls between top files
  const seenEdges = new Set();
  for (const call of calls) {
    if (!topFileIds.has(call.file_id)) continue;
    if (!call.callee_file_id || !topFileIds.has(call.callee_file_id)) continue;
    if (call.file_id === call.callee_file_id) continue;

    const key = `${call.file_id}→${call.callee_file_id}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);

    const from = fileById.get(call.file_id);
    const to = fileById.get(call.callee_file_id);
    if (from && to) {
      lines.push(`  ${sanitizeId(from.path)} -->|${call.callee_name}| ${sanitizeId(to.path)}`);
    }
  }

  return lines.join('\n');
}

export function generateDiagrams(db, runId, archDir, graphData) {
  const { clusters, resolvedEdges, crossClusterEdges, files, topHotspots, fileClusterMap } = graphData;
  const allSymbols = db.prepare('SELECT * FROM symbols').all();
  const allCalls = db.prepare('SELECT * FROM calls').all();

  const diagDir = path.join(archDir, 'diagrams');

  const archMmd = buildArchDiagram(clusters, crossClusterEdges, db);
  const depsMmd = buildDepsDiagram(files, resolvedEdges, fileClusterMap);
  const callsMmd = buildCallsDiagram(files, allCalls, allSymbols);

  fs.writeFileSync(path.join(diagDir, 'arch.mmd'), archMmd);
  fs.writeFileSync(path.join(diagDir, 'deps.mmd'), depsMmd);
  fs.writeFileSync(path.join(diagDir, 'calls.mmd'), callsMmd);

  const hotspotFileIds = new Set(files.filter(f => f.hotspot_score >= HOTSPOT_THRESHOLD).map(f => f.id));
  const depsEdges = resolvedEdges.filter(e => hotspotFileIds.has(e.from_file_id) || hotspotFileIds.has(e.to_file_id));

  insertDiagram(db, { run_id: runId, type: 'arch', content: archMmd, node_count: clusters.length, edge_count: crossClusterEdges.length, filter_threshold: null });
  insertDiagram(db, { run_id: runId, type: 'deps', content: depsMmd, node_count: hotspotFileIds.size, edge_count: depsEdges.length, filter_threshold: HOTSPOT_THRESHOLD });
  insertDiagram(db, { run_id: runId, type: 'calls', content: callsMmd, node_count: Math.min(files.length, MAX_CALL_GRAPH_NODES), edge_count: null, filter_threshold: MAX_CALL_GRAPH_NODES });

  return { archMmd, depsMmd, callsMmd };
}
