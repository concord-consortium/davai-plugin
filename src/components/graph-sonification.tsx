import { codapInterface, getAllItems, IResult } from "@concord-consortium/codap-plugin-api";
import React, { useEffect, useRef } from "react";
import { CodapItem } from "../types";
import * as Tone from "tone";

interface IProps {
  graphToSonify: string;
}

export const GraphSonification = ({graphToSonify}: IProps) => {
  const synthRef = useRef<Tone.PolySynth | null>(null);
  if (!synthRef.current) {
    synthRef.current = new Tone.PolySynth().toDestination();
  }

  useEffect(() => {
    const fetchGraphData = async () => {
      const res = await codapInterface.sendRequest({action: "get", resource: `component[${graphToSonify}]`}) as IResult;
      const graphDetails = res.values;
      if (!graphDetails) return;

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

      const pitchValues = allItems.map((item: CodapItem) => item.values[pitchAttr] || 0);
      const timeValues = allItems.map((item: CodapItem) => item.values[timeAttr] || 0);

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
      let frameId: number;
      const step = () => {
        const elapsed = Tone.getTransport().seconds;
        const fraction = Math.min(elapsed / totalDuration, 1);

        codapInterface.sendRequest({
          action: "update",
          resource: `component[${graphDetails.id}].adornment`,
          values: {
            type: "Region of Interest",
            xPosition: { unit: "percent", value: fraction * 100 }
          }
        });

        if (fraction < 1) {
          frameId = requestAnimationFrame(step);
        } else {
          cancelAnimationFrame(frameId);
          codapInterface.sendRequest({
            action: "update",
            resource: `component[${graphDetails.id}].adornment`,
            values: {
              type: "Region of Interest",
              xPosition: { unit: "percent", value: 0 }
            }
          });
          Tone.getTransport().stop();
        }
      };
      frameId = requestAnimationFrame(step);
    };
    fetchGraphData();
  }, [graphToSonify]);


  return (
    <div hidden={true}/>
  );
};
