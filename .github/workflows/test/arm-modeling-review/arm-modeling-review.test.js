import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockCore, createMockContext, createMockGithub } from "../mocks.js";

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
import { checkLease } from "../../src/arm-modeling-review/detect-arm-leases.js";
import armModelingReview from "../../src/arm-modeling-review/arm-modeling-review.js";
import { detectNewResourceTypes } from "../../src/arm-modeling-review/detect-new-resource-types.js";

const core = createMockCore();

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

  // ── Manual ARMModelingSignedOff label re-check behavior ─────────────
  // When ARMModelingSignedOff is present the lease check still runs (it is NOT
  // skipped), but core.setFailed() is suppressed so the CI check stays green
  // while labels are updated to reflect the actual lease state.

  it("re-checks lease and returns auto-signed-off when ARMModelingSignedOff label is present and lease is valid", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";

    const github = createMockGithub();
    const context = createMockContext();
    context.payload.pull_request = { number: 42 };
    context.repo = { owner: "org", repo: "repo" };

    vi.mocked(github.rest.issues.listLabelsOnIssue).mockResolvedValue({
      data: [{ name: "ARMModelingSignedOff" }],
    });

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(true);

    const result = await armModelingReview({ github, context, core });

    expect(result.status).toBe("new-rp-all-leases-valid");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("add");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("remove");
    expect(result.labelActions.ARMModelingSignedOff).toBe("remove");
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(checkLease).toHaveBeenCalled();
  });

  it("re-checks lease and returns review-required without setFailed when label present but lease invalid", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";

    const github = createMockGithub();
    const context = createMockContext();
    context.payload.pull_request = { number: 42 };
    context.repo = { owner: "org", repo: "repo" };

    vi.mocked(github.rest.issues.listLabelsOnIssue).mockResolvedValue({
      data: [{ name: "ARMModelingSignedOff" }],
    });

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(false);

    const result = await armModelingReview({ github, context, core });

    expect(result.status).toBe("new-rp-invalid-lease");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("add");
    expect(result.labelActions.ARMModelingSignedOff).toBe("remove");
    expect(result.labelActions.ARMModelingAutoSignedOff).toBe("remove");
    // Must NOT fail CI when the label is present — only update labels
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(checkLease).toHaveBeenCalled();
  });

  it("does not suppress setFailed when ARMModelingSignedOff label is absent", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";

    const github = createMockGithub();
    const context = createMockContext();
    context.payload.pull_request = { number: 42 };
    context.repo = { owner: "org", repo: "repo" };

    vi.mocked(github.rest.issues.listLabelsOnIssue).mockResolvedValue({ data: [] });

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(false);

    const result = await armModelingReview({ github, context, core });

    expect(result.status).toBe("new-rp-invalid-lease");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("add");
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    expect(checkLease).toHaveBeenCalled();
  });

  it("proceeds with normal lease check when github is not provided", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(false);

    const result = await armModelingReview({ core });

    expect(result.status).toBe("new-rp-invalid-lease");
    expect(core.setFailed).toHaveBeenCalledTimes(1);
  });

  it("warns and continues when GitHub API call fails", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";

    const github = createMockGithub();
    const context = createMockContext();
    context.payload.pull_request = { number: 42 };
    context.repo = { owner: "org", repo: "repo" };

    vi.mocked(github.rest.issues.listLabelsOnIssue).mockRejectedValue(new Error("API error"));

    vi.spyOn(changedFiles, "getChangedFiles").mockResolvedValue([
      "specification/svc/resource-manager/Microsoft.Svc/stable/2025-01-01/api.json",
    ]);
    vi.mocked(mockRaw).mockResolvedValue("");
    vi.mocked(checkLease).mockResolvedValue(false);

    const result = await armModelingReview({ github, context, core });

    // Should warn but continue with normal (non-manually-signed-off) behavior
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("API error"));
    expect(result.status).toBe("new-rp-invalid-lease");
    expect(core.setFailed).toHaveBeenCalledTimes(1);
  });

  it("suppresses setFailed for new resource types when ARMModelingSignedOff label is present", async () => {
    process.env.GITHUB_WORKSPACE = "/fake/repo";
    const rmFile =
      "specification/compute/resource-manager/Microsoft.Compute/stable/2024-01-01/compute.json";

    const github = createMockGithub();
    const context = createMockContext();
    context.payload.pull_request = { number: 42 };
    context.repo = { owner: "org", repo: "repo" };

    vi.mocked(github.rest.issues.listLabelsOnIssue).mockResolvedValue({
      data: [{ name: "ARMModelingSignedOff" }],
    });

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

    const result = await armModelingReview({ github, context, core });

    expect(result.status).toBe("new-rt-invalid-lease");
    expect(result.labelActions.ARMModelingReviewRequired).toBe("add");
    // setFailed suppressed because label is present
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
