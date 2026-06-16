"use client";

import { useCallback, useMemo } from "react";
import {
  type ApNetwork,
  type ApNetworkCustomDomain,
  type ApNetworkPublicAddress,
  type ApNetworkPublicAddressDraft,
  apNetworkAfterDeletePublicAddress,
  apNetworkAfterEditPublicAddress,
  apNetworkAfterUnbindCustomDomain,
  apNetworkWithAddedPublicAddress,
  networkWithAppListeningPort,
  networkWithoutAppListeningPort,
  visibleDomainRows,
} from "./ap-network-model";

export interface ApNetworkDraftController {
  addAppListeningPort: (port: number) => void | Promise<void>;
  addPublicAddress: (
    address: ApNetworkPublicAddressDraft,
    customDomain?: ApNetworkCustomDomain
  ) => void | Promise<void>;
  bindCustomDomain: (
    address: ApNetworkPublicAddress,
    index: number,
    port: number,
    customDomain?: ApNetworkCustomDomain
  ) => void | Promise<void>;
  canMutate: boolean;
  deleteAppListeningPort: (port: number) => void | Promise<void>;
  deletePublicAddress: (index: number) => void | Promise<void>;
  network: ApNetwork;
  unbindCustomDomain: (domain: ApNetworkCustomDomain) => void | Promise<void>;
}

export interface UseApNetworkDraftControllerOptions {
  network: ApNetwork;
  onNetworkChange?: (network: ApNetwork) => void | Promise<void>;
  readOnly?: boolean;
}

export function useApNetworkDraftController({
  network,
  onNetworkChange,
  readOnly = false,
}: UseApNetworkDraftControllerOptions): ApNetworkDraftController {
  const canMutate = !readOnly && onNetworkChange != null;
  const commitNetwork = useCallback(
    (next: ApNetwork) => {
      if (readOnly || onNetworkChange == null) {
        return;
      }
      return onNetworkChange(next);
    },
    [onNetworkChange, readOnly]
  );

  return useMemo(
    () => ({
      addAppListeningPort: (port: number) =>
        commitNetwork(networkWithAppListeningPort(network, port)),
      addPublicAddress: (
        address: ApNetworkPublicAddressDraft,
        customDomain?: ApNetworkCustomDomain
      ) =>
        commitNetwork(
          apNetworkWithAddedPublicAddress(network, {
            customDomain,
            publicAddress: address,
          })
        ),
      bindCustomDomain: (
        address: ApNetworkPublicAddress,
        index: number,
        port: number,
        customDomain?: ApNetworkCustomDomain
      ) =>
        commitNetwork(
          apNetworkAfterEditPublicAddress(network, {
            customDomain,
            platformAddress: address,
            platformAddressIndex: index,
            port,
          })
        ),
      canMutate,
      deleteAppListeningPort: (port: number) =>
        commitNetwork(networkWithoutAppListeningPort(network, port)),
      deletePublicAddress: (index: number) => {
        const target = visibleDomainRows(network).publicAddresses[index];
        return commitNetwork(
          apNetworkAfterDeletePublicAddress(network, target, index)
        );
      },
      network,
      unbindCustomDomain: (domain: ApNetworkCustomDomain) =>
        commitNetwork(apNetworkAfterUnbindCustomDomain(network, domain)),
    }),
    [canMutate, commitNetwork, network]
  );
}
