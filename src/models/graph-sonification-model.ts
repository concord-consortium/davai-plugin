import { addDisposer, applySnapshot, flow, Instance, SnapshotIn, types } from "mobx-state-tree";
import { reaction } from "mobx";
import { Attribute, CodapItem, CodapItemValues } from "../types";
import { sendMessage, createTable, createItems, getDataContext } from "@concord-consortium/codap-plugin-api";
import { CODAPGraphModel, ICODAPGraphModel } from "./codap-graph-model";
import { BinModel } from "./bin-model";
import { sendCODAPRequest, getGraphDetails, trimDataset, getCollectionItemsForAttributePair, getCollectionItemsForAttribute, getGraphAdornments, IAdornmentData } from "../utils/codap-api-utils";
import { removeRoiAdornment, isGraphSonifiable } from "../utils/graph-sonification-utils";
import { leastSquaresLinearRegression } from "../utils/graph-utils";

export interface ISonificationDataItem {
  [attr: string]: number[];
}

/**
 * A structure to hold sonification data for different sonifications
 * at different time points. Each time point can have multiple values for
 * each sonification (for example, if multiple data points fall within the same
 * time bin). The main type of data are frequencies, but some sonifications
 * provide also raw values (e.g. LOESS values) for debugging purposes.
 */
export interface ISonificationData {
  items: Record<number, ISonificationDataItem>;
}

