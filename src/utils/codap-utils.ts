import { codapInterface, getAttribute } from "@concord-consortium/codap-plugin-api";

export const getCodapAttribute = async (dataContextName: string, collectionName: string, attributeName: string) => {
  const attribute = await getAttribute(dataContextName, collectionName, attributeName);
  return attribute;
};

export const createGraph = async (dataContext: any, graphName: string, xAttribute: string, yAttribute: string) => {
  const graph = {
    "action": "create",
    "resource": "component",
    "values": {
      "type": "graph",
      "name": graphName,
      "dataContext": dataContext.values.name,
      "xAttributeName": xAttribute,
      "yAttributeName": yAttribute
    }
  };
  
  return await codapInterface.sendRequest(graph);
};
