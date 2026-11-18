import copy from "copy-to-clipboard";
import { observer } from "mobx-react";
import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import styled from "styled-components";
import { toast } from "sonner";
import { s } from "@shared/styles";
import { errToString } from "@shared/utils/error";
import type Document from "~/models/Document";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import usePolicy from "~/hooks/usePolicy";
import { client } from "~/utils/ApiClient";

interface Props {
  /** The document to show the Markdown source of. */
  document: Document;
  /** Called when the dialog should close. */
  onRequestClose: () => void;
}

/**
 * Shows the Markdown source of a document and, for users who can edit the
 * document, allows the source to be changed and saved back. Saving replaces
 * the content of the document; connected editors receive the change through
 * the collaboration server.
 *
 * @param props the component props.
 * @returns the dialog content.
 */
function MarkdownSourceDialog({ document, onRequestClose }: Props) {
  const { t } = useTranslation();
  const can = usePolicy(document);
  const [original, setOriginal] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    client
      .post("/documents.export", { id: document.id })
      .then((res: { data: string }) => {
        if (!cancelled) {
          const body = stripTitle(res.data);
          setOriginal(body);
          setText(body);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(errToString(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [document.id]);

  const handleChange = React.useCallback(
    (ev: React.ChangeEvent<HTMLTextAreaElement>) => setText(ev.target.value),
    []
  );

  const handleCopy = React.useCallback(() => {
    copy(text);
    toast.success(t("Markdown copied to clipboard"));
  }, [text, t]);

  const handleSubmit = React.useCallback(
    async (ev: React.SyntheticEvent) => {
      ev.preventDefault();
      setIsSaving(true);

      try {
        await client.post("/documents.update", {
          id: document.id,
          text,
        });
        toast.success(t("Document updated from Markdown"));
        onRequestClose();
      } catch (err) {
        toast.error(errToString(err));
      } finally {
        setIsSaving(false);
      }
    },
    [document.id, text, onRequestClose, t]
  );

  const canEdit = !!can.update;
  const isLoading = original === null && !error;
  const isDirty = original !== null && text !== original;

  return (
    <form onSubmit={handleSubmit}>
      {canEdit && (
        <Text as="p" type="secondary" size="small">
          <Trans>
            Saving replaces the content of the document with this Markdown.
            Formatting that Markdown cannot express, such as text colors, is
            lost for the changed document.
          </Trans>
        </Text>
      )}
      {error ? (
        <Text as="p" type="danger">
          {error}
        </Text>
      ) : (
        <Source
          aria-label={t("Markdown")}
          value={isLoading ? `${t("Loading")}…` : text}
          onChange={handleChange}
          readOnly={!canEdit || isLoading}
          spellCheck={false}
          autoFocus
        />
      )}
      <Flex justify="flex-end" gap={8}>
        <Button type="button" neutral onClick={handleCopy} disabled={isLoading}>
          {t("Copy")}
        </Button>
        {canEdit && (
          <Button type="submit" disabled={isSaving || !isDirty}>
            {isSaving ? `${t("Saving")}…` : t("Save")}
          </Button>
        )}
      </Flex>
    </form>
  );
}

/**
 * The export starts with the title as a heading, followed by a blank line. The
 * title is edited separately, so it is removed to avoid saving it twice.
 *
 * @param markdown the exported Markdown.
 * @returns the Markdown without the leading title heading.
 */
function stripTitle(markdown: string): string {
  const match = /^# [^\n]*\n\n?/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

const Source = styled.textarea`
  display: block;
  width: 100%;
  min-height: 50vh;
  margin: 8px 0 16px;
  padding: 12px;
  font-family: ${s("fontFamilyMono")};
  font-size: 13px;
  line-height: 1.5;
  color: ${s("text")};
  background: ${s("backgroundSecondary")};
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  resize: vertical;
  tab-size: 2;

  &:focus {
    outline: none;
    border-color: ${s("inputBorderFocused")};
  }
`;

export default observer(MarkdownSourceDialog);
