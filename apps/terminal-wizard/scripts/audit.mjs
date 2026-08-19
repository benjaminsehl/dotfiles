import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const CLEAN_LIFECYCLE_POLICY_TEXT =
  "No packages with unreviewed install scripts.";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertCleanLifecyclePolicy(output) {
  const normalized = output.trim();
  if (normalized === CLEAN_LIFECYCLE_POLICY_TEXT) return;

  let report;
  try {
    report = JSON.parse(normalized);
  } catch {
    throw new Error("npm lifecycle policy check returned an unrecognized report");
  }

  if (
    !isRecord(report)
    || Object.keys(report).length !== 1
    || !Array.isArray(report.allowScripts)
    || report.allowScripts.length !== 0
  ) {
    throw new Error(
      "Every dependency lifecycle script must be explicitly approved or denied in package.json",
    );
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function runAudit() {
  const projectRoot = new URL("../", import.meta.url);
  const lifecyclePolicy = spawnSync(
    "npm",
    ["approve-scripts", "--allow-scripts-pending", "--json"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );

  if (lifecyclePolicy.error) {
    fail(`npm lifecycle policy check could not start: ${lifecyclePolicy.error.message}`);
  }
  if (lifecyclePolicy.signal || lifecyclePolicy.status !== 0) {
    fail(
      lifecyclePolicy.stderr.trim()
        || `npm lifecycle policy check failed with ${lifecyclePolicy.signal ?? lifecyclePolicy.status}`,
    );
  }
  try {
    assertCleanLifecyclePolicy(lifecyclePolicy.stdout);
  } catch (error) {
    fail(error instanceof Error ? error.message : "npm lifecycle policy check failed");
  }

  const result = spawnSync("npm", ["audit", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) fail(`npm audit could not start: ${result.error.message}`);
  if (result.signal) fail(`npm audit was terminated by ${result.signal}`);
  if (result.status !== 0 && result.status !== 1) {
    fail(result.stderr.trim() || `npm audit exited with unexpected status ${result.status}`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    fail(result.stderr.trim() || result.stdout.trim() || "npm audit did not return JSON");
  }

  if (!isRecord(report)) fail("npm audit returned a malformed report");
  if (Object.hasOwn(report, "error")) {
    fail(`npm audit returned an error report: ${JSON.stringify(report.error)}`);
  }
  if (!isRecord(report.vulnerabilities)) {
    fail("npm audit report is missing a valid vulnerabilities object");
  }
  if (!isRecord(report.metadata) || !isRecord(report.metadata.vulnerabilities)) {
    fail("npm audit report is missing valid vulnerability metadata");
  }

  const severityNames = ["info", "low", "moderate", "high", "critical"];
  const counts = report.metadata.vulnerabilities;
  for (const name of [...severityNames, "total"]) {
    if (!Number.isSafeInteger(counts[name]) || counts[name] < 0) {
      fail(`npm audit report has an invalid ${name} vulnerability count`);
    }
  }
  if (severityNames.reduce((total, name) => total + counts[name], 0) !== counts.total) {
    fail("npm audit vulnerability counts do not add up to the reported total");
  }

  const vulnerabilities = Object.entries(report.vulnerabilities);
  if (vulnerabilities.length !== counts.total) {
    fail("npm audit vulnerability entries do not match the reported total");
  }
  if (vulnerabilities.length > 0) {
    fail(`Unexpected npm advisories: ${vulnerabilities.map(([name]) => name).join(", ")}`);
  }

  console.log("Full dependency audit is clean.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAudit();
}
