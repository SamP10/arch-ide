import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getAllFiles, getAllClusters, getFilesInCluster, getAllImports, insertHypothesis } from './db.js';

const LayerSchema = z.object({
  name: z.string(),
  cluster_ids: z.array(z.string()),
  responsibility: z.string(),
  key_files: z.array(z.string()).optional().default([]),
  interfaces_with: z.array(z.string()).optional().default([]),
});

const HypothesisSchema = z.object({
  architecture_style: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  layers: z.array(LayerSchema),
  entry_points: z.array(z.string()).optional().default([]),
  concerns: z.array(z.string()).optional().default([]),
});

function buildAnalysisSummary(db, graphData, diagrams) {
  const files = getAllFiles(db);
  const clusters = getAllClusters(db);
  const imports = getAllImports(db);

  const langCounts = {};
  let parseFailed = 0;
  for (const f of files) {
    if (f.parse_status === 'failed') { parseFailed++; continue; }
    if (f.language) langCounts[f.language] = (langCounts[f.language] || 0) + 1;
  }

  const moduleClusters = clusters.map(cluster => {
    const clusterFiles = getFilesInCluster(db, cluster.id);
    const hotspots = {};
    for (const f of clusterFiles) {
      if (f.hotspot_score > 0) hotspots[f.path] = f.hotspot_score;
    }

    const exportedSymbols = db.prepare(`
      SELECT DISTINCT s.name FROM symbols s
      JOIN cluster_files cf ON cf.file_id = s.file_id
      WHERE cf.cluster_id = ? AND s.is_exported = 1
      LIMIT 20
    `).all(cluster.id).map(r => r.name);

    return {
      cluster_id: cluster.id,
      file_count: cluster.file_count,
      files: clusterFiles.slice(0, 10).map(f => f.path),
      hotspot_scores: hotspots,
      exported_symbols: exportedSymbols,
      external_dependencies: JSON.parse(cluster.external_deps_json).slice(0, 15),
    };
  });

  return {
    repo_summary: {
      total_files: files.length,
      languages: langCounts,
      parse_failed: parseFailed,
      cluster_count: clusters.length,
    },
    module_clusters: moduleClusters,
    cross_cluster_edges: graphData.crossClusterEdges,
    top_hotspots: graphData.topHotspots,
    diagrams: {
      arch_mmd: diagrams.archMmd,
    },
  };
}

const SYSTEM_PROMPT = `You are an expert software architect analysing a codebase.
You will receive structured static analysis data — NOT raw source code.
Your job is to produce an architectural hypothesis: identify the architecture style, name logical layers, and surface concerns.

Respond ONLY with valid JSON matching this schema exactly:
{
  "architecture_style": string,  // e.g. "layered monolith", "microservices", "plugin-based", "event-driven", "hexagonal", "MVC", "CQRS"
  "confidence": number,          // 0.0 to 1.0
  "reasoning": string,           // 2-4 sentences explaining your interpretation
  "layers": [
    {
      "name": string,            // human-readable layer name
      "cluster_ids": string[],   // which clusters belong to this layer
      "responsibility": string,  // one sentence
      "key_files": string[],     // up to 3 most important files
      "interfaces_with": string[] // other layer names this layer depends on
    }
  ],
  "entry_points": string[],      // files that appear to be application entry points
  "concerns": string[]           // architectural smells, unclear boundaries, etc.
}`;

export async function generateHypothesis(db, runId, graphData, diagrams, model, runDir) {
  const client = new Anthropic();

  const summary = buildAnalysisSummary(db, graphData, diagrams);

  // Write the payload for audit
  const { writeAnalysisPayload } = await import('./state.js');
  writeAnalysisPayload(runDir, summary);

  const userMessage = `Here is the static analysis of the repository:\n\n${JSON.stringify(summary, null, 2)}`;

  let rawText;
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    rawText = response.content[0].text;
  } catch (err) {
    throw new Error(`Claude API call failed: ${err.message}`);
  }

  // Extract JSON from response (handle markdown code blocks)
  let jsonText = rawText.trim();
  const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (jsonMatch) jsonText = jsonMatch[1];

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Retry once with explicit instruction
    try {
      const retry = await client.messages.create({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT + '\n\nCRITICAL: Return ONLY raw JSON. No markdown, no code blocks, no explanation.',
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: rawText },
          { role: 'user', content: 'Your response was not valid JSON. Please return only the raw JSON object.' },
        ],
      });
      jsonText = retry.content[0].text.trim();
      parsed = JSON.parse(jsonText);
    } catch (retryErr) {
      throw new Error(`Claude returned invalid JSON after retry: ${retryErr.message}`);
    }
  }

  const validated = HypothesisSchema.parse(parsed);

  const id = insertHypothesis(db, {
    run_id: runId,
    raw_response_json: JSON.stringify(validated),
    status: 'pending_validation',
  });

  return { id, ...validated };
}
