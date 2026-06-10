"use client";

import {
  type ContainerNetwork,
  ContainerSettingsPane,
} from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import { useState } from "react";

const DEMO_IMAGE =
  "ghcr.io/org/workloads/api-gateway:1.24.3@sha256:6b25d1b591f6cabc7ccf21c76623c";

const DEMO_ENV = [
  { name: "NODE_ENV", value: "production" },
  { name: "LOG_LEVEL", value: "info" },
  { name: "DATABASE_URL", value: "postgresql://db.internal:5432/app" },
  { name: "REDIS_HOST", value: "redis-master.cache.svc" },
];

const DEMO_NETWORK: ContainerNetwork = {
  privateAddress: "http://api-gateway.default.svc:3000",
  privatePort: 3000,
  publicAddresses: [
    {
      host: "orders.demo.sealos.run",
      port: 3000,
      status: "accessible",
      type: "platform",
      url: "https://orders.demo.sealos.run",
    },
    {
      host: "checkout.demo.sealos.run",
      port: 3000,
      status: "pending",
      type: "platform",
    },
    {
      host: "admin.demo.sealos.run",
      port: 8443,
      status: "accessible",
      type: "platform",
      url: "https://admin.demo.sealos.run",
    },
  ],
};

const DEMO_DB_REFERENCE_SOURCES = [
  {
    name: "postgres",
    namespace: "default",
    privateDsn: "postgresql://postgres.default.svc:5432/app",
    primitiveSecretRefs: {
      host: { key: "endpoint", name: "postgres-conn-credential" },
      password: { key: "passwd", name: "postgres-conn-credential" },
      port: { key: "port", name: "postgres-conn-credential" },
      username: { key: "user", name: "postgres-conn-credential" },
    },
  },
];

export default function ContainerSettingsPanePreview() {
  const [cpuCores, setCpuCores] = useState(2);
  const [memoryMib, setMemoryMib] = useState(2048);
  const [replicas, setReplicas] = useState(3);
  const [image, setImage] = useState(DEMO_IMAGE);
  const [env, setEnv] = useState(DEMO_ENV);
  const [network, setNetwork] = useState(DEMO_NETWORK);

  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview containerClassName="max-w-xl" title="Container settings pane">
        <ContainerSettingsPane
          cpuQuota={{
            max: 8,
            min: 0.25,
            onValueChange: setCpuCores,
            step: 0.25,
            value: cpuCores,
          }}
          dbDsnReferenceSources={DEMO_DB_REFERENCE_SOURCES}
          env={env}
          image={image}
          memoryQuota={{
            max: 4096,
            min: 512,
            onValueChange: setMemoryMib,
            step: 128,
            value: memoryMib,
          }}
          network={network}
          onEnvChange={setEnv}
          onImageChange={setImage}
          onNetworkChange={setNetwork}
          onSettingsDraftCommit={(draft) => {
            setCpuCores(draft.cpuCores);
            setEnv([...draft.env]);
            setImage(draft.image);
            setMemoryMib(draft.memoryMib);
            if (draft.network != null) {
              setNetwork(draft.network);
            }
            if (draft.replicaStrategy != null) {
              setReplicas(draft.replicaStrategy.fixed.replicas);
            }
          }}
          replicasQuota={{
            max: 20,
            min: 1,
            onValueChange: setReplicas,
            step: 1,
            value: replicas,
          }}
        />
      </Preview>
    </PreviewWrapper>
  );
}
