import { codapInterface, getAllItems, IResult } from "@concord-consortium/codap-plugin-api";
import React, { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { CodapItem } from "../types";
import { Time } from "tone/build/esm/core/type/Units";

interface IProps {
  graphToSonify: string;
  isSonificationLooping: boolean;
  isSonificationPaused: boolean;
  isSonificationPlaying: boolean;
  sonificationStep?: number;
  onResetGraphToSonify: () => void;
}

interface IScheduleTones {
  graphDetails: any;
  pannerRef: React.RefObject<Tone.Panner>;
  pitchFractions: number[];
  timeFractions: number[];
  timeValues: number[];
  synthRef: React.RefObject<Tone.PolySynth>;
}

const fetchGraphData = async (graphName: string) => {
  const res = await codapInterface.sendRequest({action: "get", resource: `component[${graphName}]`}) as IResult;
  const graphDetails = res.values;
  return graphDetails;
};

const mapDataToSonificationParams = async (graphDetails: any) => {
  const pitchAttr = graphDetails.yAttributeName;
  const timeAttr = graphDetails.xAttributeName;
  const allItemsRes = await getAllItems(graphDetails.dataContext);
  const allItems = allItemsRes.values;
  // Asign pitch and time values to the dataset items -- do not include items that are missing values for
  // either attribute.
  const validItems = pitchAttr && timeAttr
    ? allItems.filter((item: CodapItem) => item.values[pitchAttr] !== "" && item.values[timeAttr] !== "")
    : allItems.filter((item: CodapItem) => item.values[timeAttr] !== "");
  const pitchValues: number[] = validItems.map((item: CodapItem) => item.values[pitchAttr]);
  const timeValues: number[] = validItems.map((item: CodapItem) => item.values[timeAttr]);

  return { pitchValues, timeValues };
};

const scheduleTones = (props: IScheduleTones) => {
  const { graphDetails, pannerRef, pitchFractions, timeFractions, timeValues, synthRef } = props;
  const totalDuration = 3;
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
        // TODO: Make these variables with meaningful names for these numbers.
        const freq = 220 + pFrac * (880 - 220);
        // For each data point, determine the pan value based on the x-axis position.
        // Normalize the x-axis position to a value between -1 and 1.
        const panValue = ((timeValues[i] - graphDetails.xLowerBound) / (graphDetails.xUpperBound - graphDetails.xLowerBound)) * 2 - 1;
        pannerRef.current?.pan.setValueAtTime(panValue, time);
        synthRef.current?.triggerAttackRelease(freq, "8n", time);
      });
    }, offsetSeconds);
  });
};

const updateRoiAdornment = async (graphId: string, fraction: number) => {
  await codapInterface.sendRequest({
    action: "update",
    resource: `component[${graphId}].adornment`,
    values: {
      type: "Region of Interest",
      primary: { "position": `${fraction * 100}%`, "extent": 0.05 }
    }
  });
};

const removeRoiAdornment = async (graphId: string) => {
  await codapInterface.sendRequest({
    action: "delete",
    resource: `component[${graphId}].adornment`,
    values: { type: "Region of Interest" }
  });
};

