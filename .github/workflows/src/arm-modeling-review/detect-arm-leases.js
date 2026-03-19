import { Temporal } from "@js-temporal/polyfill";
import { readFile } from "fs/promises";
import yaml from "js-yaml";
import { resolve } from "path";
import { simpleGit } from "simple-git";
import * as z from "zod";
import { getRootFolder } from "../../../shared/src/simple-git.js";

/**
 * Schema for lease.yaml file
 *
 * Example:
 * ```yaml
 * lease:
 *   startdate: "2024-01-01"
 *   duration: "P180D"
 * ```
 */
const leaseSchema = z.object({
  lease: z.object({
    startdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startdate must be in YYYY-MM-DD format"),
    duration: z.string().refine((v) => {
      try {
        Temporal.Duration.from(v);
        return true;
      } catch {
        return false;
      }
    }, "duration must be a valid ISO 8601 duration (e.g. P180D, P6M, P1Y2M3D)"),
  }),
});

/**
 * Build the lease path based on service information.
 *
 * Lease files are stored at:
 * - Without service name: `.github/arm-leases/<orgName>/<rpNamespace>/lease.yaml`
 * - With service name:    `.github/arm-leases/<orgName>/<rpNamespace>/<serviceName>/lease.yaml`
 *
 * @param {string} orgName - Organization name (e.g., "compute")
 * @param {string} rpNamespace - Resource provider namespace (e.g., "Microsoft.Compute")
 * @param {string} serviceName - Optional service name for RPs with sub-groupings (e.g., "ComputeRP")
 * @returns {string} Relative path to lease.yaml file (e.g., ".github/arm-leases/compute/Microsoft.Compute/lease.yaml")
 */
function buildLeaseRelativePath(orgName, rpNamespace, serviceName = "") {
  const parts = [".github", "arm-leases", orgName, rpNamespace];
  if (serviceName) {
    parts.push(serviceName);
  }
  parts.push("lease.yaml");
  return parts.join("/");
}

/**
 * Build the full lease path based on service information.
 *
 * Lease files are stored at:
 * - Without service name: `.github/arm-leases/<orgName>/<rpNamespace>/lease.yaml`
 * - With service name:    `.github/arm-leases/<orgName>/<rpNamespace>/<serviceName>/lease.yaml`
 *
 * @param {string} repoRoot - Repository root path
 * @param {string} orgName - Organization name (e.g., "compute")
 * @param {string} rpNamespace - Resource provider namespace (e.g., "Microsoft.Compute")
 * @param {string} serviceName - Optional service name for RPs with sub-groupings (e.g., "ComputeRP")
 * @returns {string} Full path to lease.yaml file
 */
function buildLeasePath(repoRoot, orgName, rpNamespace, serviceName = "") {
  return resolve(repoRoot, buildLeaseRelativePath(orgName, rpNamespace, serviceName));
}

/**
 * Parse and validate lease YAML content. Pure function — no I/O.
 *
 * @param {string} content - Raw YAML string from a lease file
 * @returns {{ valid: boolean, reason: string }} Whether the lease is valid and why
 */
export function parseLease(content) {
  let rawParsed;
  try {
    rawParsed = /** @type {any} */ (yaml.load(content, { schema: yaml.FAILSAFE_SCHEMA }));
  } catch {
    return { valid: false, reason: "YAML parse error" };
  }

  if (!rawParsed) {
    return { valid: false, reason: "Empty YAML content" };
  }

  const result = leaseSchema.safeParse(rawParsed);
  if (!result.success) {
    return { valid: false, reason: result.error.issues.map((i) => i.message).join("; ") };
  }

  const lease = result.data.lease;
  const startDate = Temporal.PlainDate.from(lease.startdate);
  const duration = Temporal.Duration.from(lease.duration);
  const endDate = startDate.add(duration);
  const today = Temporal.Now.plainDateISO();

  if (Temporal.PlainDate.compare(today, endDate) > 0) {
    return { valid: false, reason: `Lease expired on ${endDate.toString()}` };
  }

  return { valid: true, reason: "Lease is valid" };
}

/**
 * Check if ARM lease exists and is valid.
 *
 * Looks for a lease file at the appropriate path (see buildLeasePath for path structure).
 * Falls back to reading from the base branch ref (origin/<GITHUB_BASE_REF>) if the file is
 * not found in the workspace. This handles the case where a labeled/unlabeled event causes
 * the workflow to check out the PR head instead of the merge commit, so lease files added
 * to the base branch (but not the PR branch) are still accessible.
 *
 * @param {string} orgName - Organization name (e.g., "compute")
 * @param {string} rpNamespace - Resource provider namespace (e.g., "Microsoft.Compute")
 * @param {string} serviceName - Optional service name for RPs with sub-groupings
 * @returns {Promise<boolean>} True if lease exists and is valid, false otherwise
 */
export async function checkLease(orgName, rpNamespace, serviceName = "") {
  const repoRoot = await getRootFolder(process.cwd());
  const leasePath = buildLeasePath(repoRoot, orgName, rpNamespace, serviceName);

  let content;
  try {
    content = await readFile(leasePath, "utf-8");
  } catch {
    // File not found in workspace — fall back to reading from the fetched base branch ref.
    // This handles labeled/unlabeled events where the checkout may be the PR head rather
    // than the merge commit, so lease files on the base branch aren't in the workspace.
    const baseRef = process.env.GITHUB_BASE_REF;
    if (!baseRef) {
      return false;
    }
    const relLeasePath = buildLeaseRelativePath(orgName, rpNamespace, serviceName);
    try {
      const git = simpleGit(repoRoot);
      content = await git.show([`origin/${baseRef}:${relLeasePath}`]);
    } catch {
      return false;
    }
  }

  return parseLease(content).valid;
}
