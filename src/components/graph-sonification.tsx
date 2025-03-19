import { codapInterface, getAllItems, IResult } from "@concord-consortium/codap-plugin-api";
import React, { useEffect, useState } from "react";
import { CodapItem } from "../types";
import { UnivariateDotPlot } from "./univariate-dot-plot-sonification";

interface IProps {
  componentsList: Record<string, any>[];
}

export const GraphSonification = ({componentsList}: IProps) => {
  const [graphOptions, setGraphOptions] = useState<Record<string, any>[]>([]);
  const [selectedGraph, setSelectedGraph] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<any>(null);

  useEffect(() => {
    const fetchGraphComponentDetails = async () => {
      const graphComponents = componentsList.filter((c) => c.type === "graph");
      const graphDetails = await Promise.all(graphComponents.map(async (c) => {
        const req = {action: "get", resource: `component[${c.name}]`};
        const res = await codapInterface.sendRequest(req) as IResult;
        return res.values;
      }));
      const univariateDotPlots = graphDetails.filter((c) => {
        const {xAttributeName, yAttributeName } = c;
        return (xAttributeName && !yAttributeName) || (!xAttributeName && yAttributeName);
      });
      setGraphOptions(univariateDotPlots);
    };
    fetchGraphComponentDetails();
  }, [componentsList]);

  useEffect(() => {
    const fetchGraphData = async () => {
      if (!selectedGraph) return;
      const graphDetails = graphOptions.find((g) => g.name === selectedGraph);
      if (!graphDetails) return;
      const attribute = graphDetails.xAttributeName || graphDetails.yAttributeName;
      const allItemsRes = await getAllItems(graphDetails.dataContext);
      const allItems = allItemsRes.values;
      const data = allItems.map((item: CodapItem) => {
        return item.values[attribute];
      });
      console.log("data", data);
      setGraphData(data);
    };
    fetchGraphData();
  }, [graphOptions, selectedGraph]);

  const handleGraphSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = event.target.value;
    setSelectedGraph(selectedValue);
  };

  return (
    <div>
      <select onChange={handleGraphSelection} value={selectedGraph || ""}>
        <option value="" disabled>
          Select a graph
        </option>
        {graphOptions.map((g, index) => (
          <option key={index} value={g.name}>
            {g.name}
          </option>
        ))}
      </select>
      {graphData &&
        <UnivariateDotPlot data={graphData}/>
      }
    </div>
  );
};
