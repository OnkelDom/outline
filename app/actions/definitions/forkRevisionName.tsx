import { BookmarkIcon } from "outline-icons";
import { RevisionHelper } from "@shared/utils/RevisionHelper";
import stores from "~/stores";
import { createAction } from "~/actions";
import { RevisionSection } from "~/actions/sections";
import RevisionNameDialog from "~/components/RevisionNameDialog";

/*
 * Fork extension: named versions. Kept separate from the upstream action definitions so
 * that rebasing onto upstream only touches the lines where it is referenced.
 */

/**
 * Creates an action that opens a dialog to name a revision.
 *
 * @param revisionId the id of the revision.
 * @returns the action.
 */
export const nameRevisionActionFactory = (revisionId: string) =>
  createAction({
    name: ({ t }) => {
      const revision = stores.revisions.get(revisionId);
      return revision?.name ? t("Rename version") : t("Name version");
    },
    analyticsName: "Name revision",
    section: RevisionSection,
    icon: <BookmarkIcon />,
    visible: ({ activeDocumentId }) =>
      !!activeDocumentId &&
      !RevisionHelper.documentIdFromLatestId(revisionId) &&
      stores.policies.abilities(activeDocumentId).update,
    perform: ({ t }) => {
      const revision = stores.revisions.get(revisionId);
      if (!revision) {
        return;
      }

      stores.dialogs.openModal({
        title: t("Name version"),
        content: (
          <RevisionNameDialog
            revision={revision}
            onSubmit={stores.dialogs.closeAllModals}
          />
        ),
      });
    },
  });
