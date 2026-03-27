import { simpleGit } from "simple-git";
import { getChangedFiles, resourceManager, swagger } from "../../../shared/src/changed-files.js";
import { CoreLogger } from "../core-logger.js";
import { LabelAction } from "../label.js";
import { ArmLeaseValidationLabel } from "./arm-lease-validation-labels.js";
import { checkLease } from "./detect-arm-leases.js";
import { detectNewResourceTypes } from "./detect-new-resource-types.js";

const ARM_OFFICE_HOURS_URL =
  "https://outlook.office365.com/book/ARMOfficeHours1@microsoft.onmicrosoft.com/?ismsaljsauthenabled=true";

// Match pattern: specification/<orgName>/resource-manager/<RPNamespace>/...
// Trailing slash ensures the match is a directory component, not a file like readme.md
const RESOURCE_MANAGER_PATTERN = new RegExp(
  String.raw`^specification/[^/]+/resource-manager/([^/]+)/`,
);

// Match pattern with optional service name: specification/<orgName>/resource-manager/<RPNamespace>/<ServiceName>/...
// ServiceName folder name should not start with "stable" or "preview"
const RESOURCE_MANAGER_WITH_GROUP_PATTERN = new RegExp(
  String.raw`^specification/[^/]+/resource-manager/([^/]+)/(?!stable|preview)([^/]+)/`,
);

/**
 * The workflow contract is intentionally a fixed set of keys.
 * @typedef {{
 *   "ARMModelingReviewRequired": LabelAction,
 *   "ARMModelingSignedOff": LabelAction,
 *   "ARMModelingAutoSignedOff": LabelAction,
 * }} ManagedLabelActions
 */

/**
 * Check if a resource provider namespace existed in a specific git commit.
 * Uses git ls-tree to check the base commit, avoiding false positives from
 * RPs that were just added in the current PR.
 *
 * @param {import('simple-git').SimpleGit} git
 * @param {string} commitish - Git commit reference (e.g., merge base SHA)
 * @param {string} namespace - Resource provider namespace (e.g., Microsoft.App)
 * @param {import('@actions/github-script').AsyncFunctionArguments['core']} core
 * @returns {Promise<boolean>} True if namespace existed in the commit
 */
async function resourceProviderExistsInCommit(git, commitish, namespace, core) {
  /** @type {string} */
  let output;
  try {
    output = await git.raw(["ls-tree", "-d", "--name-only", "-r", commitish, "specification/"]);
  } catch (e) {
    if (e instanceof Error && e.message.includes("does not exist")) {
      core.info(`Commit "${commitish}" does not exist in git history`);
      return false;
    }
    throw e;
  }

  // Look for resource-manager/<namespace> pattern in any service directory
  const pattern = new RegExp(
    `^specification/[^/]+/resource-manager/${namespace.replace(".", "\\.")}$`,
    "m",
  );
  return pattern.test(output);
}

/**
 * @param {"none" | "review-required" | "auto-signed-off"} outcome
 * @returns {ManagedLabelActions}
 */
function getLabelActions(outcome) {
  if (outcome === "review-required") {
    return {
      [ArmLeaseValidationLabel.ArmModelingReviewRequired]: LabelAction.Add,
      [ArmLeaseValidationLabel.ArmModelingSignedOff]: LabelAction.Remove,
      [ArmLeaseValidationLabel.ArmModelingAutoSignedOff]: LabelAction.Remove,
    };
  }

  if (outcome === "auto-signed-off") {
    return {
      [ArmLeaseValidationLabel.ArmModelingReviewRequired]: LabelAction.Remove,
      [ArmLeaseValidationLabel.ArmModelingSignedOff]: LabelAction.Remove,
      [ArmLeaseValidationLabel.ArmModelingAutoSignedOff]: LabelAction.Add,
    };
  }

  // outcome === "none"
  return {
    [ArmLeaseValidationLabel.ArmModelingReviewRequired]: LabelAction.Remove,
    [ArmLeaseValidationLabel.ArmModelingSignedOff]: LabelAction.Remove,
    [ArmLeaseValidationLabel.ArmModelingAutoSignedOff]: LabelAction.Remove,
  };
}

