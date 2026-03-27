import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockContext,
  createMockCore,
  createMockGithub,
  createMockRequestError,
} from "../mocks.js";

/** @type {import("vitest").MockedFunction<import("simple-git").SimpleGit["raw"]>} */
const mockRaw = vi.hoisted(() => vi.fn().mockResolvedValue(""));

vi.mock("simple-git", () => ({
  simpleGit: vi.fn().mockReturnValue({ raw: mockRaw }),
}));

vi.mock("../../src/arm-modeling-review/detect-arm-leases.js", () => ({
  checkLease: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../src/arm-modeling-review/detect-new-resource-types.js", () => ({
  detectNewResourceTypes: vi.fn().mockResolvedValue([]),
}));

import * as changedFiles from "../../../shared/src/changed-files.js";
import armModelingReview, {
  applyLabelsToPR,
} from "../../src/arm-modeling-review/arm-modeling-review.js";
import { checkLease } from "../../src/arm-modeling-review/detect-arm-leases.js";
import { detectNewResourceTypes } from "../../src/arm-modeling-review/detect-new-resource-types.js";
const core = createMockCore();

/** Helper to build a minimal pull_request context for testing direct label application */
function createPRContext(prNumber = 42) {
  const context = createMockContext();
  context.payload = { pull_request: { number: prNumber } };
  return context;
}

