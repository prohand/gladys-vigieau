// -----------------------------------------------------------------------------
// Capture what the SDK logger writes, at debug level.
//
// The logger re-reads LOG_LEVEL on every call and writes through console.log /
// console.error, so pinning the variable and swapping the two is enough to see
// every line a piece of code produces — which is how the tests check that a
// watched point or an address never reaches the container logs.
// -----------------------------------------------------------------------------

/**
 * Run `task` with every log line captured, and hand them back.
 * @param {() => Promise<unknown>} task
 * @returns {Promise<string[]>}
 */
export async function captureLogs(task) {
  const lines = [];
  const realLog = console.log;
  const realError = console.error;
  const realLevel = process.env.LOG_LEVEL;
  const record = (...args) =>
    lines.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '));
  console.log = record;
  console.error = record;
  process.env.LOG_LEVEL = 'debug';
  try {
    await task();
  } finally {
    console.log = realLog;
    console.error = realError;
    if (realLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = realLevel;
    }
  }
  return lines;
}
