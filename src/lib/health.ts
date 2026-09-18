export type HealthCheck = () => Promise<unknown>;
export type HealthReport = { status: 'ok' | 'degraded'; checks: Record<string, 'ok' | 'fail'> };

const TIMEOUT_MS = 2000;

const withTimeout = (check: HealthCheck) =>
  Promise.race([
    check(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
  ]);

/** Runs every check in parallel; a slow dependency counts as failed. Details stay in the logs. */
export async function runHealthChecks(checks: Record<string, HealthCheck>): Promise<HealthReport> {
  const names = Object.keys(checks);
  const results = await Promise.allSettled(names.map((name) => withTimeout(checks[name]!)));

  const report: HealthReport = { status: 'ok', checks: {} };
  results.forEach((result, index) => {
    const name = names[index]!;
    report.checks[name] = result.status === 'fulfilled' ? 'ok' : 'fail';
    if (result.status === 'rejected') {
      report.status = 'degraded';
      console.error(`[health] ${name} failed:`, result.reason);
    }
  });
  return report;
}
