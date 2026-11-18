import { observer } from "mobx-react";
import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errToString } from "@shared/utils/error";
import { RevisionValidation } from "@shared/validations";
import type Revision from "~/models/Revision";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import Text from "~/components/Text";

interface Props {
  /** The revision to name. */
  revision: Revision;
  /** Called once the name has been saved. */
  onSubmit: () => void;
}

/**
 * A dialog to give a version of a document a name, such as "Approved" or
 * "v1.0", so that it is easy to find in the history later. Leaving the name
 * empty removes it.
 *
 * @param props the component props.
 * @returns the dialog content.
 */
function RevisionNameDialog({ revision, onSubmit }: Props) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(revision.name ?? "");
  const [isSaving, setIsSaving] = React.useState(false);

  const handleChange = React.useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => setName(ev.target.value),
    []
  );

  const handleSubmit = React.useCallback(
    async (ev: React.SyntheticEvent) => {
      ev.preventDefault();
      setIsSaving(true);

      try {
        await revision.save({ name: name.trim() || null });
        toast.success(
          name.trim() ? t("Version named") : t("Version name removed")
        );
        onSubmit();
      } catch (err) {
        toast.error(errToString(err));
      } finally {
        setIsSaving(false);
      }
    },
    [revision, name, onSubmit, t]
  );

  return (
    <form onSubmit={handleSubmit}>
      <Text as="p" type="secondary">
        <Trans>
          Named versions are easy to find in the history and are kept as a
          reference point.
        </Trans>
      </Text>
      <Flex column>
        <Input
          type="text"
          label={t("Name")}
          placeholder={t("For example “Approved” or “v1.0”")}
          onChange={handleChange}
          value={name}
          maxLength={RevisionValidation.maxNameLength}
          autoSelect
          flex
        />
      </Flex>
      <Flex justify="flex-end">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? `${t("Saving")}…` : t("Save")}
        </Button>
      </Flex>
    </form>
  );
}

export default observer(RevisionNameDialog);
