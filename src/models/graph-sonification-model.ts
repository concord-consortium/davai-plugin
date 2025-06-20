import { flow, getRoot, getSnapshot, SnapshotIn, types } from "mobx-state-tree";
import { reaction } from "mobx";
import { CodapItem } from "../types";
import { getAllItems } from "@concord-consortium/codap-plugin-api";
import { removeRoiAdornment } from "../components/graph-sonification-utils";
import { CODAPGraphModel, ICODAPGraphModel } from "./codap-graph-model";
import { BinModel } from "./bin-model";
import { getGraphDetails, isGraphSonifiable, sendCODAPRequest } from "../utils/utils";

export const GraphSonificationModel = types
  .model("GraphSonificationModel", {
    allGraphs: types.optional(types.array(CODAPGraphModel), []),
    selectedGraphID: types.maybe(types.number),
    graphItems: types.maybe(types.array(types.frozen())),
    binValues: BinModel
  })
  .views((self) => ({
    get validGraphs() {
      return self.allGraphs?.filter((graph: ICODAPGraphModel) => isGraphSonifiable(graph)) || [];
    }
  }))
  .views((self) => ({
    get selectedGraph() {
      return self.validGraphs.find((graph: ICODAPGraphModel) => graph.id === self.selectedGraphID);
    }
  }))
  .views((self) => ({
    get isYPrimary() {
      return self.selectedGraph?.primaryAxis === "y" && self.selectedGraph?.plotType !== "scatterPlot"; // for scatterplot graphs, x is always considered primary
    }
  }))
  .views((self) => ({
    get primaryBounds() {
      return self.isYPrimary
        ? { upperBound: self.selectedGraph?.yUpperBound, lowerBound: self.selectedGraph?.yLowerBound }
        : { upperBound: self.selectedGraph?.xUpperBound, lowerBound: self.selectedGraph?.xLowerBound };
    },
    get secondaryBounds() {
      return self.isYPrimary
        ? { upperBound: self.selectedGraph?.xUpperBound, lowerBound: self.selectedGraph?.xLowerBound }
        : { upperBound: self.selectedGraph?.yUpperBound, lowerBound: self.selectedGraph?.yLowerBound };
    },
    get timeAttr() {
      return self.isYPrimary
        ? self.selectedGraph?.yAttributeName
        : self.selectedGraph?.xAttributeName;
    },
    get pitchAttr() {
      return self.isYPrimary
        ? self.selectedGraph?.xAttributeName
        : self.selectedGraph?.yAttributeName;
    }
  }))
  .views((self => ({
    get validItems() {
      if (!self.selectedGraph || !self.graphItems || !self.timeAttr) return [];
      const timeAttr = self.timeAttr;
      const pitchAttr = self.pitchAttr;

      const validItems = pitchAttr && timeAttr
        ? self.graphItems.filter((item: CodapItem) => item.values[pitchAttr] !== "" && item.values[timeAttr] !== "")
        : self.graphItems.filter((item: CodapItem) => item.values[timeAttr] !== "");

      return validItems;
    }
    })
  ))
  .views((self => ({
    get timeValues() {
      if (!self.timeAttr) return [];

      const timeAttr = self.timeAttr;
      return self.validItems.map((item: CodapItem) => item.values[timeAttr]);
    },
    get pitchFractions() {
      if (!self.pitchAttr) return [];

      const bounds = self.secondaryBounds;
      const { upperBound, lowerBound } = bounds;
      if (!upperBound || !lowerBound) return [];

      const pitchRange = upperBound - lowerBound || 1;
      const pitchAttr = self.pitchAttr;
      const pitchValues = self.validItems.map((item: CodapItem) => item.values[pitchAttr]);
      return pitchValues.map((value: number) => (value - lowerBound) / pitchRange);
    }
  })))
  .views((self) => ({
    get timeFractions() {
      const bounds = self.primaryBounds;
      const { upperBound, lowerBound } = bounds;
      if (!upperBound || !lowerBound) return [];

      const timeRange = upperBound - lowerBound || 1;
      return self.timeValues.map((value: number) => (value - lowerBound) / timeRange);
    },
  }))
  .actions((self) => ({
    clearGraphs() {
      self.allGraphs.replace([]);
    },
    setSelectedGraphID(graphID: number) {
      self.selectedGraphID = graphID;
    },
    removeSelectedGraphID() {
      self.selectedGraphID = undefined;
    },
    clearGraphItems() {
      self.graphItems = undefined;
    }
  }))
  .actions((self) => ({
    setGraphs: flow(function* (options?: { selectNewest?: boolean }) {
      const graphs: SnapshotIn<typeof CODAPGraphModel>[] = yield getGraphDetails();
      const incomingIDs = new Set<number>();

      const processedGraphs = yield Promise.all(graphs.map(async snapshot => {
        incomingIDs.add(snapshot.id);

        // Make sure the graph has a valid name and title. As a fallback, use the name of the
        // parent collection in the data context.
        if (!snapshot.title && !snapshot.name) {
          const response = await sendCODAPRequest({
            action: "get",
            resource: `dataContext[${snapshot.dataContext}]`
          }) as any;
          const dataContext = response.values;
          const parentCollection = dataContext.collections[0];
          snapshot.name = parentCollection?.name;
          snapshot.title = parentCollection?.name;
        }

        return snapshot;
      }));

      processedGraphs.forEach((graph: SnapshotIn<typeof CODAPGraphModel>) => {
        const existing = self.allGraphs.find(g => g.id === graph.id);
        if (existing) {
          existing.updatePropsFromSnapshot(graph);
        } else {
          self.allGraphs.push(CODAPGraphModel.create(graph));
          if (options?.selectNewest) {
            self.setSelectedGraphID(graph.id);
          }
        }
      });

      self.allGraphs.forEach((graph, index) => {
        if (!incomingIDs.has(graph.id)) {
          self.allGraphs.splice(index, 1);
        }
      });
    })
  }))
  .actions((self) => {
    // we call this function when:
    // 1. a new graph is selected for sonification
    // 2. we receive a data context change notification relevant to the selected graph
    const setGraphItems = flow(function* () {
      const dataContext = self.selectedGraph?.dataContext;
      if (!dataContext) return;
      const allItemsRes = yield getAllItems(dataContext);
      const allItems = allItemsRes.values;
      self.graphItems = allItems;
    });
    return { setGraphItems };
  })
  .actions((self) => ({
    afterCreate() {
      // clear selectedGraphID if it no longer points to a valid graph
      reaction(
        () => ({
          selectedGraphID: self.selectedGraphID,
          validGraphIDs: self.validGraphs.map(g => g.id)
        }),
        ({ selectedGraphID, validGraphIDs }) => {
          if (selectedGraphID !== undefined && !validGraphIDs.includes(selectedGraphID)) {
            removeRoiAdornment(`${selectedGraphID}`);
            self.removeSelectedGraphID();
          }
        }
      );

      reaction(
        () => self.selectedGraphID,
        (graphID) => {
          if (graphID !== undefined) {
            self.setGraphItems();
          } else {
            self.clearGraphItems();
          }
        }
      );

      reaction(
        () => self.allGraphs.map(g => getSnapshot(g)),
        (snapshots) => {
          const root = getRoot(self) as any;
          const msg = `Updated graph information: ${JSON.stringify(snapshots)}`;
          root.assistantStore.processAndSendCODAPDocumentInfo(msg);
        }
      );

      reaction(
        () => ({
          timeValues: self.timeValues
        }),
        ({ timeValues }) => {
          if (timeValues) {
            // update binValues based on timeValues
            self.binValues?.setValues(timeValues);
          }
        }
      );
    }
  }));

export type GraphSonificationModelType = typeof GraphSonificationModel.Type;
