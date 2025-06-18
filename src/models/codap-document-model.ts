import { Instance, types, flow, getRoot } from "mobx-state-tree";
import {
  getDataContext,
  getListOfDataContexts,
  codapInterface,
  ClientNotification,
  addDataContextChangeListener,
} from "@concord-consortium/codap-plugin-api";
import { IRootStore } from "./root-store";
import { GraphSonificationModel } from "./graph-sonification-model";

// Define the Attribute model
export const AttributeModel = types.model("Attribute", {
  id: types.identifierNumber,
  name: types.string,
  title: types.maybe(types.string),
  description: types.maybe(types.string),
  type: types.maybe(types.string),
  precision: types.maybe(types.number),
  unit: types.maybe(types.string),
  formula: types.maybe(types.string),
  editable: types.maybe(types.boolean),
  renameable: types.maybe(types.boolean),
  deleteable: types.maybe(types.boolean),
  hidden: types.maybe(types.boolean),
  cid: types.maybe(types.string),
});

// Define the Collection model
export const CollectionModel = types.model("Collection", {
  id: types.identifierNumber,
  name: types.string,
  title: types.maybe(types.string),
  description: types.maybe(types.string),
  attrs: types.array(AttributeModel),
  parent: types.maybe(types.number),
  labels: types.maybe(types.model({
    singleCase: types.maybe(types.string),
    pluralCase: types.maybe(types.string),
    singleCaseWithArticle: types.maybe(types.string),
    pluralCaseWithArticle: types.maybe(types.string),
    setOfCases: types.maybe(types.string),
    setOfCasesWithArticle: types.maybe(types.string),
  })),
  caseName: types.maybe(types.string),
  childAttrName: types.maybe(types.string),
  collapseChildren: types.maybe(types.boolean),
  areParentChildLinksConfigured: types.maybe(types.boolean),
});

// Define the Case model
export const CaseModel = types.model("Case", {
  id: types.identifierNumber,
  parent: types.maybe(types.number),
  collection: types.maybe(types.model({
    name: types.string,
    id: types.number,
  })),
  values: types.frozen(),
});

// Define the Global Value model
export const GlobalValueModel = types.model("GlobalValue", {
  id: types.identifierNumber,
  name: types.string,
  value: types.frozen(),
  description: types.maybe(types.string),
});

// Define the Component model (base)
export const ComponentModel = types.model("Component", {
  id: types.identifierNumber,
  name: types.maybe(types.string),
  title: types.maybe(types.string),
  type: types.string,
  cannotClose: types.maybe(types.boolean),
  dimensions: types.maybe(types.model({
    width: types.number,
    height: types.number,
  })),
  position: types.maybe(types.model({
    left: types.number,
    top: types.number,
  })),
});

// Define the DataContext model
export const DataContextModel = types.model("DataContext", {
  id: types.identifierNumber,
  name: types.string,
  title: types.maybe(types.string),
  description: types.maybe(types.string),
  collections: types.array(CollectionModel),
  metadata: types.maybe(types.frozen()),
});

