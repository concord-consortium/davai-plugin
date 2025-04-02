import { codapInterface, getAllItems } from "@concord-consortium/codap-plugin-api";
import React, { useEffect, useRef, useState } from "react";
import { CodapItem } from "../types";
import * as Tone from "tone";

interface IProps {
  graphOptions: Record<string, any>[];
}

export const GraphSonification = ({graphOptions}: IProps) => {
  const [selectedGraph, setSelectedGraph] = useState<string | null>(null);
  const [selectedGraphId, setSelectedGraphId] = useState<string | null>(null);
  const [showPlayButton, setShowPlayButton] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const [pitchValues, setPitchValues] = useState<number[]>([]);
  const [timeValues, setTimeValues] = useState<number[]>([]);

  const [timeFractions, setTimeFractions] = useState<number[]>([]);
  const [pitchFractions, setPitchFractions] = useState<number[]>([]);

   const synthRef = useRef<Tone.PolySynth | null>(null);
   if (!synthRef.current) {
     synthRef.current = new Tone.PolySynth().toDestination();
   }

  useEffect(() => {
    const fetchGraphData = async () => {
      if (!selectedGraph) return;

      const graphDetails = graphOptions.find((g) => g.name === selectedGraph);
      console.log("graphDetails", graphDetails);
      if (!graphDetails) return;

      setSelectedGraphId(graphDetails.id);
      codapInterface.sendRequest(
        {
          action: "create",
          resource: `component[${graphDetails.id}].adornment`,
          values: {
            type: "Region of Interest",
            width: { "unit": "percent", "value": .1 },
            xPosition: { "unit": "percent", "value": 0 },
          }
      });

      const pitchAttr = graphDetails.yAttributeName;
      const timeAttr = graphDetails.xAttributeName;

      const allItemsRes = await getAllItems(graphDetails.dataContext);
      const allItems = allItemsRes.values;

      const pitchData = allItems.map((item: CodapItem) => item.values[pitchAttr] || 0);
      const timeData = allItems.map((item: CodapItem) => item.values[timeAttr] || 0);

      setPitchValues(pitchData);
      setTimeValues(timeData);
    };
    fetchGraphData();
  }, [graphOptions, selectedGraph]);

  useEffect(() => {
    if (timeValues.length === 0) return;
    const graphDetails = graphOptions.find((g) => g.name === selectedGraph);
    if (!graphDetails) return;
    const minTime = graphDetails.xLowerBound;
    const maxTime = graphDetails.xUpperBound;
    const timeRange = maxTime - minTime || 1; // prevent divide-by-zero

    const minPitch = graphDetails.yLowerBound;
    const maxPitch = graphDetails.yUpperBound;
    const pitchRange = maxPitch - minPitch || 1;

    const timeFracs = timeValues.map((t) => (t - minTime) / timeRange);
    const pitchFracs = pitchValues.map((p) => (p - minPitch) / pitchRange);

    setTimeFractions(timeFracs);
    setPitchFractions(pitchFracs);

  }, [timeValues, pitchValues, graphOptions, selectedGraph]);

  const handleGraphSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = event.target.value;
    setSelectedGraph(selectedValue);
    setShowPlayButton(true);
  };

  const handleSonifyGraph = async () => {
    if (!selectedGraph) return;
    if (isPlaying) {
      setIsPlaying(false);
      Tone.getTransport().cancel();
      Tone.getTransport().stop();
      Tone.getTransport().position = 0;
      return;
    }

    await Tone.start();
    setIsPlaying(true);
    Tone.getTransport().cancel();
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;

    const totalDuration = 10;

    const fractionGroups: Record<number, number[]> = {};
    timeFractions.forEach((frac, i) => {
      if (!fractionGroups[frac]) fractionGroups[frac] = [];
      fractionGroups[frac].push(i);
    });

    const uniqueFractions = Object.keys(fractionGroups)
      .map(parseFloat)
      .sort((a, b) => a - b);

    uniqueFractions.forEach((fraction) => {
      const offsetSeconds = fraction * totalDuration;
      Tone.getTransport().scheduleOnce((time) => {
        const indices = fractionGroups[fraction];
        indices.forEach((i) => {
          const pFrac = pitchFractions[i];
          const freq = 220 + pFrac * (880 - 220);
          synthRef.current?.triggerAttackRelease(freq, "8n", time);
        });
      }, offsetSeconds);
    });

    Tone.getTransport().start();
    animateROI(totalDuration);
  };

  function animateROI(durationSecs: number) {
    let frameId: number;
    const step = () => {
      const elapsed = Tone.getTransport().seconds;
      const fraction = Math.min(elapsed / durationSecs, 1);

      codapInterface.sendRequest({
        action: "update",
        resource: `component[${selectedGraphId}].adornment`,
        values: {
          type: "Region of Interest",
          xPosition: { unit: "percent", value: fraction * 100 }
        }
      });

      if (fraction < 1) {
        frameId = requestAnimationFrame(step);
      } else {
        cancelAnimationFrame(frameId);
        setIsPlaying(false);
        codapInterface.sendRequest({
          action: "update",
          resource: `component[${selectedGraphId}].adornment`,
          values: {
            type: "Region of Interest",
            xPosition: { unit: "percent", value: 0 }
          }
        });
        Tone.getTransport().stop();
      }
    };
    frameId = requestAnimationFrame(step);
  }

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
      {showPlayButton && (
        <button onClick={handleSonifyGraph}>
          {isPlaying ? "Stop" : "Sonify Graph"}
        </button>

      )}
    </div>
  );
};
