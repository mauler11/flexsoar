'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const repositoryRoot = path.resolve(__dirname, '../..');
const requireFromRepo = Module.createRequire(path.join(repositoryRoot, 'package.json'));
const ts = requireFromRepo('typescript');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request, parent, isMain, options) {
  let candidate = request;
  if (candidate.startsWith('@/')) candidate = path.join(repositoryRoot, candidate.slice(2));
  if (candidate.startsWith(repositoryRoot) && !path.extname(candidate)) {
    if (fs.existsSync(candidate + '.ts')) candidate += '.ts';
    else if (fs.existsSync(path.join(candidate, 'index.ts'))) candidate = path.join(candidate, 'index.ts');
  }
  return originalResolve.call(this, candidate, parent, isMain, options);
};

require.extensions['.ts'] = (loaded, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  loaded._compile(result.outputText, filename);
};

const worker = require(path.join(__dirname, 'worker.ts'));
worker.runSignerWorker().catch(error => {
  process.stderr.write((error instanceof Error ? error.message : 'SIGNER_STARTUP_FAILED') + '\n');
  process.exitCode = 1;
});
