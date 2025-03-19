import React, { useRef, useEffect } from "react";
import * as d3 from "d3";

interface IDotPlotProps {
  data: string[]|number[];
  width?: number;
  height?: number;
}

export const UnivariateDotPlot: React.FC<IDotPlotProps> = ({data, width = 300, height = 150}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!data.length) return;
    const allNumeric = data.every(d => typeof d === "number");
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const radius = 4;
    const spacing = 1.5;

    if (allNumeric) {
      const numericData = data as number[];

      const sorted = [...numericData].sort((a, b) => a - b);
      const xDomain = d3.extent(sorted) as [number, number];

      const xScale = d3.scaleLinear()
        .domain(xDomain)
        .range([0, width]);

      const xValueCount: Record<string, number> = {};

      const points = sorted.map(val => {
        const xVal = xScale(val);
        const key = Math.round(xVal).toString();
        const countSoFar = xValueCount[key] || 0;
        xValueCount[key] = countSoFar + 1;

        const yPos = height - (countSoFar * (radius * spacing + 1) + 20);
        return { x: xVal, y: yPos };
      });

      svg
        .append("g")
        .selectAll("circle")
        .data(points)
        .enter()
        .append("circle")
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", radius)
        .style("fill", "steelblue");

      const xAxis = d3.axisBottom(xScale);
      svg
        .append("g")
        .attr("transform", `translate(0, ${height - 20})`)
        .call(xAxis);

    } else {
      const stringData = data.map(d => String(d));
      const categories = Array.from(new Set(stringData));
      categories.sort();
      console.log("categories", categories);

      const xScale = d3
        .scaleBand()
        .domain(categories)
        .range([20, width - 20])
        .padding(0.2);

      // Track how many times we've placed a dot for each category
      const categoryCounts: Record<string, number> = {};

      const points = stringData.map(cat => {
        const xCenter = (xScale(cat) || 0) + (xScale.bandwidth() / 2);
        const countSoFar = categoryCounts[cat] || 0;
        categoryCounts[cat] = countSoFar + 1;

        // y from bottom up
        const yPos = height - radius - (countSoFar * (radius * spacing + 1) + 20);
        return { x: xCenter, y: yPos };
      });

      svg
        .append("g")
        .selectAll("circle")
        .data(points)
        .enter()
        .append("circle")
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", radius)
        .style("fill", "steelblue");

      const xAxis = d3.axisBottom(xScale).tickValues(categories);
      svg
        .append("g")
        .attr("transform", `translate(0, ${height - 20})`)
        .call(xAxis);
    }
  }, [data, width, height]);

  return (
    <svg ref={svgRef} width={width} height={height} />
  );
};
