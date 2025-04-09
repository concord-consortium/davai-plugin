import { codapInterface } from "@concord-consortium/codap-plugin-api";

export const updateRoiAdornment = async (graphName: string, fraction: number) => {
  await codapInterface.sendRequest({
    action: "update",
    resource: `component[${graphName}].adornment`,
    values: {
      type: "Region of Interest",
      primary: { "position": `${fraction * 100}%`, "extent": 0.05 }
    }
  });
};

export const removeRoiAdornment = async (graphId: string) => {
  await codapInterface.sendRequest({
    action: "delete",
    resource: `component[${graphId}].adornment`,
    values: { type: "Region of Interest" }
  });
};
