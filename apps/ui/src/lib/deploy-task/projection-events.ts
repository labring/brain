import "server-only";

import {
  publishDeploymentTaskProjectionChangeCore,
  subscribeDeploymentTaskProjectionEventsCore,
} from "./projection-events-core";

export const publishDeploymentTaskProjectionChange =
  publishDeploymentTaskProjectionChangeCore;
export const subscribeDeploymentTaskProjectionEvents =
  subscribeDeploymentTaskProjectionEventsCore;
