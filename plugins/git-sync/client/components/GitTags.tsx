import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import Text from "~/components/Text";
import Time from "~/components/Time";
import { client } from "~/utils/ApiClient";
import type { GitTagData } from "../../shared/types";

interface Props {
  /** The ID of the sync whose repository tags are shown. */
  syncId: string;
}

/**
 * Lists the tags of a synchronized repository and creates new ones. A new tag
 * is created after a sync, so it marks the current state of the collection.
 */
export function GitTags({ syncId }: Props) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<GitTagData[] | undefined>();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .post("/gitSync.tags.list", { id: syncId })
      .then((res) => {
        if (!cancelled) {
          setTags(res.data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTags([]);
          toast.error(errToString(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [syncId]);

  const handleCreate = useCallback(
    async (ev: React.FormEvent) => {
      ev.preventDefault();
      if (!name.trim()) {
        return;
      }
      setSaving(true);
      try {
        const res = await client.post("/gitSync.tags.create", {
          id: syncId,
          name: name.trim(),
          message,
        });
        setTags(res.data);
        setName("");
        setMessage("");
        toast.success(t("Tag created"));
      } catch (err) {
        toast.error(errToString(err));
      } finally {
        setSaving(false);
      }
    },
    [syncId, name, message, t]
  );

  const handleDelete = useCallback(
    async (tag: string) => {
      try {
        const res = await client.post("/gitSync.tags.delete", {
          id: syncId,
          name: tag,
        });
        setTags(res.data);
        toast.success(t("Tag deleted"));
      } catch (err) {
        toast.error(errToString(err));
      }
    },
    [syncId, t]
  );

  return (
    <div>
      <form onSubmit={handleCreate}>
        <Flex gap={8} align="flex-end">
          <Input
            label={t("New tag")}
            placeholder="v1.0.0"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            flex
          />
          <Input
            label={t("Message")}
            placeholder={t("Optional")}
            value={message}
            onChange={(ev) => setMessage(ev.target.value)}
            flex
          />
          <TagButton type="submit" disabled={isSaving || !name.trim()}>
            {isSaving ? `${t("Creating")}…` : t("Create tag")}
          </TagButton>
        </Flex>
      </form>
      {tags === undefined ? (
        <Text type="secondary">{`${t("Loading")}…`}</Text>
      ) : tags.length === 0 ? (
        <Text type="secondary">{t("The repository has no tags yet.")}</Text>
      ) : (
        <List>
          {tags.map((tag) => (
            <Row key={tag.name}>
              <div>
                <Text weight="bold">{tag.name}</Text>{" "}
                <Text type="tertiary" size="small">
                  {tag.commitSha.slice(0, 7)}
                </Text>
                <br />
                <Text type="secondary" size="small">
                  {tag.message}
                  {tag.author ? ` · ${tag.author}` : ""}
                  {tag.createdAt ? " · " : ""}
                  {tag.createdAt && <Time dateTime={tag.createdAt} addSuffix />}
                </Text>
              </div>
              <Button
                type="button"
                neutral
                onClick={() => handleDelete(tag.name)}
              >
                {t("Delete")}
              </Button>
            </Row>
          ))}
        </List>
      )}
    </div>
  );
}

const TagButton = styled(Button)`
  margin-bottom: 16px;
`;

const List = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
`;

const Row = styled.li`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid ${s("divider")};
`;
