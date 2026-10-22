// Runs on `git commit` through .husky/pre-commit. This package commits its build
// output, so the checks here guard the two invariants the repository relies on:
// lib/ never drifts from src/index.js, and the published docs never drift from
// the manifest.
//
// Every task is wrapped in a function so lint-staged does not append the staged
// file names to the command line: both checks always run over the whole tree.

export default {
  // src/index.js is the only hand-written source; lib/ is generated from it.
  // `check:dist` rebuilds in memory and fails when the committed copy is stale.
  // That also catches a version bump, because the banner embeds pkg.version.
  'src/**/*.js': () => 'npm run check:dist',
  'scripts/**/*.mjs': () => 'npm run check:dist',

  // llms.txt, the portable skill and the package fields that point at them are
  // one contract; this test fails when a change updates one side only.
  '{package.json,README.md,zh.md,llms.txt,skills/**/*.md}': () =>
    'node --test test/agent-metadata.test.mjs',
};
