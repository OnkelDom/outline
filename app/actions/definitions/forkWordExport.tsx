import { DocumentIcon, DownloadIcon } from "outline-icons";
import { toast } from "sonner";
import { ExportContentType } from "@shared/types";
import stores from "~/stores";
import type { ActionContext } from "~/types";
import { createAction } from "~/actions";
import { ActiveDocumentSection, RevisionSection } from "~/actions/sections";

/*
 * Fork extension: Word export. Kept separate from the upstream action definitions so
 * that rebasing onto upstream only touches the lines where it is referenced.
 */

/** Shows a file extension at the end of menu items only. */
const fileExtensionHint =
  (extension: string) =>
  ({ isMenu }: ActionContext) =>
    isMenu ? extension : undefined;

export const downloadDocumentAsDocx = createAction({
  name: ({ t, isMenu }) => (isMenu ? t("Word") : t("Download as Word")),
  analyticsName: "Download document as Word",
  section: ActiveDocumentSection,
  badge: fileExtensionHint(".docx"),
  keywords: "word docx office export download",
  icon: <DocumentIcon />,
  iconInContextMenu: false,
  visible: ({ activeDocumentId }) =>
    !!activeDocumentId && stores.policies.abilities(activeDocumentId).download,
  perform: async ({ activeDocumentId, t }) => {
    if (!activeDocumentId) {
      return;
    }

    const document = stores.documents.get(activeDocumentId);
    const id = toast.loading(`${t("Exporting")}…`);
    try {
      await document?.download({
        contentType: ExportContentType.Docx,
        includeChildDocuments: false,
      });
    } finally {
      toast.dismiss(id);
    }
  },
});

/**
 * Creates an action that downloads a revision as a Word document.
 *
 * @param revisionId the id of the revision.
 * @returns the action.
 */
export const downloadRevisionAsDocxActionFactory = (revisionId: string) =>
  createAction({
    name: ({ t }) => t("Word"),
    analyticsName: "Download revision as Word",
    section: RevisionSection,
    keywords: "word docx export",
    icon: <DownloadIcon />,
    iconInContextMenu: false,
    visible: ({ activeDocumentId }) =>
      !!activeDocumentId &&
      stores.policies.abilities(activeDocumentId).download,
    perform: ({ t }) => {
      const id = toast.loading(`${t("Exporting")}…`);
      const revision = stores.revisions.get(revisionId);
      return revision
        ?.download(ExportContentType.Docx)
        .finally(() => id && toast.dismiss(id));
    },
  });
