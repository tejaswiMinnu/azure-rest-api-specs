import "@typespec/rest";
import "@typespec/http";
import "@azure-tools/typespec-azure-core";
import "@azure-tools/typespec-azure-resource-manager";

using TypeSpec.Rest;
using TypeSpec.Http;
using Azure.Core;
using Azure.ResourceManager;

namespace Microsoft.Widget;

/** Employee resource representing a worker in the organization. */
model Employee is TrackedResource<EmployeeProperties> {
  ...ResourceNameParameter<Employee>;
}

/** Employee properties containing personal and professional details. */
model EmployeeProperties {
  /** Age of employee in years. */
  age?: int32;

  /** City where the employee is located. */
  city?: string;

  /** Department where the employee works. */
  department?: string;

  /** Employee's job title. */
  jobTitle?: string;

  /** Binary profile data of the employee encoded in base64url format. */
  @encode("base64url")
  profile?: bytes;

  /** The current provisioning state of the employee resource. */
  @visibility(Lifecycle.Read)
  provisioningState?: ProvisioningState;
}

/** The resource provisioning state indicating the current status of an async operation. */
@lroStatus
union ProvisioningState {
  ResourceProvisioningState,

  /** The resource is currently being provisioned. */
  Provisioning: "Provisioning",

  /** The resource is currently being updated. */
  Updating: "Updating",

  /** The resource is currently being deleted. */
  Deleting: "Deleting",

  /** The resource create request has been accepted and is pending. */
  Accepted: "Accepted",

  string,
}

@armResourceOperations
interface Employees {
  get is ArmResourceRead<Employee>;
  createOrUpdate is ArmResourceCreateOrReplaceAsync<Employee>;
  update is ArmResourcePatchSync<Employee, EmployeeProperties>;
  delete is ArmResourceDeleteWithoutOkAsync<Employee>;
  listByResourceGroup is ArmResourceListByParent<Employee>;
  listBySubscription is ArmListBySubscription<Employee>;
}
