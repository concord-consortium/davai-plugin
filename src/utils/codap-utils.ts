import { codapInterface, getAttribute } from "@concord-consortium/codap-plugin-api";
import { IResult } from "./codap-api-helpers";

export const getCodapAttribute = async (dataContextName: string, collectionName: string, attributeName: string) => {
  const attribute = await getAttribute(dataContextName, collectionName, attributeName);
  return attribute;
};

export const createGraph = async (dataContextName: string, graphName: string, xAttribute: string, yAttribute: string) => {
  const graph = {
    "action": "create",
    "resource": "component",
    "values": {
      "type": "graph",
      "name": graphName,
      "dataContext": dataContextName,
      "xAttributeName": xAttribute,
      "yAttributeName": yAttribute
    }
  };

  const res = await codapInterface.sendRequest(graph) as any as IResult;
  return { requestMessage: graph, ...res };
};
