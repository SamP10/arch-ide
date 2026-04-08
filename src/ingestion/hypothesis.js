import inquirer from 'inquirer';
import chalk from 'chalk';
import { updateHypothesis } from './db.js';

function displayHypothesis(hypothesis) {
  console.log('\n' + chalk.bold('═'.repeat(60)));
  console.log(chalk.bold.cyan('  ARCHITECTURAL HYPOTHESIS'));
  console.log(chalk.bold('═'.repeat(60)));
  console.log();
  console.log(`  ${chalk.bold('Style:')}       ${hypothesis.architecture_style}`);
  console.log(`  ${chalk.bold('Confidence:')}  ${Math.round(hypothesis.confidence * 100)}%`);
  console.log();
  console.log(`  ${chalk.bold('Reasoning:')}`);
  console.log(`  ${hypothesis.reasoning}`);
  console.log();
  console.log(chalk.bold('  Layers:'));

  for (let i = 0; i < hypothesis.layers.length; i++) {
    const layer = hypothesis.layers[i];
    console.log();
    console.log(`  ${chalk.yellow(`[${i + 1}]`)} ${chalk.bold(layer.name)} ${chalk.dim(`(${layer.cluster_ids.join(', ')})`)} `);
    console.log(`      ${chalk.dim('Responsibility:')} ${layer.responsibility}`);
    if (layer.key_files?.length) {
      console.log(`      ${chalk.dim('Key files:')} ${layer.key_files.join(', ')}`);
    }
    if (layer.interfaces_with?.length) {
      console.log(`      ${chalk.dim('Interfaces with:')} ${layer.interfaces_with.join(', ')}`);
    }
  }

  if (hypothesis.entry_points?.length) {
    console.log();
    console.log(`  ${chalk.bold('Entry points:')} ${hypothesis.entry_points.join(', ')}`);
  }

  if (hypothesis.concerns?.length) {
    console.log();
    console.log(`  ${chalk.bold('Concerns:')}`);
    for (const c of hypothesis.concerns) {
      console.log(`    ${chalk.yellow('⚠')}  ${c}`);
    }
  }

  console.log();
  console.log(chalk.bold('═'.repeat(60)));
  console.log();
}