/**
 * Extract resource provider namespaces, organization names, and optional service names from file paths.
 *
 * @param {string[]} files
 * @returns {Map<string, {orgName: string, serviceName?: string}>} Map of namespace to service info
 */
function extractResourceProviders(files) {
  /** @type {Map<string, {orgName: string, serviceName?: string}>} */
  const resourceProviders = new Map();

  for (const file of files) {
    const match = file.match(RESOURCE_MANAGER_PATTERN);
    if (match) {
      const orgName = file.split("/")[1];
      const namespace = match[1];

      const groupMatch = file.match(RESOURCE_MANAGER_WITH_GROUP_PATTERN);
      if (groupMatch) {
        resourceProviders.set(namespace, { orgName, serviceName: groupMatch[2] });
      } else {
        resourceProviders.set(namespace, { orgName });
      }
    }
  }

  return resourceProviders;
}

/**
 * Main detection logic for GitHub script action.
 *
 * Detects new ARM resource providers and resource types, validates ARM leases,
 * applies labels directly to the PR when the GitHub token has sufficient
 * permissions (e.g. for non-fork PRs), and also uploads label artifacts for
 * the update-labels workflow.
 *
 * @param {Object} params - Parameters from github-script
 * @param {import('@actions/github-script').AsyncFunctionArguments['github']} [params.github]
 * @param {import('@actions/github-script').AsyncFunctionArguments['context']} [params.context]
 * @param {import('@actions/github-script').AsyncFunctionArguments['core']} params.core
 * @returns {Promise<{ status: string, labelActions: ManagedLabelActions }>}
 */
export default async function armModelingReview({ github, context, core }) {
  const result = await detectLabelActions({ core });
  await applyLabelsToPR({ github, context, core, labelActions: result.labelActions });
  return result;
}

/**
 * Apply labels directly to the PR via the GitHub API.
 *
 * This is a best-effort approach: if the GITHUB_TOKEN lacks write access
 * (e.g., for fork PRs in the main repo), the API call will fail with a
 * permissions error and the function will log it and move on. Labels will
 * still be applied via the artifact-based update-labels workflow when it
 * is able to run.
 *
 * @param {Object} params
 * @param {import('@actions/github-script').AsyncFunctionArguments['github'] | undefined} params.github
 * @param {import('@actions/github-script').AsyncFunctionArguments['context'] | undefined} params.context
 * @param {import('@actions/github-script').AsyncFunctionArguments['core']} params.core
 * @param {ManagedLabelActions} params.labelActions
 */