export const GraphSonification = ({ graphToSonify, isSonificationLooping, isSonificationPaused, isSonificationPlaying, sonificationStep }: IProps) => {
  const [graphDetails, setGraphDetails] = useState<any>(null);
  const [pitchFractions, setPitchFractions] = useState<number[]>([]);
  const [timeFractions, setTimeFractions] = useState<number[]>([]);
  const [timeValues, setTimeValues] = useState<number[]>([]);
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const pannerRef = useRef<Tone.Panner | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const currentGraphIdRef = useRef<string | null>(null);
  const currentStepRef = useRef<Time | null>(null);
  const pausedPositionRef = useRef<number>(0);
  const hasStartedRef = useRef(false);

  if (!pannerRef.current) {
    pannerRef.current = new Tone.Panner(0).toDestination();
  }

  if (!synthRef.current) {
    synthRef.current = new Tone.PolySynth().connect(pannerRef.current);
  }

  const animateSonification = useCallback((pausePosition?: number) => {
    const totalDuration = 3;
    let stepCounter = 0;
    const step = () => {
      const elapsed = stepCounter === 0 && pausePosition ? pausePosition : Tone.getTransport().seconds;
      const fraction = Math.min(elapsed / totalDuration, 1);
  
      updateRoiAdornment(graphDetails.id, fraction);
  
      if (fraction < 1) {
        frameIdRef.current = requestAnimationFrame(step);
      } else {
        if (frameIdRef.current && !isSonificationLooping) {
          cancelAnimationFrame(frameIdRef.current);
          frameIdRef.current = null;
        }
  
        updateRoiAdornment(graphDetails.id, 0);
  
        if (!isSonificationLooping) {
          pausedPositionRef.current = 0;
          Tone.getTransport().stop();
          hasStartedRef.current = false;
        } else {
          scheduleTones({graphDetails, pannerRef, pitchFractions, synthRef, timeFractions, timeValues});
          pausedPositionRef.current = 0;
          Tone.getTransport().seconds = 0;
          Tone.getTransport().position = 0;
          Tone.getTransport().start();
          frameIdRef.current = requestAnimationFrame(step);
        }
      }
      stepCounter++;
    };
  
    frameIdRef.current = requestAnimationFrame(step);
  }, [graphDetails, isSonificationLooping, pitchFractions, timeFractions, timeValues]);

  const prepareSonification = useCallback(async () => {
      if (!graphDetails) return;

      if (currentGraphIdRef.current && currentGraphIdRef.current !== graphDetails.id) {
        await removeRoiAdornment(currentGraphIdRef.current);
      }

      currentGraphIdRef.current = graphDetails.id;


      // const totalDuration = 3;

      await Tone.start();
  
      scheduleTones({graphDetails, pannerRef, pitchFractions, synthRef, timeFractions, timeValues});

      await codapInterface.sendRequest({
        action: "create",
        resource: `component[${graphDetails.id}].adornment`,
        values: {
          type: "Region of Interest",
          primary: { "position": 0, "extent": 0.05 },
          secondary: { "position": 0, "extent": "100%" }
        }
      });

      Tone.getTransport().start(undefined, pausedPositionRef.current);
      animateSonification();

  }, [animateSonification, graphDetails, pitchFractions, timeFractions, timeValues]);

  useEffect(() => {
    const updateSonificationParams = async () => {
      const _graphDetails = await fetchGraphData(graphToSonify);
      const { pitchValues, timeValues: _timeValues } = await mapDataToSonificationParams(_graphDetails);
      setTimeValues(_timeValues);
      const minTime = _graphDetails.xLowerBound;
      const maxTime = _graphDetails.xUpperBound;
      const timeRange = maxTime - minTime || 1;
      const minPitch = _graphDetails.yLowerBound;
      const maxPitch = _graphDetails.yUpperBound;
      const pitchRange = maxPitch - minPitch || 1;
      setTimeFractions(_timeValues.map((t: number) => (t - minTime) / timeRange));
      setPitchFractions(pitchValues.map((p: number) => (p - minPitch) / pitchRange));
      setGraphDetails(_graphDetails);
    };

    updateSonificationParams();
    
  }, [graphToSonify]);

  useEffect(() => {
    if (isSonificationPaused) {
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
      }
      pausedPositionRef.current = Tone.getTransport().seconds;
      Tone.getTransport().pause();
    } else {
      Tone.getTransport().start(undefined, pausedPositionRef.current);
      animateSonification(pausedPositionRef.current);
    }
  }, [animateSonification, isSonificationPaused, isSonificationPlaying]);

  useEffect(() => {
    if (isSonificationPlaying && !hasStartedRef.current) {
      hasStartedRef.current = true;
      prepareSonification();
    }

    return () => {
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
      Tone.getTransport().stop();

      if (currentGraphIdRef.current) {
        removeRoiAdornment(currentGraphIdRef.current);
        currentGraphIdRef.current = null;
      }

      currentStepRef.current = null;
      pausedPositionRef.current = 0;
    };
  }, [graphToSonify, isSonificationLooping, isSonificationPaused, isSonificationPlaying, prepareSonification]);

  return (
    <div hidden={true}/>
  );
};