// Main CODAP Document model
export const CODAPDocumentModel = types.model("CODAPDocument", {
  dataContexts: types.map(DataContextModel),
  nonGraphComponents: types.map(ComponentModel),
  graphStore: GraphSonificationModel,
  globalValues: types.map(GlobalValueModel),
  lastUpdated: types.maybe(types.Date),
})
.views((self) => ({
  getDocumentSummary() {
    const summary = {
      dataContexts: Array.from(self.dataContexts.values()).map(ctx => ({
        id: ctx.id,
        name: ctx.name,
        title: ctx.title,
        collections: ctx.collections.map(coll => ({
          id: coll.id,
          name: coll.name,
          title: coll.title,
          attributes: coll.attrs.map(attr => ({
            id: attr.id,
            name: attr.name,
            title: attr.title,
            type: attr.type,
          })),
        })),
      })),
      components: [
        ...Array.from(self.graphStore.allGraphs.values()),
        ...Array.from(self.nonGraphComponents.values())
      ],
      globalValues: Array.from(self.globalValues.values()).map(gv => ({
        id: gv.id,
        name: gv.name,
        value: gv.value,
      }))
    };

    return `CODAP Document State: ${JSON.stringify(summary, null, 2)}`;
  },

  getDataContextByName(name: string) {
    return self.dataContexts.get(name);
  },

  getComponentById(id: string) {
    return self.nonGraphComponents.get(id);
  },

  getGlobalValueByName(name: string) {
    return Array.from(self.globalValues.values()).find(gv => gv.name === name);
  }
}))
.actions((self) => ({
  updateDataContext: flow(function* (notification: ClientNotification) {
    try {
      const resource = notification.resource;
      const dataContextName = resource.replace("dataContextChangeNotice[", "").replace("]", "");

      // Refresh the data context
      const contextResponse = yield getDataContext(dataContextName);
      if (contextResponse.success) {
        const contextData = contextResponse.values;
        self.dataContexts.set(dataContextName, DataContextModel.create(contextData));
      }

      // resource is in the form of "dataContextChangeNotice[<dataContextName>]";
      // the dataContext name isn't otherwise available in the notification object
      const dataCtxName = notification.resource.replace("dataContextChangeNotice[", "").replace("]", "");
      const selectedGraph = self.graphStore.selectedGraph;
      if (dataCtxName === selectedGraph?.dataContext) {
        // update the graph items
        self.graphStore.setGraphItems();
      }

      const summary = self.getDocumentSummary();
      const rootStore = getRoot(self) as IRootStore;
      rootStore.assistantStore.sendCODAPDocumentInfo(summary);

    } catch (err) {
      console.error("Failed to handle data context change notification:", err);
    }
  }),
  updateComponent: flow(function* (notification: ClientNotification) {
    if (notification.values.type === "graph") {
      // const prevGraphIDs = self.graphStore.allGraphs.map(g => g.id);
      yield self.graphStore.setGraphs();

      // const newGraphIDs = self.graphStore.allGraphs.map(g => g.id);

      // if (notification.values.operation === "create") {
      //   const newGraphID = newGraphIDs.find(id => !prevGraphIDs.includes(id));
      //   if (newGraphID !== undefined) {
      //     newlyCreatedGraphRef.current = newGraphID;
      //   }
      // }

      // // If this is an attribute change on a newly-added graph, and the graph is sonifiable, automatically set it as selected.
      // if (notification.values.operation === "attributeChange" && newlyCreatedGraphRef.current !== null) {
      //   try {
      //     const graphs = yield getGraphDetails();
      //     const graph = graphs.find((g: ICODAPGraph) => g.id === notification.values.id);
      //     if (graph && isGraphSonifiable(graph) && graph.id === newlyCreatedGraphRef.current) {
      //       sonificationStore.setSelectedGraphID(graph.id);
      //       newlyCreatedGraphRef.current = null;
      //     }
      //   } catch (error) {
      //     console.error("Failed to fetch graph details for auto-selection:", error);
      //   }
      // }``
    }
  })
}))
.actions((self) => ({
  initializeDataContexts: flow(function* () {
    try {
      // Load all data contexts
      const contextsResponse = yield getListOfDataContexts();
      const contextNames = contextsResponse.values.map((ctx: any) => ctx.name);

      for (const contextName of contextNames) {
        if (!self.dataContexts.has(contextName)) {
          addDataContextChangeListener(contextName, self.updateDataContext);
        }
        const contextResponse = yield getDataContext(contextName);
        if (contextResponse.success) {
          const contextData = contextResponse.values;
          self.dataContexts.set(contextName, DataContextModel.create(contextData));
        }
      }
    } catch (err) {
      console.log("Error:", err);
    }
  }),
  initializeComponents: flow(function* () {
    const componentsResponse = yield codapInterface.sendRequest({
      action: "get",
      resource: "componentList"
    });
    if (componentsResponse.success && componentsResponse.values) {
      componentsResponse.values.forEach((component: any) => {
        if (component.type === "graph") return; // graphs are handled separately
        self.nonGraphComponents.set(String(component.id), ComponentModel.create(component));
      });
    }
  })
}))
.actions((self) => {
  const initializeDocument = flow(function* () {
    try {
      yield self.initializeDataContexts();
      yield self.graphStore.setGraphs();
      yield self.initializeComponents();
    } catch (err) {
      console.error("Failed to initialize CODAP document:", err);
    }
  });

  return {
    initializeDocument,
    initializeDataContexts: self.initializeDataContexts,
  };
})

export interface ICODAPDocumentModel extends Instance<typeof CODAPDocumentModel> {}