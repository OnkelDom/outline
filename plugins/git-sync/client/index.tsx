import { createLazyComponent } from "~/components/LazyLoad";
import { Hook, PluginManager } from "~/utils/PluginManager";
import config from "../plugin.json";
import Icon from "./Icon";

PluginManager.add([
  {
    ...config,
    type: Hook.Settings,
    value: {
      group: "Integrations",
      icon: Icon,
      description:
        "Connect collections to Git repositories. Documents are committed as Markdown in the background and changes made in Git flow back.",
      component: createLazyComponent(() => import("./Settings")),
    },
  },
]);
