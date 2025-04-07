import { codapInterface, getAllItems, IResult } from "@concord-consortium/codap-plugin-api";
import React, { useEffect, useRef } from "react";
import * as Tone from "tone";
import { CodapItem } from "../types";

interface IProps {
  graphToSonify: string;
  isSonificationPlaying: boolean;
  onResetGraphToSonify: () => void;
}

export const GraphSonification = ({ graphToSonify, isSonificationPlaying, onResetGraphToSonify }: IProps) => {
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const pannerRef = useRef<Tone.Panner | null>(null);

  if (!pannerRef.current) {
    pannerRef.current = new Tone.Panner(0).toDestination();
  }

  if (!synthRef.current) {
    synthRef.current = new Tone.PolySynth().connect(pannerRef.current);
  }

  useEffect(() => {
    const fetchGraphData = async () => {

      // Get the graph data
      const res = await codapInterface.sendRequest({action: "get", resource: `component[${graphToSonify}]`}) as IResult;
      const graphDetails = res.values;
      if (!graphDetails) return;

      codapInterface.sendRequest({
        action: "create",
        resource: `component[${graphDetails.id}].adornment`,
        values: {
          type: "Region of Interest",
          primary: { "position": 0, "extent": .1 },
          secondary: { "position": 0, "extent": "100%" }
        }
      });

      const primaryAttribute = graphDetails.xAttributeName || graphDetails.yAttributeName;
      if (!primaryAttribute) return;

      const secondaryAttribute = primaryAttribute !== graphDetails.yAttributeName
        ? graphDetails.yAttributeName
        : graphDetails.xAttributeName;
      const pitchAttr = secondaryAttribute;
      const timeAttr = primaryAttribute;

      const allItemsRes = await getAllItems(graphDetails.dataContext);
      const allItems = allItemsRes.values;

      // Asign pitch and time values to the dataset items
      // Do not include items that are missing values for either attributes
      const validItems = pitchAttr && timeAttr
        ? allItems.filter((item: CodapItem) => item.values[pitchAttr] !== "" && item.values[timeAttr] !== "")
        : allItems.filter((item: CodapItem) => item.values[timeAttr] !== "");

      // If there's no pitch attribute, assign a default value of 1
      const pitchValues = pitchAttr
        ? validItems.map((item: CodapItem) => item.values[pitchAttr])
        : validItems.map(() => 1);
      const timeValues = validItems.map((item: CodapItem) => item.values[timeAttr]);

      const lowerBound = primaryAttribute !== graphDetails.yAttributeName
        ? graphDetails.xLowerBound
        : graphDetails.yLowerBound;
      const upperBound = primaryAttribute !== graphDetails.yAttributeName
        ? graphDetails.xUpperBound
        : graphDetails.yUpperBound;

      const minTime = lowerBound;
      const maxTime = upperBound;
      const timeRange = maxTime - minTime || 1;

      const minPitch = lowerBound || 0;
      const maxPitch = upperBound || 0;
      const pitchRange = maxPitch - minPitch || 1;

      const timeFractions = timeValues.map((t: number) => (t - minTime) / timeRange);
      const pitchFractions = pitchValues.map((p: number) => (p - minPitch) / pitchRange);

      // Set up Tone.js
      await Tone.start();
      Tone.getTransport().cancel();
      Tone.getTransport().stop();
      Tone.getTransport().position = 0;

      const totalDuration = 10;
      const fractionGroups: Record<number, number[]> = {};
      timeFractions.forEach((frac: number, i: number) => {
        if (!fractionGroups[frac]) fractionGroups[frac] = [];
        fractionGroups[frac].push(i);
      });

      const uniqueFractions = Object.keys(fractionGroups)
        .map(parseFloat)
        .sort((a, b) => a - b);

      uniqueFractions.forEach((fraction) => {
        const offsetSeconds = fraction * totalDuration;
        const indices = fractionGroups[fraction];
        const numberOfDataPoints = indices.length;
      
        Tone.getTransport().scheduleOnce((time) => {
          indices.forEach((i) => {
            let freq: number;
            if (!secondaryAttribute) {
              // Use the time fraction as pitch so the pitch increases as we move along the axis
              freq = 220 + fraction * (880 - 220);
            } else {
              const pFrac = pitchFractions[i];
              freq = 220 + pFrac * (880 - 220);
            }            

            // For each data point, determine the pan value based on the x-axis position.
            // Normalize the x-axis position to a value between -1 and 1.
            const panValue = ((timeValues[i] - lowerBound) / (upperBound - lowerBound)) * 2 - 1;
            pannerRef.current?.pan.setValueAtTime(panValue, time);
      
            if (!secondaryAttribute) {
              // When there is no y attribute and data points with the same or similar values get stacked, make sure to
              // stagger the triggering of the tones in rapid succession. Otherwise, they'll sound like a single tone.
              for (let j = 0; j < numberOfDataPoints; j++) {
                synthRef.current?.triggerAttackRelease(freq, "16n", time + j * 0.05);
              }
            } else {
              synthRef.current?.triggerAttackRelease(freq, "32n", time);
            }
          });
        }, offsetSeconds);
      });

      // Play the sounds
      Tone.getTransport().start();
      let frameId: number;
      const step = () => {
        const elapsed = Tone.getTransport().seconds;
        const fraction = Math.min(elapsed / totalDuration, 1);

        // update the ROI position
        codapInterface.sendRequest({
          action: "update",
          resource: `component[${graphDetails.id}].adornment`,
          values: {
            type: "Region of Interest",
            primary: { "position": `${fraction * 100}%`, "extent": .1 }
          }
        });

        if (fraction < 1 && isSonificationPlaying) {
          // Continue the sonification and ROI animation
          frameId = requestAnimationFrame(step);
        } else {
          // Stop the sonification and ROI animation
          cancelAnimationFrame(frameId);
          codapInterface.sendRequest({
            action: "update",
            resource: `component[${graphDetails.id}].adornment`,
            values: {
              type: "Region of Interest",
              primary: { "position": "0%", "extent": .1 }
            }
          });
          Tone.getTransport().stop();
          onResetGraphToSonify();
        }
      };
  
      frameId = requestAnimationFrame(step);
    };

    fetchGraphData();
  }, [graphToSonify, isSonificationPlaying, onResetGraphToSonify]);


  return (
    <div hidden={true}/>
  );
};
