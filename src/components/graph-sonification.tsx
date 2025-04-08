import { codapInterface, getAllItems, IResult } from "@concord-consortium/codap-plugin-api";
import React, { useEffect, useRef } from "react";
import * as Tone from "tone";
import { CodapItem } from "../types";

interface IProps {
  graphToSonify: string;
  onResetGraphToSonify: () => void;
}

export const GraphSonification = ({ graphToSonify, onResetGraphToSonify }: IProps) => {
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const pannerRef = useRef<Tone.Panner | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const currentGraphIdRef = useRef<string | null>(null);

  if (!pannerRef.current) {
    pannerRef.current = new Tone.Panner(0).toDestination();
  }

  if (!synthRef.current) {
    synthRef.current = new Tone.PolySynth().connect(pannerRef.current);
  }

  const removeROIAdornment = async (graphId: string) => {
    await codapInterface.sendRequest({
      action: "delete",
      resource: `component[${graphId}].adornment`,
      values: {
        type: "Region of Interest"
      }
    });
  };

  useEffect(() => {
    const fetchGraphData = async () => {
      const res = await codapInterface.sendRequest({action: "get", resource: `component[${graphToSonify}]`}) as IResult;
      const graphDetails = res.values;
      if (!graphDetails) return;

      if (currentGraphIdRef.current && currentGraphIdRef.current !== graphDetails.id) {
        await removeROIAdornment(currentGraphIdRef.current);
      }

      currentGraphIdRef.current = graphDetails.id;

      await codapInterface.sendRequest({
        action: "create",
        resource: `component[${graphDetails.id}].adornment`,
        values: {
          type: "Region of Interest",
          primary: { "position": 0, "extent": 0.05 },
          secondary: { "position": 0, "extent": "100%" }
        }
      });

      const pitchAttr = graphDetails.yAttributeName;
      const timeAttr = graphDetails.xAttributeName;

      const allItemsRes = await getAllItems(graphDetails.dataContext);
      const allItems = allItemsRes.values;

      // Asign pitch and time values to the dataset items
      // Do not include items that are missing values for either attributes
      const validItems = pitchAttr && timeAttr
        ? allItems.filter((item: CodapItem) => item.values[pitchAttr] !== "" && item.values[timeAttr] !== "")
        : allItems.filter((item: CodapItem) => item.values[timeAttr] !== "");

      const pitchValues = validItems.map((item: CodapItem) => item.values[pitchAttr]);
      const timeValues = validItems.map((item: CodapItem) => item.values[timeAttr]);

      const minTime = graphDetails.xLowerBound;
      const maxTime = graphDetails.xUpperBound;
      const timeRange = maxTime - minTime || 1;

      const minPitch = graphDetails.yLowerBound;
      const maxPitch = graphDetails.yUpperBound;
      const pitchRange = maxPitch - minPitch || 1;

      const timeFractions = timeValues.map((t: number) => (t - minTime) / timeRange);
      const pitchFractions = pitchValues.map((p: number) => (p - minPitch) / pitchRange);

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
      
        Tone.getTransport().scheduleOnce((time) => {
          indices.forEach((i) => {
            const pFrac = pitchFractions[i];
            const freq = 220 + pFrac * (880 - 220);          

            // For each data point, determine the pan value based on the x-axis position.
            // Normalize the x-axis position to a value between -1 and 1.
            const panValue = ((timeValues[i] - graphDetails.xLowerBound) / (graphDetails.xUpperBound - graphDetails.xLowerBound)) * 2 - 1;
            pannerRef.current?.pan.setValueAtTime(panValue, time);
      
            synthRef.current?.triggerAttackRelease(freq, "8n", time);
          });
        }, offsetSeconds);
      });

      Tone.getTransport().start();
      const step = () => {
        const elapsed = Tone.getTransport().seconds;
        const fraction = Math.min(elapsed / totalDuration, 1);

        codapInterface.sendRequest({
          action: "update",
          resource: `component[${graphDetails.id}].adornment`,
          values: {
            type: "Region of Interest",
            primary: { "position": `${fraction * 100}%`, "extent": 0.05 }
          }
        });

        if (fraction < 1) {
          frameIdRef.current = requestAnimationFrame(step);
        } else {
          if (frameIdRef.current) {
            cancelAnimationFrame(frameIdRef.current);
            frameIdRef.current = null;
          }
          codapInterface.sendRequest({
            action: "update",
            resource: `component[${graphDetails.id}].adornment`,
            values: {
              type: "Region of Interest",
              primary: { "position": "0%", "extent": 0 }
            }
          });
          Tone.getTransport().stop();
          onResetGraphToSonify();
        }
      };
  
      frameIdRef.current = requestAnimationFrame(step);
    };

    fetchGraphData();

    return () => {
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
      Tone.getTransport().stop();

      if (currentGraphIdRef.current) {
        removeROIAdornment(currentGraphIdRef.current);
        currentGraphIdRef.current = null;
      }
    };
  }, [graphToSonify, onResetGraphToSonify]);

  return (
    <div hidden={true}/>
  );
};
