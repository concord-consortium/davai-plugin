import React, { useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import * as Tone from "tone";

interface IDotPlotProps {
  data: string[]|number[];
  width?: number;
  height?: number;
}

export const UnivariateDotPlot: React.FC<IDotPlotProps> = ({data, width = 300, height = 150}) => {
  const [graphPoints, setGraphPoints] = useState<Array<{x: number, y: number, val: string|number}>>([]);
  const [isNumeric, setIsNumeric] = useState<boolean>(true);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const xScaleRef = useRef<d3.ScaleLinear<number, number> | d3.ScaleBand<string>|null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!data.length) return;
    const allNumeric = data.every(d => typeof d === "number");
    setIsNumeric(allNumeric);
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

      xScaleRef.current = xScale;

      const xValueCount: Record<string, number> = {};

      const points = sorted.map(val => {
        const xVal = xScale(val);
        const key = Math.round(xVal).toString();
        const countSoFar = xValueCount[key] || 0;
        xValueCount[key] = countSoFar + 1;

        const yPos = height - (countSoFar * (radius * spacing + 1) + 20);
        return { x: xVal, y: yPos, val };
      });
      setGraphPoints(points);

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

      xScaleRef.current = xScale;

      // Track how many times we've placed a dot for each category
      const categoryCounts: Record<string, number> = {};

      const points = stringData.map(cat => {
        const xCenter = (xScale(cat) || 0) + (xScale.bandwidth() / 2);
        const countSoFar = categoryCounts[cat] || 0;
        categoryCounts[cat] = countSoFar + 1;

        // y from bottom up
        const yPos = height - radius - (countSoFar * (radius * spacing + 1) + 20);
        return { x: xCenter, y: yPos, val: cat };
      });

      setGraphPoints(points);

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

  const handleSonify = useCallback(async () => {
    if (!svgRef.current || !graphPoints.length) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll(".scan-line").remove();

    const scanLine = svg.append("line")
      .attr("class", "scan-line")
      .attr("y1", 0)
      .attr("y2", height)
      .style("stroke", "red")
      .style("stroke-width", 2)
      .attr("x1", 0)
      .attr("x2", 0);

    const synth = new Tone.Synth().toDestination();
    const totalDuration = 3000;
    const startTime = performance.now();
    const endTime = startTime + totalDuration;

    const animate = (now: number) => {
      if (now >= endTime) {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
        return;
      }

      const elapsed = now - startTime;
      const t = elapsed / totalDuration;
      const currentX = t * width;

      scanLine
        .attr("x1", currentX)
        .attr("x2", currentX);

      // find points near currentX
      const delta = 5; // how wide to check
      const nearPoints = graphPoints.filter(p => Math.abs(p.x - currentX) < delta);

      if (nearPoints.length !== 0) {
        const count = nearPoints.length;
        const pitch = 100 + count * 50;
        synth.triggerAttackRelease(pitch, "8n");
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [graphPoints, width, height]);

  return (
    <div>
      <svg ref={svgRef} width={width} height={height} />
      <button onClick={handleSonify}>Sonify</button>
    </div>
  );
};
