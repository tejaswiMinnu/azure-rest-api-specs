import "@typespec/http";
import "@typespec/rest";
import "@typespec/versioning";
import "@azure-tools/typespec-azure-core";
import "@azure-tools/typespec-azure-resource-manager";

using TypeSpec.Http;
using TypeSpec.Rest;
using TypeSpec.Versioning;
using Azure.Core;
using Azure.ResourceManager;

/** Microsoft.Luminary.Insights Resource Provider management API. */
@armProviderNamespace("Microsoft.Luminary")
@service(#{ title: "LuminaryInsights" })
@versioned(Microsoft.Luminary.Insights.Versions)
namespace Microsoft.Luminary.Insights;

/** The available API versions. */
enum Versions {
  /** 2025-01-01-preview version */
  @armCommonTypesVersion(Azure.ResourceManager.CommonTypes.Versions.v5)
  v2025_01_01_preview: "2025-01-01-preview",
}

interface Operations extends Azure.ResourceManager.Operations {}