describe("armModelingReview", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_WORKSPACE;
  });

  it("returns no-new-rp when all RP namespaces exist in base branch", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const rmFile =
      "specification/compute/resource-manager/Microsoft.Compute/stable/2024-01-01/compute.json";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([rmFile]);

    // Pre-check: file exists in base → not brand new
    vi.mocked(mockRaw).mockResolvedValue(rmFile);

    const result = await armModelingReview({ core });

    expect(result.status).toBe("no-new-rp");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("remove");
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("returns new-rp-all-leases-valid when new RP has valid lease", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const rmFile =
      "specification/newservice/resource-manager/Microsoft.NewService/stable/2025-01-01/api.json";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([rmFile]);

    // Pre-check: no files in base → brand new; namespace doesn't exist in base directories
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(true);

    const result = await armModelingReview({ core });

    expect(result.status).toBe("new-rp-all-leases-valid");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("remove");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("add");
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining("valid ARM lease"));
    expect(checkLease).toHaveBeenCalledWith("newservice", "Microsoft.NewService", "");
  });

  it("returns new-rp-invalid-lease and calls setFailed when lease is invalid", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const rmFile =
      "specification/badservice/resource-manager/Microsoft.BadService/preview/2025-01-01/api.json";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([rmFile]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(false);

    const result = await armModelingReview({ core });

    expect(result.status).toBe("new-rp-invalid-lease");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("add");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("remove");
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("ARM API Modeling Office Hours"),
    );
    expect(core.error).toHaveBeenCalledWith(expect.stringContaining("Microsoft.BadService"));
  });

  it("fails when at least one of multiple new RPs has invalid lease", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svcA/resource-manager/Microsoft.SvcA/stable/2025-01-01/a.json",
      "specification/svcB/resource-manager/Microsoft.SvcB/stable/2025-01-01/b.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");

    // SvcA valid, SvcB invalid
    vi.mocked(checkLease).mockImplementation((orgName) => Promise.resolve(orgName === "svcA"));

    const result = await armModelingReview({ core });

    expect(result.status).toBe("new-rp-invalid-lease");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("add");
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("without a valid ARM lease"),
    );
  });

  it("passes when all multiple new RPs have valid leases", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svcA/resource-manager/Microsoft.SvcA/stable/2025-01-01/a.json",
      "specification/svcB/resource-manager/Microsoft.SvcB/stable/2025-01-01/b.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(true);

    const result = await armModelingReview({ core });

    expect(result.status).toBe("new-rp-all-leases-valid");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("remove");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("add");
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("passes serviceName to checkLease when present", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const rmFile =
      "specification/svc/resource-manager/Microsoft.Svc/ComputeRP/stable/2025-01-01/api.json";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([rmFile]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(true);

    await armModelingReview({ core });

    expect(checkLease).toHaveBeenCalledWith("svc", "Microsoft.Svc", "ComputeRP");
  });

  it("returns Remove for ARMModelingReviewRequired when no new RPs", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const rmFile =
      "specification/compute/resource-manager/Microsoft.Compute/stable/2024-01-01/compute.json";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([rmFile]);
    vi.mocked(mockRaw).mockResolvedValue(rmFile);

    const result = await armModelingReview({ core });

    expect(result.labelActions.ARMModelingReviewRequired).toBe("remove");
    expect(result.labelActions.ARMModelingSignedOff).toBe("remove");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("remove");
  });

  it("returns Add for ARMModelingReviewRequired when new RP has invalid lease", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(false);

    const result = await armModelingReview({ core });

    expect(result.labelActions.ARMModelingReviewRequired).toBe("add");
    expect(result.labelActions.ARMModelingSignedOff).toBe("remove");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("remove");
  });

  it("returns Remove for ARMModelingReviewRequired when new RP has valid lease", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(true);

    const result = await armModelingReview({ core });

    expect(result.labelActions.ARMModelingReviewRequired).toBe("remove");
    expect(result.labelActions.ARMModelingSignedOff).toBe("remove");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("add");
  });

  // ── New resource type detection (no new RP) ──────────────────────────

  it("checks for new resource types when no new RP is detected", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const rmFile =
      "specification/compute/resource-manager/Microsoft.Compute/stable/2024-01-01/compute.json";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([rmFile]);
    vi.mocked(mockRaw).mockResolvedValue(rmFile);

    // detectNewResourceTypes returns new RT
    vi.mocked(detectNewResourceTypes).mockResolvedValue([
      {
        rpNamespace: "Microsoft.Compute",
        orgName: "compute",
        serviceName: "",
        newResourceTypes: [
          {
            resourceType: "Microsoft.Compute/disks",
            provider: "Microsoft.Compute",
            modelName: null,
            operations: ["GET"],
          },
        ],
      },
    ]);
    vi.mocked(checkLease).mockResolvedValue(true);

    const result = await armModelingReview({ core });

    expect(result.status).toBe("new-rt-all-leases-valid");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("add");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("remove");
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("adds ARMModelingReviewRequired when new RT has no valid lease", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const rmFile =
      "specification/compute/resource-manager/Microsoft.Compute/stable/2024-01-01/compute.json";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([rmFile]);
    vi.mocked(mockRaw).mockResolvedValue(rmFile);

    vi.mocked(detectNewResourceTypes).mockResolvedValue([
      {
        rpNamespace: "Microsoft.Compute",
        orgName: "compute",
        serviceName: "",
        newResourceTypes: [
          {
            resourceType: "Microsoft.Compute/disks",
            provider: "Microsoft.Compute",
            modelName: null,
            operations: ["GET"],
          },
        ],
      },
    ]);
    vi.mocked(checkLease).mockResolvedValue(false);

    const result = await armModelingReview({ core });

    expect(result.status).toBe("new-rt-invalid-lease");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("add");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("remove");
    expect(core.setFailed).toHaveBeenCalled();
  });

  it("returns no-new-rp when no new RTs detected either", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const rmFile =
      "specification/compute/resource-manager/Microsoft.Compute/stable/2024-01-01/compute.json";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([rmFile]);
    vi.mocked(mockRaw).mockResolvedValue(rmFile);
    vi.mocked(detectNewResourceTypes).mockResolvedValue([]);

    const result = await armModelingReview({ core });

    expect(result.status).toBe("no-new-rp");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("remove");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("remove");
  });

  // ── Direct label application ─────────────────────────────────────────

  it("applies ARMModelingReviewRequired label directly to PR when lease is invalid", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const github = createMockGithub();
    const context = createPRContext(99);

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(false);

    await armModelingReview({ github, context, core });

    expect(github.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 99,
      labels: ["ARMModelingReviewRequired"],
    });
    expect(github.rest.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ARMModelingSignedOff" }),
    );
    expect(github.rest.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ARMModelingAutoSignedOff" }),
    );
  });

  it("removes ARMModelingReviewRequired and adds ARMModelingAutoSignedOff when lease is valid", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const github = createMockGithub();
    const context = createPRContext(7);

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(true);

    await armModelingReview({ github, context, core });

    expect(github.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 7,
      labels: ["ARMModelingAutoSignedOff"],
    });
    expect(github.rest.issues.removeLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ARMModelingReviewRequired" }),
    );
  });

  it("does not call GitHub API when github parameter is not provided", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const github = createMockGithub();

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(false);

    // No github / context provided — simulates the artifact-only path
    await armModelingReview({ core });

    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it("logs info and continues when direct label application fails (e.g. fork PR)", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const github = createMockGithub();
    const context = createPRContext(5);

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(false);

    // Simulate a 403 Forbidden (fork PR scenario)
    vi.mocked(github.rest.issues.addLabels).mockRejectedValue(createMockRequestError(403));

    const result = await armModelingReview({ github, context, core });

    // Should not rethrow; result should still be correct
    expect(result.status).toBe("new-rp-invalid-lease");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("add");
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining("Could not add labels directly to PR"),
    );
  });
});

