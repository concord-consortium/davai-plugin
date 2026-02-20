import { codapInterface, IResult, getListOfDataContexts, getDataContext } from "@concord-consortium/codap-plugin-api";
import { CodapItem, CodapItemValues, ICODAPComponentListItem, IGraphAttrData } from "../types";
import { ICODAPGraphModel } from "../models/codap-graph-model";

export const adornmentTypesOfInterest = ["Mean", "Median", "Standard Deviation"] as const;
export type AdornmentType = typeof adornmentTypesOfInterest[number];

export interface IAdornmentData {
  isVisible: boolean;
  max?: number;
  mean?: number;
  min?: number;
  type: AdornmentType;
  value?: number;
}

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

export const findAttributeCollectionInfo = (dataContext: any, attributeName: string) => {
  if (!dataContext.collections || !Array.isArray(dataContext.collections)) {
    return null;
  }

  let collectionIndex = -1;
  let collection: any = null;
  for (let index = 0; index < dataContext.collections.length; index++) {
    const _collection = dataContext.collections[index];
    for (const attr of _collection.attrs) {
      if (attr.name === attributeName) {
        collection = _collection;
        collectionIndex = index;
        break;
      }
    }
    if (collection) {
      break;
    }
  }

  if (collectionIndex === -1) {
    return null;
  }

  return { attributeName, collectionName: collection.name, collectionIndex, collection };
};

export const getAllCollectionCases = async (dataContextName: string, collectionName: string) => {
  const collectionResource = `dataContext[${dataContextName}].collection[${collectionName}]`;
  const allCasesResult = await codapInterface.sendRequest({
    action: "get",
    resource: `${collectionResource}.allCases`
  }) as IResult;
  if (!allCasesResult.success) {
    console.warn("Failed to get all cases for collection:", collectionResource);
    return [];
  }

  return allCasesResult.values.cases;
};

export const getCollectionItemsForAttribute = async (
  dataContext: any,
  attributeName: string
) => {
  const collectionInfo = findAttributeCollectionInfo(dataContext, attributeName);

  if (!collectionInfo) {
    return [];
  }

  const cases = await getAllCollectionCases(dataContext.name, collectionInfo.collectionName);
  const items: CodapItem[] = [];
  for (const caseItem of cases) {
    const c = caseItem.case;
    items.push({ id: String(c.id),
      values: {
        [attributeName]: c.values[attributeName]
      }
    });
  }

  return items;
};

/**
 * Fetch items for two attributes that may be in different collections within a data context.
 * It will return items for each case in the most nested collection with only the two
 * specified attributes.
 * Note the item ids will not be the real CODAP item ids, instead they are paths formed from
 * the case ids in each collection separated by slashes.
 *
 * @param dataContext
 * @param attribute1Name
 * @param attribute2Name
 * @returns
 */
export const getCollectionItemsForAttributePair = async (
  dataContext: any,
  attribute1Name: string,
  attribute2Name: string
) => {
  if (!dataContext.collections || !Array.isArray(dataContext.collections)) {
    return [];
  }

  // Find collections for the attributes
  let collectionInfo1 = findAttributeCollectionInfo(dataContext, attribute1Name);
  let collectionInfo2 = findAttributeCollectionInfo(dataContext, attribute2Name);

  if (!collectionInfo1 || !collectionInfo2) {
    return [];
  }
  const leastNested = collectionInfo1.collectionIndex < collectionInfo2.collectionIndex ? collectionInfo1 : collectionInfo2;
  const numCollectionsToTraverse = Math.abs(collectionInfo1.collectionIndex - collectionInfo2.collectionIndex) + 1;

  // Get all cases from the least nested down to the most nested collection.
  // And combine the attribute values from the 2 attributes we are interested in.
  let lastCollectionItems: Record<number, CodapItem> | null = null;
  for (let i = 0; i < numCollectionsToTraverse; i++) {
    const index = leastNested.collectionIndex + i;

    const cases = await getAllCollectionCases(dataContext.name, dataContext.collections[index].name);

    const currentCollection: Record<number, CodapItem> = {};
    for (const caseItem of cases) {
      const c = caseItem.case;
      const caseValues: CodapItemValues = {};
      let itemParentID = "";
      if (lastCollectionItems) {
        // Copy parent attribute values into this item
        Object.assign(caseValues, lastCollectionItems[c.parent].values);
        // Make a path out of the case ids to form the item id
        itemParentID = String(lastCollectionItems[c.parent].id) + "/";
      }
      if (collectionInfo1.collectionIndex === index) {
        caseValues[collectionInfo1.attributeName] = c.values[collectionInfo1.attributeName];
      }
      if (collectionInfo2.collectionIndex === index) {
        caseValues[collectionInfo2.attributeName] = c.values[collectionInfo2.attributeName];
      }
      currentCollection[c.id] = { id: itemParentID + String(c.id), values: caseValues };
    }
    lastCollectionItems = currentCollection;
  }

  // At this point lastCollection should have all of the attribute values and cases that we need
  // We convert it to an array so it matches the value of `getAllItems.values()`
  return lastCollectionItems ? Object.values(lastCollectionItems) : [];
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

export const getGraphAdornments = async (graphId: number): Promise<IAdornmentData[]> => {
  try {
    const listResponse = await codapInterface.sendRequest({
      action: "get",
      resource: `component[${graphId}].adornmentList`
    }) as IResult;

    if (!listResponse.success || !Array.isArray(listResponse.values)) {
      return [];
    }

    const visibleAdornments = listResponse.values.filter(
      (a: any) => a.isVisible && adornmentTypesOfInterest.includes(a.type)
    );

    const results: IAdornmentData[] = [];
    for (const adornment of visibleAdornments) {
      try {
        const detailResponse = await codapInterface.sendRequest({
          action: "get",
          resource: `component[${graphId}].adornment[${adornment.type}]`
        }) as IResult;

        if (!detailResponse.success || !detailResponse.values?.data?.[0]) {
          continue;
        }

        const data = detailResponse.values.data[0];

        switch (adornment.type) {
          case "Mean":
            results.push({
              type: "Mean",
              isVisible: true,
              value: data.mean
            });
            break;
          case "Median":
            results.push({
              type: "Median",
              isVisible: true,
              value: data.median
            });
            break;
          case "Standard Deviation":
            results.push({
              type: "Standard Deviation",
              isVisible: true,
              min: data.min,
              max: data.max,
              mean: data.mean
            });
            break;
        }
      } catch (err) {
        console.warn(`Failed to get adornment data for ${adornment.type}:`, err);
      }
    }

    return results;
  } catch (err) {
    console.warn("Failed to get graph adornments:", err);
    return [];
  }
};
