import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import { InputSelect } from "~/components/InputSelect";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import { client } from "~/utils/ApiClient";
import type { GitSyncData } from "../../shared/types";

interface Props {
  /** The collection to connect. */
  collectionId: string;
  /** The existing sync, if the collection is connected already. */
  sync?: GitSyncData;
  /** Called with the saved sync, or null when it was removed. */
  onSaved: (sync: GitSyncData | null) => void;
}

interface FormData {
  repositoryUrl: string;
  branch: string;
  path: string;
  username: string;
  accessToken: string;
  authorName: string;
  authorEmail: string;
}

/**
 * A form to connect a collection to a Git repository, or to change the
 * settings of an existing connection.
 */
export function GitSyncForm({ collectionId, sync, onSaved }: Props) {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<GitSyncData["direction"]>(
    sync?.direction ?? "bidirectional"
  );
  const [enabled, setEnabled] = useState(sync?.enabled ?? true);
  const [removeToken, setRemoveToken] = useState(false);
  const { register, handleSubmit, formState } = useForm<FormData>({
    defaultValues: {
      repositoryUrl: sync?.repositoryUrl ?? "",
      branch: sync?.branch ?? "main",
      path: sync?.path ?? "",
      username: sync?.username ?? "",
      accessToken: "",
      authorName: sync?.authorName ?? "",
      authorEmail: sync?.authorEmail ?? "",
    },
  });

  const handleSave = useCallback(
    async (data: FormData) => {
      const token = data.accessToken.trim()
        ? data.accessToken.trim()
        : removeToken
          ? null
          : undefined;
      try {
        const res = sync
          ? await client.post("/gitSync.update", {
              id: sync.id,
              ...data,
              accessToken: token,
              direction,
              enabled,
            })
          : await client.post("/gitSync.create", {
              collectionId,
              ...data,
              accessToken: token ?? null,
              direction,
              enabled,
            });
        toast.success(
          sync ? t("Git sync saved") : t("Collection connected to Git")
        );
        onSaved(res.data);
      } catch (err) {
        toast.error(errToString(err));
      }
    },
    [sync, collectionId, direction, enabled, removeToken, onSaved, t]
  );

  const handleDisconnect = useCallback(async () => {
    if (!sync) {
      return;
    }
    try {
      await client.post("/gitSync.delete", { id: sync.id });
      toast.success(t("Collection disconnected from Git"));
      onSaved(null);
    } catch (err) {
      toast.error(errToString(err));
    }
  }, [sync, onSaved, t]);

  return (
    <form onSubmit={handleSubmit(handleSave)}>
      <Input
        label={t("Repository URL")}
        placeholder="https://github.com/acme/handbook.git"
        {...register("repositoryUrl", { required: true })}
      />
      <Flex gap={8}>
        <Input label={t("Branch")} flex {...register("branch")} />
        <Input
          label={t("Folder")}
          placeholder={t("Repository root")}
          flex
          {...register("path")}
        />
      </Flex>
      <Flex gap={8}>
        <Input
          label={t("Username")}
          placeholder="git"
          flex
          autoComplete="off"
          {...register("username")}
        />
        <Input
          label={t("Access token")}
          type="password"
          placeholder={
            sync?.hasToken && !removeToken
              ? t("Saved, enter a new token to replace it")
              : t("Personal access token")
          }
          flex
          autoComplete="new-password"
          {...register("accessToken")}
        />
      </Flex>
      {sync?.hasToken && (
        <Switch
          label={t("Remove the saved token")}
          checked={removeToken}
          onChange={setRemoveToken}
        />
      )}
      <InputSelect
        label={t("Direction")}
        value={direction}
        onChange={(value) =>
          setDirection(value === "push" ? "push" : "bidirectional")
        }
        options={[
          {
            type: "item",
            label: t("Both directions"),
            value: "bidirectional",
            description: t(
              "Changes in Outline are committed, commits in Git are applied to the collection."
            ),
          },
          {
            type: "item",
            label: t("Outline to Git"),
            value: "push",
            description: t(
              "Changes in Outline are committed, the repository is never read back."
            ),
          },
        ]}
      />
      <Flex gap={8}>
        <Input
          label={t("Commit author")}
          placeholder="Outline"
          flex
          {...register("authorName")}
        />
        <Input
          label={t("Commit email")}
          type="email"
          placeholder="outline@example.com"
          flex
          {...register("authorEmail")}
        />
      </Flex>
      <Switch
        label={t("Sync enabled")}
        checked={enabled}
        onChange={setEnabled}
      />
      {sync && (
        <Webhook>
          <Text as="p" type="secondary" size="small">
            {t(
              "Add this URL as a push webhook in GitHub, GitLab or Gitea to import commits right away. Otherwise the repository is checked every few minutes."
            )}
          </Text>
          <Input
            label={t("Webhook URL")}
            value={sync.webhookUrl}
            readOnly
            onFocus={(ev) =>
              ev.target instanceof HTMLInputElement && ev.target.select()
            }
          />
        </Webhook>
      )}
      <Flex justify="flex-end" gap={8}>
        {sync && (
          <Button type="button" onClick={handleDisconnect} danger neutral>
            {t("Disconnect")}
          </Button>
        )}
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting
            ? `${t("Saving")}…`
            : sync
              ? t("Save")
              : t("Connect")}
        </Button>
      </Flex>
    </form>
  );
}

const Webhook = styled.div`
  margin-top: 12px;
`;
