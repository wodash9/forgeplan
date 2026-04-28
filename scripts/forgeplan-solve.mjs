#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = {
    strategy: 'mock',
    timeLimitSeconds: 30,
    pythonBinary: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strategy') {
      args.strategy = argv[++index];
    } else if (arg === '--time-limit') {
      args.timeLimitSeconds = Number(argv[++index]);
    } else if (arg === '--python') {
      args.pythonBinary = argv[++index];
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!args.plantPath) {
      args.plantPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return `Usage: node scripts/forgeplan-solve.mjs <plant.json> [--strategy mock|cp_sat] [--time-limit seconds] [--python python3]\n\nExamples:\n  node scripts/forgeplan-solve.mjs fixtures/minimal-valid-plant.json\n  node scripts/forgeplan-solve.mjs fixtures/minimal-valid-plant.json --strategy cp_sat --time-limit 5\n`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.plantPath) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }
  if (!['mock', 'cp_sat'].includes(args.strategy)) {
    throw new Error(`Unsupported strategy '${args.strategy}'. Use 'mock' or 'cp_sat'.`);
  }
  if (!Number.isFinite(args.timeLimitSeconds) || args.timeLimitSeconds <= 0) {
    throw new Error('--time-limit must be a positive number.');
  }

  const indexModule = await import(pathToFileURL(resolve('dist/src/index.js')));
  const nodeModule = await import(pathToFileURL(resolve('dist/src/solver/node.js')));
  const plantInput = JSON.parse(readFileSync(resolve(args.plantPath), 'utf8'));
  const plant = indexModule.plantSchema.parse(plantInput);
  const result = nodeModule.runLocalSolve(plant, {
    strategy: args.strategy,
    timeLimitSeconds: args.timeLimitSeconds,
    pythonBinary: args.pythonBinary,
  });

  if (result.status === 'error') {
    console.error(result.issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
    console.log(JSON.stringify(result.schedule, null, 2));
    process.exit(2);
  }

  console.log(JSON.stringify(result.schedule, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
