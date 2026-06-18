"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import {
  Bell,
  Check,
  CircleAlert,
  Info,
  Loader2,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

export default function ToasterPreview() {
  const timeoutIds = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const timeoutId of timeoutIds.current) {
        window.clearTimeout(timeoutId);
      }
    },
    []
  );

  const queueTimeout = (callback: () => void, delay: number) => {
    const timeoutId = window.setTimeout(callback, delay);
    timeoutIds.current.push(timeoutId);
  };

  return (
    <PreviewWrapper className="lg:grid-cols-1">
      <Preview title="Variants">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <AppButton
            className="justify-start"
            onClick={() =>
              toast.success("Settings applied.", {
                description: "Network routes are up to date.",
              })
            }
            variant="secondary"
          >
            <Check aria-hidden data-icon="inline-start" />
            Success
          </AppButton>
          <AppButton
            className="justify-start"
            onClick={() =>
              toast.error("Apply failed.", {
                description: "Resolve the conflict and try again.",
              })
            }
            variant="secondary"
          >
            <CircleAlert aria-hidden data-icon="inline-start" />
            Error
          </AppButton>
          <AppButton
            className="justify-start"
            onClick={() =>
              toast.warning("Domain still verifying.", {
                description: "Check the CNAME record before publishing.",
              })
            }
            variant="secondary"
          >
            <TriangleAlert aria-hidden data-icon="inline-start" />
            Warning
          </AppButton>
          <AppButton
            className="justify-start"
            onClick={() =>
              toast.info("Build queued.", {
                description: "The task timeline will update automatically.",
              })
            }
            variant="secondary"
          >
            <Info aria-hidden data-icon="inline-start" />
            Info
          </AppButton>
          <AppButton
            className="justify-start"
            onClick={() =>
              toast("Preview notice.", {
                description: "A neutral toast uses the normal color tokens.",
              })
            }
            variant="secondary"
          >
            <Bell aria-hidden data-icon="inline-start" />
            Default
          </AppButton>
          <AppButton
            className="justify-start"
            onClick={() => toast.dismiss()}
            variant="quiet"
          >
            <X aria-hidden data-icon="inline-start" />
            Dismiss all
          </AppButton>
        </div>
      </Preview>

      <Preview title="Async states">
        <div className="flex flex-wrap items-center gap-3">
          <AppButton
            onClick={() => {
              const id = toast.loading("Deploying project.", {
                description: "Waiting for resource readiness.",
              });
              queueTimeout(() => {
                toast.success("Deployment ready.", {
                  description: "All visible resources are healthy.",
                  id,
                });
              }, 1600);
            }}
            variant="primary"
          >
            <Loader2 aria-hidden data-icon="inline-start" />
            Loading to success
          </AppButton>
          <AppButton
            onClick={() => {
              const promise = new Promise<string>((resolve) => {
                queueTimeout(() => resolve("api-service"), 1400);
              });

              toast.promise(promise, {
                loading: "Syncing project metadata.",
                success: (name) => `${name} synced.`,
                error: "Could not sync project metadata.",
              });
            }}
            variant="secondary"
          >
            <Sparkles aria-hidden data-icon="inline-start" />
            Promise
          </AppButton>
        </div>
      </Preview>

      <Preview title="Long content">
        <div className="flex flex-wrap items-center gap-3">
          <AppButton
            onClick={() =>
              toast.error(
                'API 500: {"title":"Internal Server Error","status":500,"detail":"failed to update DB","errors":[{"message":"admission webhook \\"vopsrequest.kb.io\\" denied the request: storageClass [openebs-hostpath] of volumeClaimTemplate [data] does not support volume expansion in component mysql; you can view infos by command: kubectl get sc"}]}',
                {
                  duration: 10_000,
                }
              )
            }
            variant="secondary"
          >
            <CircleAlert aria-hidden data-icon="inline-start" />
            API 500 error
          </AppButton>
          <AppButton
            onClick={() =>
              toast.success("Custom domain verification is now accessible.", {
                description:
                  "www.analytics-production.example.com is routed through the selected application listening port.",
              })
            }
            variant="secondary"
          >
            Show wrapped copy
          </AppButton>
        </div>
      </Preview>
    </PreviewWrapper>
  );
}
