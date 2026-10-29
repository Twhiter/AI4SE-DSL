// Checks a .easy file: first the specifications on their own, then, only if they are consistent, each scenario,
// simplifies each Given that holds, and checks scenarios with the same When against each other.
// Usage (from packages/language): npx tsc -b tsconfig.src.json && node scripts/check.mjs ../../examples/sample.easy

import { readFileSync } from 'node:fs';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import { init, killThreads } from 'z3-solver';
import { buildModel, checkConsistency, checkCrossScenarios, checkScenarios, createEasyServices, simplifyGiven } from '../out/index.js';

const parse = parseHelper(createEasyServices(EmptyFileSystem).Easy);
const { model, errors } = buildModel(await parse(readFileSync(process.argv[2], 'utf8'), { validation: true }));
if (errors) {
    errors.forEach(error => console.log(`line ${error.range.start.line + 1}: ${error.message}`));
    process.exit(1);
}
const api = await init();
const z3 = new api.Context('main');

const show = ({ result, conflict }) => result + conflict.map(title => `\n      - ${title}`).join('');

// 1. The specifications
console.log('Specifications');
const specifications = await checkConsistency(z3, model);
specifications.forEach(result => console.log(`  ${result.specification.padEnd(25)} ${show(result)}`));

// 2. The scenarios, only on consistent specifications; 3. the simplified Given, only where the Given holds
if (specifications.some(({ result }) => result !== 'sat')) {
    console.log('\nThe specifications are inconsistent, so the scenarios are not checked.');
} else {
    const results = await checkScenarios(z3, model);
    for (const [i, { scenario, given, then }] of results.entries()) {
        console.log(`\nScenario: ${scenario}\n  Given  ${show(given)}\n  Then   ${show(then)}`);
        if (given.result === 'sat') {
            const simplified = await simplifyGiven(z3, model, model.scenarios[i]);
            simplified.steps.forEach(({ term, step, into }) => console.log(`    ${step.padEnd(10)} ${term}${into ? ` -> ${into.join(', ')}` : ''}`));
            simplified.cycles.forEach(({ terms }) => console.log(`  Cycle: ${terms.join(' → ')}`));
            console.log(`  Simplified Given: ${simplified.titles.join(' AND ') || '(nothing new)'}`);
        }
    }
    // 4. Scenarios with the same When, where one Given implies the other
    const pairs = await checkCrossScenarios(z3, model);
    console.log(pairs.length === 0 ? '\nNo Given implies another with the same When.' : '\nCross-scenario');
    pairs.forEach(({ scenario, other, equivalent, then }) =>
        console.log(`  ${scenario} ${equivalent ? '<=>' : '=>'} ${other}: Thens ${show(then)}`));
}

await killThreads(api.em);
process.exit(0);
