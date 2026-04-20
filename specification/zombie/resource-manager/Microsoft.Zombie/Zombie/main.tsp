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

/** Microsoft.Zombie Resource Provider management API. */
@armProviderNamespace
@service(#{ title: "Zombie" })
@versioned(Microsoft.Zombie.Versions)
namespace Microsoft.Zombie;

/** The available API versions. */
enum Versions {
  /** 2024-01-01-preview version */
  @armCommonTypesVersion(Azure.ResourceManager.CommonTypes.Versions.v5)
  v2024_01_01_preview: "2024-01-01-preview",
}

interface Operations extends Azure.ResourceManager.Operations {}

/** A Zombie resource */
model ZombieResource is TrackedResource<ZombieProperties> {
  ...ResourceNameParameter<ZombieResource>;
}

/** Zombie resource properties */
model ZombieProperties {
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
interface ZombieResources {
  get is ArmResourceRead<ZombieResource>;
  createOrUpdate is ArmResourceCreateOrReplaceAsync<ZombieResource>;
  delete is ArmResourceDeleteWithoutOkAsync<ZombieResource>;
  listByResourceGroup is ArmResourceListByParent<ZombieResource>;
  listBySubscription is ArmListBySubscription<ZombieResource>;
}
