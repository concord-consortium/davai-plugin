import { Instance, SnapshotIn, types } from "mobx-state-tree";

export const CODAPGraphModel = types.model("ICODAPGraph", {
  backgroundColor: types.maybe(types.string),
  cannotClose: types.maybe(types.boolean),
  captionAttributeID: types.maybe(types.string),
  captionAttributeName: types.maybe(types.string),
  dataContext: types.maybe(types.string),
  dimensions: types.maybe(
    types.model({
      width: types.number,
      height: types.number,
    })
  ),
  displayOnlySelectedCases: types.maybe(types.boolean),
  enableNumberToggle: types.maybe(types.boolean),
  filterFormula: types.maybe(types.string),
  hiddenCases: types.maybe(types.array(types.frozen())),
  id: types.identifierNumber,
  legendAttributeID: types.maybe(types.number),
  legendAttributeName: types.maybe(types.string),
  name: types.maybe(types.string),
  numberToggleLastMode: types.maybe(types.string),
  plotType: types.maybe(types.string),
  pointColor: types.maybe(types.string),
  pointSize: types.maybe(types.number),
  position: types.maybe(
    types.model({
      left: types.number,
      top: types.number,
    })
  ),
  primaryAxis: types.maybe(types.string),
  rightSplitAttributeID: types.maybe(types.number),
  rightSplitAttributeName: types.maybe(types.string),
  showMeasuresForSelection: types.maybe(types.boolean),
  strokeColor: types.maybe(types.string),
  strokeSameAsFill: types.maybe(types.boolean),
  title: types.maybe(types.string),
  topSplitAttributeID: types.maybe(types.number),
  topSplitAttributeName: types.maybe(types.string),
  transparent: types.maybe(types.boolean),
  type: types.maybe(types.string),
  xAttributeID: types.maybe(types.number),
  xAttributeName: types.maybe(types.string),
  xAttributeType: types.maybe(types.string),
  xLowerBound: types.maybe(types.number),
  xUpperBound: types.maybe(types.number),
  y2AttributeID: types.maybe(types.number),
  y2AttributeName: types.maybe(types.string),
  y2AttributeType: types.maybe(types.string),
  y2LowerBound: types.maybe(types.number),
  y2UpperBound: types.maybe(types.number),
  yAttributeID: types.maybe(types.number),
  yAttributeIDs: types.maybe(types.array(types.number)),
  yAttributeName: types.maybe(types.string),
  yAttributeNames: types.maybe(types.array(types.string)),
  yAttributeType: types.maybe(types.string),
  yLowerBound: types.maybe(types.number),
  yUpperBound: types.maybe(types.number),
})
.views((self) => ({
  get isUnivariateDotPlot() {
    const {
      plotType,
      topSplitAttributeID: topId,
      y2AttributeID: y2Id,
      xAttributeID: xId,
      yAttributeID: yId,
      rightSplitAttributeID: rightId
    } = self;
    const isDotPlot = plotType === "dotPlot" || plotType === "binnedDotPlot";
    return isDotPlot && (!topId && !rightId && !y2Id && ((xId && !yId) || (yId && !xId)));
  },
  get isScatterPlot() {
    return self.plotType === "scatterPlot";
  }
}))
.views((self) => ({
  get isValidType () {
    return self.isScatterPlot || self.isUnivariateDotPlot;
  }
}))
.actions((self) => ({
  updatePropsFromSnapshot(snapshot: Partial<SnapshotIn<typeof CODAPGraphModel>>) {
    Object.keys(snapshot).forEach((key) => {
      const typedKey = key as keyof SnapshotIn<typeof CODAPGraphModel>;
      const newValue = snapshot[typedKey];
      if (self[typedKey] !== newValue) {
        // @ts-expect-error: TypeScript may complain about dynamic assignment
        self[typedKey] = newValue;
      }
    });
  },
}));

export interface ICODAPGraphModel extends Instance<typeof CODAPGraphModel> {}