async function correctionLoop(hypothesis) {
  let h = JSON.parse(JSON.stringify(hypothesis)); // deep clone
  const corrections = [];

  while (true) {
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to correct?',
      choices: [
        { name: 'Rename a layer', value: 'rename' },
        { name: 'Set layer responsibility', value: 'responsibility' },
        { name: 'Re-assign clusters to a different layer', value: 'reassign_cluster' },
        { name: 'Add a missing layer', value: 'add_layer' },
        { name: 'Remove a layer', value: 'remove_layer' },
        { name: 'Change architecture style', value: 'arch_style' },
        { name: 'Edit entry points', value: 'entry_points' },
        new inquirer.Separator(),
        { name: chalk.green('Done correcting'), value: 'done' },
      ],
    }]);

    if (action === 'done') break;

    if (action === 'rename') {
      const { layerIdx } = await inquirer.prompt([{
        type: 'list',
        name: 'layerIdx',
        message: 'Which layer?',
        choices: h.layers.map((l, i) => ({ name: l.name, value: i })),
      }]);
      const { newName } = await inquirer.prompt([{
        type: 'input',
        name: 'newName',
        message: 'New name:',
        default: h.layers[layerIdx].name,
      }]);
      corrections.push({ type: 'rename_layer', old_name: h.layers[layerIdx].name, new_name: newName, cluster_ids: h.layers[layerIdx].cluster_ids });
      h.layers[layerIdx].name = newName;

    } else if (action === 'responsibility') {
      const { layerIdx } = await inquirer.prompt([{
        type: 'list',
        name: 'layerIdx',
        message: 'Which layer?',
        choices: h.layers.map((l, i) => ({ name: l.name, value: i })),
      }]);
      const { resp } = await inquirer.prompt([{
        type: 'input',
        name: 'resp',
        message: 'Responsibility:',
        default: h.layers[layerIdx].responsibility,
      }]);
      corrections.push({ type: 'set_responsibility', layer_name: h.layers[layerIdx].name, responsibility: resp });
      h.layers[layerIdx].responsibility = resp;

    } else if (action === 'reassign_cluster') {
      const { clusterId } = await inquirer.prompt([{
        type: 'input',
        name: 'clusterId',
        message: 'Cluster ID to reassign (e.g. C3):',
      }]);
      const { targetLayerIdx } = await inquirer.prompt([{
        type: 'list',
        name: 'targetLayerIdx',
        message: 'Move to which layer?',
        choices: h.layers.map((l, i) => ({ name: l.name, value: i })),
      }]);
      corrections.push({ type: 'reassign_cluster', cluster_id: clusterId, to_layer: h.layers[targetLayerIdx].name });
      // Remove from existing layer
      for (const layer of h.layers) {
        layer.cluster_ids = layer.cluster_ids.filter(c => c !== clusterId);
      }
      h.layers[targetLayerIdx].cluster_ids.push(clusterId);

    } else if (action === 'add_layer') {
      const { name, responsibility } = await inquirer.prompt([
        { type: 'input', name: 'name', message: 'Layer name:' },
        { type: 'input', name: 'responsibility', message: 'Responsibility:' },
      ]);
      corrections.push({ type: 'add_layer', name, responsibility });
      h.layers.push({ name, cluster_ids: [], responsibility, key_files: [], interfaces_with: [] });

    } else if (action === 'remove_layer') {
      const { layerIdx } = await inquirer.prompt([{
        type: 'list',
        name: 'layerIdx',
        message: 'Which layer to remove?',
        choices: h.layers.map((l, i) => ({ name: l.name, value: i })),
      }]);
      corrections.push({ type: 'remove_layer', name: h.layers[layerIdx].name });
      h.layers.splice(layerIdx, 1);

    } else if (action === 'arch_style') {
      const { style } = await inquirer.prompt([{
        type: 'input',
        name: 'style',
        message: 'Architecture style:',
        default: h.architecture_style,
      }]);
      corrections.push({ type: 'set_arch_style', style });
      h.architecture_style = style;

    } else if (action === 'entry_points') {
      const { eps } = await inquirer.prompt([{
        type: 'input',
        name: 'eps',
        message: 'Entry points (comma-separated):',
        default: h.entry_points.join(', '),
      }]);
      h.entry_points = eps.split(',').map(s => s.trim()).filter(Boolean);
      corrections.push({ type: 'set_entry_points', entry_points: h.entry_points });
    }

    console.log();
    displayHypothesis(h);
  }

  return { corrected: h, corrections };
}

export async function validateHypothesis(db, hypothesisId, hypothesis) {
  displayHypothesis(hypothesis);

  const { choice } = await inquirer.prompt([{
    type: 'list',
    name: 'choice',
    message: 'Does this architectural hypothesis look correct?',
    choices: [
      { name: chalk.green('Yes — commit as source of truth'), value: 'accept' },
      { name: 'No — I want to correct it', value: 'correct' },
      { name: chalk.dim('Skip — save as draft, decide later'), value: 'skip' },
    ],
  }]);

  if (choice === 'skip') {
    updateHypothesis(db, hypothesisId, { status: 'skipped' });
    console.log(chalk.dim('\nHypothesis saved as draft. Re-run with --resume to validate later.\n'));
    return { status: 'skipped', hypothesis };
  }

  let finalHypothesis = hypothesis;
  let corrections = [];

  if (choice === 'correct') {
    const result = await correctionLoop(hypothesis);
    finalHypothesis = result.corrected;
    corrections = result.corrections;

    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Commit this corrected hypothesis as source of truth?',
      default: true,
    }]);

    if (!confirm) {
      updateHypothesis(db, hypothesisId, { status: 'skipped' });
      console.log(chalk.dim('\nHypothesis saved as draft.\n'));
      return { status: 'skipped', hypothesis: finalHypothesis };
    }
  }

  updateHypothesis(db, hypothesisId, {
    status: 'validated',
    validated_json: JSON.stringify(finalHypothesis),
    corrections_json: JSON.stringify(corrections),
    corrected_at: corrections.length > 0 ? new Date().toISOString() : null,
  });

  console.log(chalk.green('\n✓ Hypothesis committed as source of truth.\n'));
  return { status: 'validated', hypothesis: finalHypothesis, corrections };
}
