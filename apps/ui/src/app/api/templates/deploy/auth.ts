import { kubeconfigCredentialsMatch } from "@/lib/chat-runtime/kubeconfig-identity-core";
import type { BrainProject } from "@/lib/project-persistence/projects";
import type { ServerCredentials } from "@/lib/server-credentials";

export type TemplateDeployAuthorization =
  | { ok: true; encodedKubeconfig: string }
  | { message: string; ok: false; status: number };

export function authorizeTemplateDeployIdentity(input: {
  devBypass: boolean;
  devEncodedKubeconfig: string;
  devNamespace: string;
  encodedKubeconfig: string;
  namespace: string;
  project: BrainProject | null;
  serverCredentials: ServerCredentials;
}): TemplateDeployAuthorization {
  if (input.devBypass) {
    if (
      input.devEncodedKubeconfig !== "" &&
      !kubeconfigCredentialsMatch(
        input.encodedKubeconfig,
        input.devEncodedKubeconfig
      )
    ) {
      return {
        message: "kubeconfig does not match local dev credentials.",
        ok: false,
        status: 403,
      };
    }
    if (
      input.devNamespace !== "" &&
      input.devNamespace.trim() !== input.namespace.trim()
    ) {
      return {
        message: "Project namespace is not accessible.",
        ok: false,
        status: 403,
      };
    }
    return input.project == null
      ? { message: "Project not found.", ok: false, status: 404 }
      : {
          encodedKubeconfig:
            input.devEncodedKubeconfig || input.encodedKubeconfig,
          ok: true,
        };
  }

  if (input.serverCredentials.serverEncodedKubeconfig.trim() === "") {
    return { message: "Authentication is required.", ok: false, status: 401 };
  }
  if (
    !kubeconfigCredentialsMatch(
      input.encodedKubeconfig,
      input.serverCredentials.serverEncodedKubeconfig
    )
  ) {
    return {
      message: "kubeconfig does not match authenticated Sealos session.",
      ok: false,
      status: 403,
    };
  }
  if (
    input.serverCredentials.serverNamespace.trim() !== input.namespace.trim()
  ) {
    return {
      message: "Project namespace is not accessible.",
      ok: false,
      status: 403,
    };
  }
  return input.project == null
    ? { message: "Project not found.", ok: false, status: 404 }
    : {
        encodedKubeconfig: input.serverCredentials.serverEncodedKubeconfig,
        ok: true,
      };
}