describe("applyLabelsToPR", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adds labels marked as 'add' and removes labels marked as 'remove'", async () => {
    const github = createMockGithub();
    const context = createPRContext(10);

    await applyLabelsToPR({
      github,
      context,
      core,
      labelActions: {
        ARMModelingReviewRequired: "add",
        ARMModelingSignedOff: "remove",
        ARMModelingAutoSignedOff: "none",
      },
    });

    expect(github.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 10,
      labels: ["ARMModelingReviewRequired"],
    });
    expect(github.rest.issues.removeLabel).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 10,
      name: "ARMModelingSignedOff",
    });
    // 'none' labels should not trigger any API calls
    expect(github.rest.issues.addLabels).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.removeLabel).toHaveBeenCalledTimes(1);
  });

  it("skips API calls when context has no pull_request payload", async () => {
    const github = createMockGithub();
    const context = createMockContext(); // no pull_request in payload

    await applyLabelsToPR({
      github,
      context,
      core,
      labelActions: {
        ARMModelingReviewRequired: "add",
        ARMModelingSignedOff: "remove",
        ARMModelingAutoSignedOff: "none",
      },
    });

    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it("skips API calls when github is not provided", async () => {
    const github = createMockGithub();
    const context = createPRContext(3);

    await applyLabelsToPR({
      github: undefined,
      context,
      core,
      labelActions: {
        ARMModelingReviewRequired: "add",
        ARMModelingSignedOff: "remove",
        ARMModelingAutoSignedOff: "none",
      },
    });

    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it("ignores 404 when removing a label that is not present on the PR", async () => {
    const github = createMockGithub();
    const context = createPRContext(11);

    vi.mocked(github.rest.issues.removeLabel).mockRejectedValue(createMockRequestError(404));

    // Should not throw
    await expect(
      applyLabelsToPR({
        github,
        context,
        core,
        labelActions: {
          ARMModelingReviewRequired: "none",
          ARMModelingSignedOff: "remove",
          ARMModelingAutoSignedOff: "none",
        },
      }),
    ).resolves.not.toThrow();

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Label "ARMModelingSignedOff" not present on PR'),
    );
  });

  it("logs and continues when removeLabel returns a non-404 error", async () => {
    const github = createMockGithub();
    const context = createPRContext(12);

    vi.mocked(github.rest.issues.removeLabel).mockRejectedValue(createMockRequestError(403));

    await expect(
      applyLabelsToPR({
        github,
        context,
        core,
        labelActions: {
          ARMModelingReviewRequired: "none",
          ARMModelingSignedOff: "remove",
          ARMModelingAutoSignedOff: "none",
        },
      }),
    ).resolves.not.toThrow();

    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Could not remove label "ARMModelingSignedOff" directly from PR'),
    );
  });
});
