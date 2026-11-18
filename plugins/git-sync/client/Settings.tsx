import { observer } from "mobx-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import { errToString } from "@shared/utils/error";
import type Collection from "~/models/Collection";
import Badge from "~/components/Badge";
import Button from "~/components/Button";
import CollectionIcon from "~/components/Icons/CollectionIcon";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import Text from "~/components/Text";
import Time from "~/components/Time";
import useStores from "~/hooks/useStores";
import { IntegrationScene } from "~/scenes/Settings/components/IntegrationScene";
import { client } from "~/utils/ApiClient";
import type { GitSyncData } from "../shared/types";
import Icon from "./Icon";
import { GitSyncForm } from "./components/GitSyncForm";
import { GitTags } from "./components/GitTags";

function GitSync() {
  const { t } = useTranslation();
  const { collections } = useStores();
  const [syncs, setSyncs] = useState<Record<string, GitSyncData>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void collections.fetchAll().catch(() => undefined);
    client
      .post("/gitSync.list")
      .then((res) => {
        setSyncs(
          Object.fromEntries(
            (res.data as GitSyncData[]).map((sync) => [sync.collectionId, sync])
          )
        );
      })
      .catch((err) => toast.error(errToString(err)))
      .finally(() => setLoaded(true));
  }, [collections]);

  const handleChange = useCallback(
    (collectionId: string, sync: GitSyncData | null) => {
      setSyncs((previous) => {
        const next = { ...previous };
        if (sync) {
          next[collectionId] = sync;
        } else {
          delete next[collectionId];
        }
        return next;
      });
    },
    []
  );

  return (
    <IntegrationScene title={t("Git Sync")} icon={<Icon />}>
      <Heading>{t("Git Sync")}</Heading>
      <Text as="p" type="secondary">
        <Trans>
          Connect a collection to a Git repository. Every published document is
          written as a Markdown file with frontmatter, nested documents become
          folders. Changes are committed in the background, and commits pushed
          to the repository are applied to the collection. When a document
          changed on both sides, the version in Outline is kept and the other
          version stays in the Git history.
        </Trans>
      </Text>
      {loaded &&
        collections.allActive.map((collection) => (
          <CollectionGitSync
            key={collection.id}
            collection={collection}
            sync={syncs[collection.id]}
            onChange={handleChange}
          />
        ))}
    </IntegrationScene>
  );
}

interface RowProps {
  collection: Collection;
  sync?: GitSyncData;
  onChange: (collectionId: string, sync: GitSyncData | null) => void;
}

const CollectionGitSync = observer(function CollectionGitSync({
  collection,
  sync,
  onChange,
}: RowProps) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<"settings" | "tags" | null>(null);
  const [isRunning, setRunning] = useState(false);

  const handleSaved = useCallback(
    (saved: GitSyncData | null) => {
      onChange(collection.id, saved);
      setPanel(null);
    },
    [collection.id, onChange]
  );

  const handleRun = useCallback(async () => {
    if (!sync) {
      return;
    }
    setRunning(true);
    try {
      const res = await client.post("/gitSync.run", { id: sync.id });
      onChange(collection.id, res.data);
      toast.success(t("Sync completed"));
    } catch (err) {
      toast.error(errToString(err));
    } finally {
      setRunning(false);
    }
  }, [sync, collection.id, onChange, t]);

  const togglePanel = useCallback(
    (value: "settings" | "tags") =>
      setPanel((current) => (current === value ? null : value)),
    []
  );

  const result = sync?.lastResult;

  return (
    <Card>
      <Flex justify="space-between" align="center" gap={8} wrap>
        <Flex align="center" gap={8}>
          <CollectionIcon collection={collection} />
          <div>
            <Text weight="bold">{collection.name}</Text>
            {sync && (
              <>
                {" "}
                <Badge primary={sync.status === "success"}>
                  {!sync.enabled
                    ? t("Paused")
                    : sync.status === "error"
                      ? t("Error")
                      : sync.status === "running"
                        ? t("Syncing")
                        : sync.status === "success"
                          ? t("Synced")
                          : t("Pending")}
                </Badge>
                <br />
                <Text type="secondary" size="small">
                  {sync.repositoryUrl} · {sync.branch}
                  {sync.path ? ` · /${sync.path}` : ""}
                  {sync.lastSyncedAt && (
                    <>
                      {" · "}
                      <Time dateTime={sync.lastSyncedAt} addSuffix />
                    </>
                  )}
                </Text>
              </>
            )}
          </div>
        </Flex>
        <Flex gap={8}>
          {sync && (
            <>
              <Button
                type="button"
                neutral
                onClick={handleRun}
                disabled={isRunning || !sync.enabled}
              >
                {isRunning ? `${t("Syncing")}…` : t("Sync now")}
              </Button>
              <Button type="button" neutral onClick={() => togglePanel("tags")}>
                {t("Tags")}
              </Button>
            </>
          )}
          <Button
            type="button"
            neutral={!!sync}
            onClick={() => togglePanel("settings")}
          >
            {sync ? t("Settings") : t("Connect")}
          </Button>
        </Flex>
      </Flex>
      {sync?.status === "error" && sync.lastError && (
        <ErrorText as="p" size="small">
          {sync.lastError}
        </ErrorText>
      )}
      {result && result.conflicts.length > 0 && (
        <Text as="p" type="secondary" size="small">
          {t("Kept the Outline version of documents that also changed in Git")}:{" "}
          {result.conflicts.join(", ")}
        </Text>
      )}
      {panel === "settings" && (
        <Panel>
          <GitSyncForm
            collectionId={collection.id}
            sync={sync}
            onSaved={handleSaved}
          />
        </Panel>
      )}
      {panel === "tags" && sync && (
        <Panel>
          <GitTags syncId={sync.id} />
        </Panel>
      )}
    </Card>
  );
});

const Card = styled.div`
  padding: 16px 0;
  border-bottom: 1px solid ${s("divider")};
`;

const Panel = styled.div`
  margin-top: 16px;
`;

const ErrorText = styled(Text)`
  color: ${s("danger")};
  white-space: pre-wrap;
  word-break: break-word;
`;

export default observer(GitSync);
