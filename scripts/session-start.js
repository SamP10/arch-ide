#!/usr/bin/env node
import { program } from 'commander';
import path from 'path';
import fs from 'fs';
import { runSessionStart } from '../src/session/index.js';

program
  .name('arch-session')
  .description('Surface architecture-level changes since the last ingestion run')
  .argument('<target>', 'Path to the repository to analyse')
  .option('--json', 'Output raw JSON instead of human-readable report')
  .option('--debug', 'Show stack traces on error')
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
      const report = await runSessionStart(targetPath, { silent: options.json });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      }
    } catch (err) {
      console.error(`\nFatal error: ${err.message}`);
      if (options.debug) console.error(err.stack);
      process.exit(1);
    }
  });

program.parse();
