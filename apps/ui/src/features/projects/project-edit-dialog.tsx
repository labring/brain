"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppInputField } from "@workspace/ui/components/app-input-field";
import { AppTextarea } from "@workspace/ui/components/app-textarea";
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field";
import { SquarePen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export const PROJECT_EDIT_DESCRIPTION_MAX_LENGTH = 256;

export interface ProjectEditDialogValues {
  description: string;
  displayName: string;
}

export function ProjectEditDialog({
  currentDescription,
  currentName,
  dataSlot = "project-edit-dialog",
  idBase = dataSlot,
  onOpenChange,
  onSubmit,
  open,
}: {
  currentDescription: string;
  currentName: string;
  dataSlot?: string;
  idBase?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (next: ProjectEditDialogValues) => void | Promise<void>;
  open: boolean;
}) {
  const description = currentDescription.trim();
  const [displayNameDraft, setDisplayNameDraft] = useState(currentName);
  const [descriptionDraft, setDescriptionDraft] = useState(description);
  const [editError, setEditError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDisplayNameDraft(currentName);
      setDescriptionDraft(description);
      setEditError(null);
      setDescriptionError(null);
    }
  }, [currentName, description, open]);

  const submit = useCallback(async () => {
    const displayName = displayNameDraft.trim();
    const nextDescription = descriptionDraft.trim();
    if (displayName === "") {
      setEditError("Project name is required.");
      return;
    }
    if (nextDescription.length > PROJECT_EDIT_DESCRIPTION_MAX_LENGTH) {
      setDescriptionError(
        "Project description must be 256 characters or fewer."
      );
      return;
    }
    if (displayName === currentName && nextDescription === description) {
      onOpenChange(false);
      return;
    }

    setBusy(true);
    setEditError(null);
    setDescriptionError(null);
    try {
      await onSubmit({ description: nextDescription, displayName });
      onOpenChange(false);
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Project update failed."
      );
    } finally {
      setBusy(false);
    }
  }, [
    currentName,
    description,
    descriptionDraft,
    displayNameDraft,
    onOpenChange,
    onSubmit,
  ]);

  return (
    <AppDialog.Root
      onOpenChange={(nextOpen) => {
        if (busy && !nextOpen) {
          return;
        }
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <AppDialog.Content
        data-slot={dataSlot}
        onClick={(event) => event.stopPropagation()}
      >
        <AppDialog.Header>
          <AppDialog.Icon>
            <SquarePen aria-hidden />
          </AppDialog.Icon>
          <AppDialog.Title>Edit project</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppInputField
            autoComplete="off"
            error={editError}
            id={`${idBase}-name`}
            label="Name"
            onChange={(event) => {
              setDisplayNameDraft(event.target.value);
              if (editError) {
                setEditError(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit().catch(() => undefined);
              }
            }}
            placeholder="Name"
            value={displayNameDraft}
          />
          <Field className="gap-2" data-slot="project-edit-description-field">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel
                className="text-foreground leading-none"
                htmlFor={`${idBase}-description`}
              >
                Description
              </FieldLabel>
              <span className="text-[11px] text-muted-foreground leading-4">
                {`${descriptionDraft.length}/${PROJECT_EDIT_DESCRIPTION_MAX_LENGTH}`}
              </span>
            </div>
            <AppTextarea
              aria-invalid={descriptionError === null ? undefined : true}
              className="min-h-9 resize-none border-input bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:border-blue-500 focus-visible:ring-[1px] focus-visible:ring-blue-500/50 dark:bg-transparent"
              id={`${idBase}-description`}
              maxLength={PROJECT_EDIT_DESCRIPTION_MAX_LENGTH + 1}
              onChange={(event) => {
                setDescriptionDraft(event.currentTarget.value);
                if (descriptionError) {
                  setDescriptionError(null);
                }
              }}
              placeholder="Description"
              rows={1}
              value={descriptionDraft}
            />
            {descriptionError === null ? null : (
              <FieldError className="text-xs leading-4" role="alert">
                {descriptionError}
              </FieldError>
            )}
          </Field>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel
            className="bg-input/30 hover:bg-input"
            disabled={busy}
          >
            Cancel
          </AppDialog.Cancel>
          <AppDialog.Action
            className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-hover"
            disabled={
              busy ||
              displayNameDraft.trim() === "" ||
              descriptionDraft.trim().length >
                PROJECT_EDIT_DESCRIPTION_MAX_LENGTH ||
              (displayNameDraft.trim() === currentName &&
                descriptionDraft.trim() === description)
            }
            loading={busy}
            loadingLabel="Saving"
            onClick={() => submit().catch(() => undefined)}
            type="button"
          >
            Save
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
