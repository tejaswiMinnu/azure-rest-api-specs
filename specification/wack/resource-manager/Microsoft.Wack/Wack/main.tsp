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

/** Microsoft.Wack Resource Provider management API. */
@armProviderNamespace
@service(#{ title: "Wack" })
@versioned(Microsoft.Wack.Versions)
namespace Microsoft.Wack;

/** The available API versions. */
enum Versions {
  /** 2024-01-01-preview version */
  @armCommonTypesVersion(Azure.ResourceManager.CommonTypes.Versions.v5)
  v2024_01_01_preview: "2024-01-01-preview",
}

interface Operations extends Azure.ResourceManager.Operations {}

/** A Wack resource */
model WackResource is TrackedResource<WackProperties> {
  ...ResourceNameParameter<WackResource>;
}

/** Wack resource properties */
model WackProperties {
  /** Display name */
  displayName?: string;

  /** The provisioning state */
  @visibility(Lifecycle.Read)
  provisioningState?: ProvisioningState;
}

/** The resource provisioning state. */
@lroStatus
union ProvisioningState {
  ResourceProvisioningState,

  /** The resource is being provisioned */
  Provisioning: "Provisioning",

  string,
}

@armResourceOperations
interface WackResources {
  get is ArmResourceRead<WackResource>;
  createOrUpdate is ArmResourceCreateOrReplaceAsync<WackResource>;
  delete is ArmResourceDeleteWithoutOkAsync<WackResource>;
  listByResourceGroup is ArmResourceListByParent<WackResource>;
  listBySubscription is ArmListBySubscription<WackResource>;
}
