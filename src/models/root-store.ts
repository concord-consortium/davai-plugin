import { types, Instance } from "mobx-state-tree";
import { AssistantModel } from "./assistant-model";
import { CODAPDocumentModel } from "./codap-document-model";

export const RootStore = types.model("RootStore", {
  assistantStore: AssistantModel,
  documentStore: CODAPDocumentModel,
});

export interface IRootStore extends Instance<typeof RootStore> {}
