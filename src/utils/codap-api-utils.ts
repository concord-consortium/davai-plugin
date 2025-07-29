import { codapInterface, IResult, getListOfDataContexts, getDataContext } from "@concord-consortium/codap-plugin-api";
import { ICODAPComponentListItem, IGraphAttrData } from "../types";
import { ICODAPGraphModel } from "../models/codap-graph-model";

export const getGraphComponents = async () => {
  const response = await codapInterface.sendRequest({ action: "get", resource: "componentList" }) as IResult;
  return response.values.filter((c: any) => c.type === "graph");
};

export const getGraphDetails = async () => {
  const graphs = await getGraphComponents();
  return Promise.all(graphs.map((g: ICODAPComponentListItem) => getGraphByID(`${g.id}`)));
};

export const getGraphByID = async (id: string) => {
  const response = await codapInterface.sendRequest({ action: "get", resource: `component[${id}]` }) as IResult;
  return response.values;
};

export const getTrimmedGraphDetails = async () => {
  const graphs = await getGraphDetails();
  return graphs.map((graph: ICODAPGraphModel) => {
    return trimGraphDetails(graph);
  });
};

// we use this to remove properties that the LLM doesn't need to know about
// in order to reduce the size of the prompt
export const trimGraphDetails = (graph: ICODAPGraphModel) => {
  const {
    backgroundColor,
    dimensions,
    enableNumberToggle,
    numberToggleLastMode,
    pointColor,
    pointSize,
    position,
    showConnectingLines,
    showMeasuresForSelection,
    strokeColor,
    strokeSameAsFill,
    transparent,
    ...trimmedGraph
  } = graph;

  return trimmedGraph;
};

const getAttributeData = async (graphID: string, attrID: string | null) => {
  if (!attrID) return { attributeData: null };

  const response = await Promise.resolve(codapInterface.sendRequest({
    action: "get",
    resource: `component[${graphID}].attribute[${attrID}]`
  })) as IResult;

  return response?.values
    ? {
        id: response.values.id,
        name: response.values.name,
        values: response.values._categoryMap.__order
      }
    : null;
};

export const getGraphAttrData = async (graphID: string) => {
  try {
    const graph = await getGraphByID(graphID);
    if (graph) {
      const legendAttrData = await getAttributeData(graphID, graph.legendAttributeID);
      const rightAttrData = await getAttributeData(graphID, graph.rightSplitAttributeID);
      const topAttrData = await getAttributeData(graphID, graph.topSplitAttributeID);
      const xAttrData = await getAttributeData(graphID, graph.xAttributeID);
      const yAttrData = await getAttributeData(graphID, graph.yAttributeID);
      const y2AttrData = await getAttributeData(graphID, graph.y2AttributeID);

      const graphAttrData: IGraphAttrData = {
        legend: { attributeData: legendAttrData },
        rightSplit: { attributeData: rightAttrData },
        topSplit: { attributeData: topAttrData },
        xAxis: { attributeData: xAttrData },
        yAxis: { attributeData: yAttrData },
        y2Axis: { attributeData: y2AttrData }
      };

      return graphAttrData;
    }
  } catch (err) {
    console.error("Failed to get graph attribute data:", err);
    return null;
  }
};

export const trimDataset = (dataset: any): any => {
  const newDataset = structuredClone(dataset);
  const removeCategoryMap = (collection: Record<string, any>) => {
    for (const attr of collection.attrs) {
      if (attr._categoryMap) {
        delete attr._categoryMap;
      }
    }
  };

  // Handle case where `collections` is on the root object
  if (Array.isArray(newDataset.collections)) {
    for (const collection of newDataset.collections) {
      if (!Array.isArray(collection.attrs)) continue;

      removeCategoryMap(collection);
    }
  }

  // Handle case where `collections` is nested under context keys
  for (const contextKey of Object.keys(newDataset)) {
    const context = newDataset[contextKey];
    const collections = context?.collections;
    if (!Array.isArray(collections)) continue;

    for (const collection of collections) {
      if (!Array.isArray(collection.attrs)) continue;

      removeCategoryMap(collection);
    }
  }

  return newDataset;
};

export const getDataContexts = async () => {
  const contexts = await getListOfDataContexts();
  const contextsDetails: Record<string, any> = {};
  for (const ctx of contexts.values) {
    const { name } = ctx;
    const ctxDetails = await getDataContext(name);
    const trimmedCtxDetails = trimDataset(ctxDetails.values);
    contextsDetails[name] = trimmedCtxDetails;
  }
  return contextsDetails;
};

export const sendCODAPRequest = async (request: any) => {
  const response = await codapInterface.sendRequest(request);
  return response;
};
