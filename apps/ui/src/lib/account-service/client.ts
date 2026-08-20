import "server-only";

import {
  type AccountServiceRequest,
  createAccountServiceClient,
} from "./client-core";
import { getAccountServiceConfig } from "./config";

export async function requestAccountService(
  request: AccountServiceRequest
): Promise<Response> {
  const client = createAccountServiceClient({
    config: getAccountServiceConfig(),
  });
  return await client(request);
}
