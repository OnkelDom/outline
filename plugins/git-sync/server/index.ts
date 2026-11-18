import { Hook, PluginManager } from "@server/utils/PluginManager";
import config from "../plugin.json";
import gitSync from "./api/gitSync";
import GitSyncProcessor from "./processors/GitSyncProcessor";
import GitSyncPollTask from "./tasks/GitSyncPollTask";
import GitSyncTask from "./tasks/GitSyncTask";

PluginManager.add([
  {
    ...config,
    type: Hook.API,
    value: gitSync,
  },
  {
    type: Hook.Processor,
    value: GitSyncProcessor,
  },
  {
    type: Hook.Task,
    value: GitSyncTask,
  },
  {
    type: Hook.Task,
    value: GitSyncPollTask,
  },
]);
