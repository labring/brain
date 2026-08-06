export interface DevboxEnvelope<T> {
  code: number;
  data: T;
  message: string;
}

export interface DevboxHealthData {
  status: string;
}

export interface DevboxState {
  phase: string;
  spec: string;
  status: string;
}

export interface DevboxListItem {
  creationTimestamp: string | null;
  deletionTimestamp: string | null;
  name: string;
  state: DevboxState;
}

export interface DevboxInfo {
  creationTimestamp: string | null;
  deletionTimestamp: string | null;
  gateway?: {
    accessToken?: string | null;
    accessURL?: string | null;
    appURL?: string | null;
    authToken?: string | null;
    bearerToken?: string | null;
    externalURL?: string | null;
    jwt?: string | null;
    route?: string | null;
    token?: string | null;
    url?: string | null;
  } | null;
  name: string;
  network?: {
    uniqueID?: string | null;
  } | null;
  state: DevboxState;
}

export interface CreateDevboxLabel {
  key: string;
  value: string;
}

export interface CreateDevboxKubeAccess {
  enabled?: boolean;
  roleTemplate?: "view" | "edit" | "admin";
}

export interface CreateDevboxInput {
  env?: Record<string, string>;
  image?: string;
  kubeAccess?: CreateDevboxKubeAccess;
  labels?: CreateDevboxLabel[];
  name: string;
  pauseAt?: string;
  storageLimit?: string;
  upstreamID?: string;
}

export interface CreateDevboxResult {
  name: string;
  namespace: string;
  state: string;
}

export interface PauseDevboxResult {
  name: string;
  namespace: string;
  state: string;
}

export interface RefreshPauseInput {
  pauseAt: string;
}

export interface RefreshPauseResult {
  name: string;
  namespace: string;
  pauseAt: string;
  refreshedAt: string;
}

export interface DeleteDevboxResult {
  name: string;
  namespace: string;
  status: string;
}

export interface DevboxExecInput {
  command: string[];
  container?: string;
  stdin?: string;
  timeoutSeconds?: number;
}

export interface DevboxExecResult {
  command: string[];
  container: string;
  executedAt: string;
  exitCode: number;
  namespace: string;
  podName: string;
  stderr: string;
  stdout: string;
}
