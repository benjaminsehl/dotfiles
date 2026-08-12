import { spawnSync } from "node:child_process";

const lifecyclePolicy = spawnSync(
  "npm",
  ["approve-scripts", "--allow-scripts-pending", "--json"],
  {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  },
);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (lifecyclePolicy.error) {
  fail(`npm lifecycle policy check could not start: ${lifecyclePolicy.error.message}`);
}
if (lifecyclePolicy.signal || lifecyclePolicy.status !== 0) {
  fail(
    lifecyclePolicy.stderr
      || `npm lifecycle policy check failed with ${lifecyclePolicy.signal ?? lifecyclePolicy.status}`,
  );
}

let lifecycleReport;
try {
  lifecycleReport = JSON.parse(lifecyclePolicy.stdout);
} catch {
  fail(lifecyclePolicy.stderr || lifecyclePolicy.stdout || "npm lifecycle policy check did not return JSON");
}
if (
  typeof lifecycleReport !== "object"
  || lifecycleReport === null
  || !Array.isArray(lifecycleReport.allowScripts)
  || lifecycleReport.allowScripts.length > 0
) {
  fail("Every dependency lifecycle script must be explicitly approved or denied in package.json");
}

const result = spawnSync("npm", ["audit", "--json"], {
  cwd: new URL("../", import.meta.url),
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (result.error) fail(`npm audit could not start: ${result.error.message}`);
if (result.signal) fail(`npm audit was terminated by ${result.signal}`);
if (result.status !== 0 && result.status !== 1) {
  fail(result.stderr || `npm audit exited with unexpected status ${result.status}`);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  fail(result.stderr || result.stdout || "npm audit did not return JSON");
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

const allowedAdvisories = new Set(["GHSA-w3rx-r6r6-pgpr", "GHSA-5p2g-fcmc-qvqq"]);
const unexpected = vulnerabilities.filter(([name, vulnerability]) => {
  if (!isRecord(vulnerability) || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
    return true;
  }
  if (name === "vinext") {
    return vulnerability.via.some((entry) => entry !== "image-size");
  }
  if (name !== "image-size") return true;
  const advisoryIds = vulnerability.via.map((entry) => {
    if (!isRecord(entry) || typeof entry.url !== "string") return null;
    return entry.url.split("/").at(-1) ?? null;
  });
  return advisoryIds.some((id) => id === null || !allowedAdvisories.has(id));
});

if (unexpected.length > 0) {
  fail(`Unexpected npm advisories: ${unexpected.map(([name]) => name).join(", ")}`);
}

if (vulnerabilities.length === 0) {
  console.log("Full dependency audit is clean.");
} else {
  console.log(
    "Full dependency audit contains only the documented vinext image-size advisories; no optimizer is configured, and the app has no file-based metadata image routes or user-controlled build inputs.",
  );
}
