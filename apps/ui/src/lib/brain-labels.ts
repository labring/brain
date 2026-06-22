export const BRAIN_MANAGED_BY_LABEL = "brain.io/managed-by";
export const BRAIN_MANAGED_BY_VALUE = "brain";
export const BRAIN_PROJECT_ID_LABEL = "brain.io/project-id";
export const BRAIN_DEPLOYMENT_KIND_LABEL = "brain.io/deployment-kind";
export const BRAIN_DEPLOYMENT_NAME_LABEL = "brain.io/deployment-name";
export const BRAIN_TEMPLATE_NAME_LABEL = "brain.io/template-name";
export const BRAIN_DB_ENGINE_LABEL = "brain.io/db-engine";
export const BRAIN_PUBLIC_ADDRESS_ID_LABEL = "brain.io/public-address-id";
export const BRAIN_PUBLIC_ADDRESS_KIND_LABEL = "brain.io/public-address-kind";

export const LAUNCHPAD_APP_DEPLOY_MANAGER_LABEL =
  "cloud.sealos.io/app-deploy-manager";
export const LAUNCHPAD_APP_DEPLOY_MANAGER_DOMAIN_LABEL =
  "cloud.sealos.io/app-deploy-manager-domain";
export const LAUNCHPAD_APP_LABEL = "app";
export const LAUNCHPAD_PAUSE_ANNOTATION = "deploy.cloud.sealos.io/pause";
export const LAUNCHPAD_MIN_REPLICAS_ANNOTATION =
  "deploy.cloud.sealos.io/minReplicas";
export const LAUNCHPAD_MAX_REPLICAS_ANNOTATION =
  "deploy.cloud.sealos.io/maxReplicas";
export const LAUNCHPAD_RESIZE_ANNOTATION = "deploy.cloud.sealos.io/resize";
export const LAUNCHPAD_TEMPLATE_SOURCE_LABEL =
  "cloud.sealos.io/deploy-on-sealos";
export const LAUNCHPAD_SEALAF_SOURCE_LABEL = "sealaf-app";

export const DB_PROVIDER_INSTANCE_LABEL = "app.kubernetes.io/instance";
export const DB_PROVIDER_CLUSTER_DEFINITION_LABEL =
  "clusterdefinition.kubeblocks.io/name";
export const DB_PROVIDER_CLUSTER_VERSION_LABEL =
  "clusterversion.kubeblocks.io/name";
export const DB_PROVIDER_CR_LABEL = "sealos-db-provider-cr";

export function templateDeploymentExtraLabels(input: {
  instanceName: string;
  projectId: string;
  templateName: string;
}) {
  return {
    [BRAIN_MANAGED_BY_LABEL]: BRAIN_MANAGED_BY_VALUE,
    [BRAIN_PROJECT_ID_LABEL]: input.projectId,
    [BRAIN_DEPLOYMENT_KIND_LABEL]: "template",
    [BRAIN_DEPLOYMENT_NAME_LABEL]: input.instanceName,
    [BRAIN_TEMPLATE_NAME_LABEL]: input.templateName,
  };
}
