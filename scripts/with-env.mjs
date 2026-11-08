import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import process from 'node:process';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
const args = process.argv.slice(2);
const direct = args[0] === '--exec';
if (direct) args.shift();
// npm_execpath evita executar npm.cmd por shell em Windows.
const npmCli = process.env.npm_execpath;
const command = direct ? args.shift() : (npmCli ? process.execPath : 'npm');
const childArgs = !direct && npmCli ? [npmCli, ...args] : args;
if (!command || (!direct && !args.length)) throw new Error('Informe o comando.');
const child = spawn(command, childArgs, { cwd: root, env: process.env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => {
  console.error('Não foi possível iniciar o comando. Confira Node.js 22 e os requisitos instalados.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
