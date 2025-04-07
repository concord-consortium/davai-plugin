import React from "react";

import "./graph-sonification-controls.scss";

interface IProps {
  availableGraphs: string[];
  graphToSonify: string;
  onSelectGraph: (graphName: string) => void;
  onSonifyGraph: () => void;
}

export const GraphSonificationControls = ({ availableGraphs, graphToSonify, onSelectGraph, onSonifyGraph }: IProps) => {

  return (
    <div className="graph-sonification-controls">
      <select id="graph-select" value={graphToSonify} onChange={(e) => onSelectGraph(e.target.value)}>
        <option value="">Select a graph...</option>
        {availableGraphs.map((graph) => (
          <option key={graph} value={graph}>
            {graph}
          </option>
        ))}
      </select>
    </div>
  );
};