export async function applyLabelsToPR({ github, context, core, labelActions }) {
  if (!github || !context?.payload?.pull_request) {
    return;
  }

  const { owner, repo } = context.repo;
  const issue_number = /** @type {number} */ (context.payload.pull_request.number);

  const labelsToAdd = /** @type {string[]} */ (
    Object.entries(labelActions)
      .filter(([, action]) => action === LabelAction.Add)
      .map(([label]) => label)
  );

  const labelsToRemove = /** @type {string[]} */ (
    Object.entries(labelActions)
      .filter(([, action]) => action === LabelAction.Remove)
      .map(([label]) => label)
  );

  if (labelsToAdd.length > 0) {
    try {
      await github.rest.issues.addLabels({ owner, repo, issue_number, labels: labelsToAdd });
      core.info(`Applied labels directly to PR: added [${labelsToAdd.join(", ")}]`);
    } catch (error) {
      core.info(
        `Could not add labels directly to PR (will be applied via update-labels workflow): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const name of labelsToRemove) {
    try {
      await github.rest.issues.removeLabel({ owner, repo, issue_number, name });
      core.info(`Applied labels directly to PR: removed "${name}"`);
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 404) {
        core.info(`Label "${name}" not present on PR, skipping removal`);
      } else {
        core.info(
          `Could not remove label "${name}" directly from PR (will be applied via update-labels workflow): ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

/**
 * Core detection logic: detects new ARM resource providers / resource types,
 * validates ARM leases, calls core.setFailed() when issues are found, and
 * returns the computed label actions.
 *
 * @param {Object} params
 * @param {import('@actions/github-script').AsyncFunctionArguments['core']} params.core
 * @returns {Promise<{ status: string, labelActions: ManagedLabelActions }>}
 */
async function detectLabelActions({ core }) {
  const options = {
    cwd: process.env.GITHUB_WORKSPACE,
    paths: ["specification"],
    logger: new CoreLogger(core),
  };

  const git = simpleGit(options.cwd);

  core.info("Detecting New Resource Providers");

  const changedFiles = await getChangedFiles(options);
  const rmFiles = changedFiles.filter(resourceManager);

  const changedResourceProviders = extractResourceProviders(rmFiles);

  // Pre-check: verify if any namespace directories are brand new (don't exist in base branch).
  // Extract unique namespace paths directly from the changed files using the regex pattern.
  const changedNamespacePaths = new Set(
    rmFiles
      .map((f) => {
        const match = f.match(RESOURCE_MANAGER_PATTERN);
        if (match) {
          // Extract path up to and including the namespace: specification/<orgName>/resource-manager/<namespace>
          // match[0] includes trailing slash, so strip it
          return f.substring(0, /** @type {number} */ (match.index) + match[0].length - 1);
        }
        return null;
      })
      .filter((p) => p !== null),
  );

  if (changedNamespacePaths.size > 0) {
    let hasAtLeastOneBrandNewRP = false;

    for (const namespacePath of changedNamespacePaths) {
      /** @type {string} */
      let specFilesBaseBranch;
      try {
        specFilesBaseBranch = await git.raw([
          "ls-tree",
          "-r",
          "--name-only",
          "HEAD^",
          namespacePath,
        ]);
      } catch (e) {
        if (e instanceof Error && e.message.includes("does not exist")) {
          core.info(`Path "${namespacePath}" does not exist in base branch`);
          hasAtLeastOneBrandNewRP = true;
          continue;
        }
        throw e;
      }

      const specRmSwaggerFilesBaseBranch = specFilesBaseBranch
        .split("\n")
        .filter((file) => resourceManager(file) && swagger(file));

      if (specRmSwaggerFilesBaseBranch.length === 0) {
        hasAtLeastOneBrandNewRP = true;
      }
    }

    if (!hasAtLeastOneBrandNewRP) {
      core.info("No brand new resource providers detected, spec directories exist in base branch.");
      core.info("Checking for new resource types in existing RPs...");
      return await checkNewResourceTypes(rmFiles, core);
    }
  }

  // Filter for new resource providers (not present in base branch)
  const newResourceProviders = [];

  for (const [rp, info] of changedResourceProviders) {
    const existsInBase = await resourceProviderExistsInCommit(git, "HEAD^", rp, core);
    if (!existsInBase) {
      newResourceProviders.push({
        namespace: rp,
        orgName: info.orgName,
        serviceName: info.serviceName,
      });
    }
  }

  if (newResourceProviders.length === 0) {
    core.info("No new resource providers detected.");
    core.info("Checking for new resource types in existing RPs...");
    return await checkNewResourceTypes(rmFiles, core);
  }

  core.info(`Detected ${newResourceProviders.length} new resource provider(s)`);

  /** @type {{ namespace: string, orgName: string, serviceName?: string, leaseValid: boolean, leaseMessage: string }[]} */
  const leaseCheckResults = [];

  for (const rp of newResourceProviders) {
    const leaseValid = await checkLease(rp.orgName, rp.namespace, rp.serviceName || "");

    leaseCheckResults.push({
      namespace: rp.namespace,
      orgName: rp.orgName,
      serviceName: rp.serviceName,
      leaseValid,
      leaseMessage: leaseValid ? "Lease is valid" : "No lease file found or lease has expired",
    });

    core.info(`  - ${rp.namespace}: ${leaseValid ? "Lease valid" : "Lease invalid"}`);
  }

  const invalidLeases = leaseCheckResults.filter((rp) => !rp.leaseValid);
  const allLeasesValid = invalidLeases.length === 0;

  if (!allLeasesValid) {
    for (const rp of invalidLeases) {
      core.error(`${rp.namespace}: ${rp.leaseMessage}`);
    }
    core.setFailed(
      `${invalidLeases.length} new resource provider(s) detected without a valid ARM lease. ` +
        `Please schedule a discussion at ARM API Modeling Office Hours before merging: ${ARM_OFFICE_HOURS_URL}`,
    );
  } else {
    core.info("New resource provider(s) detected with valid ARM lease — no action required.");
  }

  core.info("Checking for new resource types in existing RPs...");
  const newRtResult = await checkNewResourceTypes(rmFiles, core);

  // Merge label actions: 'add' wins over 'remove' wins over 'none'
  /** @type {ManagedLabelActions} */
  const combinedLabelActions = {
    ...getLabelActions(allLeasesValid ? "auto-signed-off" : "review-required"),
  };
  for (const [labelKey, action] of Object.entries(newRtResult.labelActions)) {
    /** @type {keyof ManagedLabelActions} */
    const label = /** @type {keyof ManagedLabelActions} */ (labelKey);
    const currentAction = combinedLabelActions[label];
    if (
      action === LabelAction.Add ||
      (action === LabelAction.Remove && currentAction === LabelAction.None)
    ) {
      combinedLabelActions[label] = action;
    }
  }

  return {
    status: allLeasesValid ? "new-rp-all-leases-valid" : "new-rp-invalid-lease",
    labelActions: combinedLabelActions,
  };
}

/**
 * Check for new resource types in existing RPs and validate their leases.
 *
 * @param {string[]} rmFiles - Resource-manager file paths changed in the PR
 * @param {import('@actions/github-script').AsyncFunctionArguments['core']} core
 * @returns {Promise<{ status: string, labelActions: ManagedLabelActions }>}
 */
async function checkNewResourceTypes(rmFiles, core) {
  const newRtResults = await detectNewResourceTypes({
    rmFiles,
    core,
  });

  if (newRtResults.length === 0) {
    core.info("No new resource types detected.");
    return {
      status: "no-new-rp",
      labelActions: getLabelActions("none"),
    };
  }

  core.info(`Detected new resource types in ${newRtResults.length} rpNamespace(s)`);

  let allLeasesValid = true;
  for (const ns of newRtResults) {
    const leaseValid = await checkLease(ns.orgName, ns.rpNamespace, ns.serviceName);

    if (leaseValid) {
      core.info(`  - ${ns.rpNamespace}: valid ARM lease for new resource types`);
    } else {
      allLeasesValid = false;
      core.error(`${ns.rpNamespace}: new resource types detected without a valid ARM lease`);
    }
  }

  if (!allLeasesValid) {
    core.setFailed(
      "New resource types detected without a valid ARM lease. " +
        `Please schedule a discussion at ARM API Modeling Office Hours before merging: ${ARM_OFFICE_HOURS_URL}`,
    );
  } else {
    core.info("New resource types detected with valid ARM lease — auto-signed-off.");
  }

  return {
    status: allLeasesValid ? "new-rt-all-leases-valid" : "new-rt-invalid-lease",
    labelActions: getLabelActions(allLeasesValid ? "auto-signed-off" : "review-required"),
  };
}