export const GraphSonificationModel = types
  .model("GraphSonificationModel", {
    allGraphs: types.map(CODAPGraphModel),
    selectedGraphID: types.maybe(types.number),
    graphItems: types.maybe(types.array(types.frozen())),
    binValues: BinModel
  })
  .volatile((self) => ({
    // a place to store the resulting frequencies and other data from
    // sonification calculations it is only used for debugging.
    sonificationData: undefined as ISonificationData | undefined,
    adornmentData: undefined as IAdornmentData[] | undefined
  }))
  .views((self) => ({
    get validGraphs() {
      return Array.from(self.allGraphs.values())
        .filter((graph: ICODAPGraphModel) => isGraphSonifiable(graph)) || [];
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
    get points() {
      const { timeAttr, pitchAttr } = self;
      if (!timeAttr || !pitchAttr) return [];

      return self.validItems.map((item: CodapItem) => ({
        x: item.values[timeAttr],
        y: item.values[pitchAttr]
      }));
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
    get leastSquaresLinearRegression() {
      return leastSquaresLinearRegression(self.points, false);
    }
  }))
  .actions((self) => ({
    clearGraphs() {
      self.allGraphs.replace([]);
    },
    setSelectedGraphID(graphID?: number) {
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

      const processedGraphs = yield Promise.all(graphs.map(async snapshot => {
        // Make sure the graph has a valid name and title. As a fallback, use the name of the
        // parent collection in the data context.
        if (!snapshot.title && !snapshot.name) {
          const response = await sendCODAPRequest({
            action: "get",
            resource: `dataContext[${snapshot.dataContext}]`
          }) as any;
          const dataContext = response.values;
          // Note: When a user adds a new graph to CODAP and there is more than one data context
          // the new graph will not have a data context
          const parentCollection = dataContext.collections?.[0];
          snapshot.name = parentCollection?.name;
          snapshot.title = parentCollection?.name;
        }

        return snapshot;
      }));

      // Find the last graph that didn't already exist in allGraphs
      // This "newest" graph is used if the selectNewest option is enabled
      let newestGraphId = -1;
      for (let index=processedGraphs.length - 1; index >= 0; index--) {
        const graph = processedGraphs[index];
        if (!self.allGraphs.get(String(graph.id))) {
          newestGraphId = graph.id;
          break;
        }
      }

      const allGraphsSnapshot: SnapshotIn<typeof self.allGraphs> = {};
      processedGraphs.forEach((graph: SnapshotIn<typeof CODAPGraphModel>) => {
        allGraphsSnapshot[String(graph.id)] = graph;
      });
      applySnapshot(self.allGraphs, allGraphsSnapshot);

      if (options?.selectNewest && newestGraphId !== -1) {
        self.setSelectedGraphID(newestGraphId);
      }
    })
  }))
  .actions((self) => {
    // we call this function when:
    // 1. a new graph is selected for sonification
    // 2. we receive a data context change notification relevant to the selected graph
    const setGraphItems = flow(function* () {
      const dataContext = self.selectedGraph?.dataContext;
      if (!dataContext || !self.timeAttr) return;

      const dataContextResult = yield getDataContext(dataContext);
      const dataContextFullObj = dataContextResult.values;
      const dataContextObj = trimDataset(dataContextFullObj);

      if (self.pitchAttr) {
        // Get all items for the two attributes (time and pitch)
        self.graphItems = yield getCollectionItemsForAttributePair(dataContextObj, self.timeAttr, self.pitchAttr);
      } else {
        // Univariate graph - get items for the time attribute only
        self.graphItems = yield getCollectionItemsForAttribute(dataContextObj, self.timeAttr);
      }
    });
    const setAdornments = flow(function* () {
      const graphId = self.selectedGraphID;
      if (graphId === undefined) {
        self.adornmentData = undefined;
        return;
      }
      self.adornmentData = yield getGraphAdornments(graphId);
    });

    return { setGraphItems, setAdornments };
  })
  .actions((self) => ({
    setSonificationData(data: ISonificationData) {
      self.sonificationData = data;
    },
    createCODAPSonificationTable: flow(function* () {
      if (!self.sonificationData) return;

      // Create a new CODAP dataset with the frequency table data
      const attributeSet = new Set<string>();
      Object.values(self.sonificationData.items).forEach(item => {
        Object.keys(item).forEach(attr => {
          attributeSet.add(attr);
        });
      });
      const attributes: Attribute[] = Array.from(attributeSet).map(attrName => ({
        name: attrName,
        type: "numeric"
      }));
      const contextName = `Sonification Table ${new Date().toISOString()}`;
      const dataContextResult: {
        success: boolean,
        values: {
          name: string,
          title?: string,
          id: number
        }
      } = yield sendMessage("create", `dataContext`, {
        name: contextName,
        title: contextName,
        collections: [
          {
            name: "Cases",
            attrs: [
              { name: "time", type: "numeric" },
              ...attributes
            ]
          }
        ]
      });

      const codapItems: CodapItemValues[] = [];
      Object.entries(self.sonificationData.items).forEach(([time, freqItem]) => {
        // There can be multiple items at the same time for a single sonification.
        // So each time point can have multiple codap items.
        // We start with a single item and add more if needed.
        const itemsAtTime: CodapItemValues[] = [
          { time: Number(time) }
        ];
        Object.entries(freqItem).forEach(([sonificationName, values]) => {
          // There can be multiple frequencies for a sonification at the same time.
          values.forEach((freq, index) => {
            let itemValues = itemsAtTime[index];
            if (!itemValues) {
              itemValues = { time: Number(time) };
              itemsAtTime.push(itemValues);
            }
            itemValues[sonificationName] = freq;
          });
        });
        itemsAtTime.forEach((itemValues) => {
          codapItems.push(itemValues);
        });
      });
      yield createItems(String(dataContextResult.values.id), codapItems);

      yield createTable(String(dataContextResult.values.id));
    })
  }))
  .actions((self) => ({
    afterCreate() {
      const disposers: (() => void)[] = [];

      // Clear selectedGraphID if it no longer points to a valid graph.
      disposers.push(reaction(
        () => ({
          selectedGraphID: self.selectedGraphID,
          validGraphIDs: self.validGraphs.map(g => g.id)
        }),
        ({ selectedGraphID, validGraphIDs }) => {
          if (selectedGraphID !== undefined && !validGraphIDs.includes(selectedGraphID)) {
            removeRoiAdornment(selectedGraphID);
            self.removeSelectedGraphID();
          }
        }
      ));

      // Fetch graphItems when a new graph is selected, or clear them when deselected.
      disposers.push(reaction(
        () => self.selectedGraphID,
        (graphID) => {
          if (graphID !== undefined) {
            self.setGraphItems();
          } else {
            self.clearGraphItems();
          }
        }
      ));

      // Re-fetch graphItems when the selected graph's attributes change.
      // Tracks graphId so we can skip when the graph selection itself changed,
      // since the selectedGraphID reaction above already handles that case.
      disposers.push(reaction(
        () => ({
          timeAttr: self.timeAttr,
          pitchAttr: self.pitchAttr,
          graphId: self.selectedGraphID
        }),
        (curr, prev) => {
          if (curr.graphId !== undefined && curr.graphId === prev?.graphId) {
            self.setGraphItems();
          }
        }
      ));

      // Keep binValues in sync with the current timeValues for univariate sonification.
      disposers.push(reaction(
        () => ({
          timeValues: self.timeValues
        }),
        ({ timeValues }) => {
          if (timeValues) {
            const allNumbers = timeValues.every(v => typeof v === "number");
            if (!allNumbers) {
              console.warn("Non-numeric time values found, cannot update binValues");
              return;
            }
            self.binValues.setValues(timeValues);
          }
        }
      ));

      addDisposer(self, () => disposers.forEach(d => d()));
    }
  }));

export interface GraphSonificationModelType extends Instance<typeof GraphSonificationModel> {}
