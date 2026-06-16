"use client";

import { useCallback, useMemo } from "react";
import {
  type ApNetwork,
  type ApNetworkCustomDomain,
  type ApNetworkPublicAddressDraft,
  type ApNetworkVisiblePublicAddressRow,
  apNetworkAfterDeletePublicAddress,
  apNetworkAfterEditPublicAddress,
  apNetworkAfterUnbindCustomDomain,
  apNetworkWithAddedPublicAddress,
  networkWithAppListeningPort,
  networkWithoutAppListeningPort,
} from "./ap-network-model";

export interface ApNetworkDraftController {
  addAppListeningPort: (port: number) => void | Promise<void>;
  addPublicAddress: (
    address: ApNetworkPublicAddressDraft,
    customDomain?: ApNetworkCustomDomain
  ) => void | Promise<void>;
  bindCustomDomain: (
    row: ApNetworkVisiblePublicAddressRow,
    port: number,
    customDomain?: ApNetworkCustomDomain
  ) => void | Promise<void>;
  canMutate: boolean;
  deleteAppListeningPort: (port: number) => void | Promise<void>;
  deletePublicAddress: (
    row: ApNetworkVisiblePublicAddressRow
  ) => void | Promise<void>;
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
        row: ApNetworkVisiblePublicAddressRow,
        port: number,
        customDomain?: ApNetworkCustomDomain
      ) =>
        commitNetwork(
          apNetworkAfterEditPublicAddress(network, {
            customDomain,
            publicAddress: row,
            port,
          })
        ),
      canMutate,
      deleteAppListeningPort: (port: number) =>
        commitNetwork(networkWithoutAppListeningPort(network, port)),
      deletePublicAddress: (row: ApNetworkVisiblePublicAddressRow) =>
        commitNetwork(apNetworkAfterDeletePublicAddress(network, row)),
      network,
      unbindCustomDomain: (domain: ApNetworkCustomDomain) =>
        commitNetwork(apNetworkAfterUnbindCustomDomain(network, domain)),
    }),
    [canMutate, commitNetwork, network]
  );
}
