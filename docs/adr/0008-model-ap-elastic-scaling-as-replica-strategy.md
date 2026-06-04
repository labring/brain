# Model AP Elastic Scaling as a replica strategy

AP Elastic Scaling is modeled as an AP Replica Strategy in AP desired state, not as an imperative autoscale action against the underlying Deployment. AP `spec.resource.replicaStrategy.type` selects either `fixed` or `elastic`; existing `spec.resource.replicas` values are treated as a legacy Fixed Replicas fallback only when `replicaStrategy` is absent.

## Considered Options

- Directly call the generic Kubernetes autoscale API from the AP Settings UI: rejected because it would create a second source of truth beside the AP desired state and would leave unclear ownership for cleanup when switching back to Fixed Replicas.
- Add `resource.autoscaling.enabled`: rejected because a boolean flag makes the meaning of `resource.replicas` ambiguous once multiple scaling strategies exist.
- Model Elastic Scaling as CPU-only: rejected because users need the same Replica Strategy surface to support Memory utilization as the scaling target while keeping CPU and Memory capacity controls as separate per-replica limits.
- Model Memory targets as utilization percentages: rejected because Kubernetes memory utilization percentages are request-relative and are easy to confuse with Memory limit percentages; Memory targets should use an absolute average value.
- Delete inactive strategy parameters from AP desired state: rejected because retaining inactive branches lets users switch between Fixed Replicas and Elastic Scaling without losing their last-entered settings; only the branch selected by `replicaStrategy.type` is reconciled.

## Consequences

Elastic Scaling v1 is single-metric horizontal scaling with `minReplicas`, `maxReplicas`, and one active target. CPU targets use request-relative utilization percentage; Memory targets use an absolute average value such as `512Mi`. The target shape should distinguish these branches instead of sharing one percentage field. The AP direct renderer creates, updates, and deletes the platform-managed HPA when `replicaStrategy.type` is `elastic`; when `type` is `fixed`, no HPA should remain and the Deployment replica count is fixed by the AP. CPU and Memory controls remain per-replica capacity limits and do not control replica count directly unless selected as the Elastic Scaling target.
