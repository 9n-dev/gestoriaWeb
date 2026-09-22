import { execSync, spawn } from 'node:child_process';
import { e2eEnv } from './database';

/** Demo data + a worker for the file pipeline. Returns the teardown. */
export default async function globalSetup() {
  execSync('npm run db:seed', { stdio: 'inherit', env: e2eEnv });

  const worker = spawn('npm', ['run', 'worker'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    detached: true,
    env: e2eEnv,
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker did not start')), 30_000);
    worker.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('[worker] ready')) {
        clearTimeout(timer);
        resolve();
      }
    });
    worker.on('exit', (code) => reject(new Error(`worker exited with ${code}`)));
  });

  return () => {
    // The whole process group: npm, tsx and node.
    if (worker.pid) process.kill(-worker.pid, 'SIGTERM');
  };
}
