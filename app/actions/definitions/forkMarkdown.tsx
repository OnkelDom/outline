import stores from "~/stores";
import { createAction } from "~/actions";
import { ActiveDocumentSection } from "~/actions/sections";
import MarkdownSourceDialog from "~/components/MarkdownSourceDialog";
import MarkdownIcon from "~/components/Icons/MarkdownIcon";

/*
 * Fork extension: Markdown source view and editing. Kept separate from the upstream action definitions so
 * that rebasing onto upstream only touches the lines where it is referenced.
 */

export const openDocumentMarkdownSource = createAction({
  name: ({ t, activeDocumentId }) =>
    activeDocumentId && stores.policies.abilities(activeDocumentId).update
      ? t("Edit as Markdown")
      : t("View Markdown"),
  analyticsName: "Open Markdown source",
  section: ActiveDocumentSection,
  keywords: "md markdown source raw edit view",
  icon: <MarkdownIcon />,
  visible: ({ activeDocumentId }) =>
    !!activeDocumentId && stores.policies.abilities(activeDocumentId).download,
  perform: ({ activeDocumentId, t }) => {
    const document = activeDocumentId
      ? stores.documents.get(activeDocumentId)
      : undefined;
    if (!document) {
      return;
    }

    stores.dialogs.openModal({
      title: t("Markdown"),
      width: "min(960px, 92vw)",
      content: (
        <MarkdownSourceDialog
          document={document}
          onRequestClose={stores.dialogs.closeAllModals}
        />
      ),
    });
  },
});
