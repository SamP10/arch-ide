#!/usr/bin/env node
import { program } from 'commander';
import path from 'path';
import fs from 'fs';
import { runIngestion } from '../src/ingestion/index.js';

program
  .name('arch-ingest')
  .description('Analyse a repository and generate an architectural hypothesis')
  .argument('<target>', 'Path to the repository to ingest')
  .option('--skip-improvement', 'Skip the repo improvement stage (comment injection, grep tags, CLAUDE.md)')
  .option('--dry-run', 'Run all analysis and show improvement preview without writing changes')
  .option('--model <model-id>', 'Override the LLM model', 'claude-opus-4-6')
  .option('--resume <run-id>', 'Resume a previous run from the last completed stage')
  .action(async (target, options) => {
    const targetPath = path.resolve(target);

    if (!fs.existsSync(targetPath)) {
      console.error(`Error: target path does not exist: ${targetPath}`);
      process.exit(1);
    }

    if (!fs.statSync(targetPath).isDirectory()) {
      console.error(`Error: target must be a directory: ${targetPath}`);
      process.exit(1);
    }

    try {
      await runIngestion(targetPath, options);
    } catch (err) {
      console.error(`\nFatal error: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

program.parse();
