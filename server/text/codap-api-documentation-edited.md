# The Data Interactive Plugin API

## Data Interactive-Initiated Actions

### DataContexts

#### The dataContext object

```json
{
  values: {
    name:        // {String} Unique, immutable identifier for the data context
    title:       // {String} Optional UI title (defaults to `name`)
    description: // {String} Currently unused (reserved for future)
    collections: // {Array} Hierarchical structure containing collections (and their attributes)
  }
}
```

#### **Resource Selector Patterns + Supported Actions**

-   **`dataContext`**
    -   Supported actions:
        -   `create`
        -   `get`
-   **`dataContext[dataContextId]`**
    -   Explicit reference by ID (e.g., `dataContext[123]`)
    -   Supported actions:
        -   `update`
        -   `get`
        -   `delete`
-   **`dataContextList`**
    -   List of all data contexts in the CODAP document
    -   Supported actions:
        -   `get`
-   **`dataContextFromURL`**
    -   Import data from CSV/tab-delimited URLs (must support CORS)
    -   Supported actions:
        -   `create`

### Collections

#### The Collection Object

```json
{
  name:        // {String} Unique, immutable identifier for the collection
  title:       // {String} Optional UI title (defaults to `name`)
  description: // {String} Currently unused (reserved for future)
  parent:      // {String} Name of the parent collection, "_root_" to make this the new root
  attrs: [     // {Array<Object>} Attribute definitions (see Attribute object spec)
    /* { name, type, precision, … } */
  ],
  labels: {    // {Object} Optional custom labels for UI wording
    singleCase,            // e.g. "observation"
    pluralCase,            // e.g. "observations"
    singleCaseWithArticle, // e.g. "an observation"
    setOfCases,            // e.g. "experiment"
    setOfCasesWithArticle  // e.g. "an experiment"
  }
}
```

#### **Resource Selector Patterns + Supported Actions**

-   **`collection`**
    -   Creates a collection for the default dataset
    -   Supported actions:
        -   `create`
-   **`collection[name]`**
    -   Supported actions:
        -   `update`
        -   `get`
        -   `delete`
-   **`collectionList`**
    -   List of all collections in the default data context
    -   Supported actions:
        -   `get`
-   **`dataContext[dataContextId].collection`**
    -   Supported actions:
        -   `create`
-   **`dataContext[dataContextId].collection[name]`**
    -   Supported actions:
        -   `update`
        -   `get`
        -   `delete`
-   **`dataContext[dataContextId].collectionList`**
    -   List of collections within the specified data context
    -   Supported actions:
        -   `get`

#### Example Request + Response

Send:
```json
{
  "action": "create",
  "resource": "collection",
  "values": [
    {
      "name": "People",
      "title": "Data about People",
      "labels": {
        "singleCase": "person",
        "pluralCase": "people"
      }
    },
    {
      "name": "Measurements",
      "title": "Measurements",
      "parent": "People"
    }
  ]
}
```

Receive:
```json
{
  "success": true,
  "values": [
    {
      "id": 35,
      "name": "People"
    },
    {
      "id": 36,
      "name": "Measurements"
    }
  ]
}
```

#### Notes:
-   The collection name, once created, cannot be changed.
-   The 'update' action cannot be used to update the collection parent.
-   The 'update' action of collection should not be used to update the attribute definitions.
-   Only one object can be updated per request.
-   If a collection is deleted, all its attributes will also be deleted.

### Attributes

#### The attribute object

```json
{
  name:        // {String} Unique, immutable within the data context (letters, digits, underscores)
  title:       // {String} Optional UI title (defaults to name)
  type:        // {'numeric' | 'categorical'} Optional; inferred if omitted
  description: // {String} Optional tooltip text
  precision:   // {Number} Decimal places for numeric values (default 2)
  unit:        // {String} Optional unit label for numeric values
  colormap:    // {Object} Optional colour map (categorical or numeric gradations)
  formula:     // {String} Optional expression to compute values
  editable:    // {Boolean} User-editable? (default true)
  hidden:      // {Boolean} Hide from UI (use sparingly)
}
```

#### **Resource Selector Patterns + Supported Actions**

-   **`collection[name].attribute`**
    -   Creates attributes in the default data context
    -   Supported actions:
        -   `create`
-   **`collection[name].attribute[name]`**
    -   Operates on a specific attribute in the default data context
    -   Supported actions:
        -   `update`
        -   `get`
        -   `delete`
-   **`collection[name].attributeList`**
    -   List of attributes for the specified collection in the default data context
    -   Supported actions:
        -   `get`
-   **`dataContext[dataContextId].collection[name].attribute`**
    -   Creates attributes in the specified data context
    -   Supported actions:
        -   `create`
-   **`dataContext[dataContextId].collection[name].attribute[name]`**
    -   Operates on a specific attribute in the specified data context
    -   Supported actions:
        -   `update`
        -   `get`
        -   `delete`
-   **`dataContext[dataContextId].collection[name].attributeList`**
    -   List of attributes for the specified collection in a given data context
    -   Supported actions:
        -   `get`

#### Notes:
-   Attribute names **must be unique** across the entire data context and **cannot be renamed**.
-   Formulas must follow proper syntax:
    -   Wrap the entire expression in double quotes: `"formula": "LifeSpan > 30"`
    -   Do not quote attribute names: `"formula": "LifeSpan > 30"`
        -   Don't do: `"formula": "'LifeSpan' > 30"`
    -   Wrap string values in single quotes or escaped double quotes: `"formula": "Diet='meat'"` or `"formula": "Diet==\"meat\""`
    -   Do not quote numeric values: `"formula": "LifeSpan > 30"`
        -   Don't do: `"formula": "LifeSpan > '30'"`
    -   Use only the attribute name (no collection prefix): `"formula": "mean(LifeSpan)"`
        -   Don't do: `"formula": "mean(Cases.LifeSpan)"`
-   Deleting an attribute removes its values across all cases in the collection.
-   Use the `update` action only for editable fields—structural changes (like renaming) are not supported.

### AttributeLocations

#### The attributeLocation object

```json
{
  "collection": /* name of the attribute's collection */,
  "position": /* zero indexed position of the attribute in the list of attributes */
}
```

#### **Resource Selector Patterns + Supported Actions**

-   **`collection[name].attributeLocation`**
    -   Supported actions:
        -   `update`
-   **`dataContext[dataContextId].collection[name].attributeLocation`**
    -   Supported actions:
        -   `update`
-   **`dataContext[dataContextId].attributeLocation`**
    -   Supported actions:
        -   `update`

### Cases

#### The Case Object

```json
{
  id:       // {Number} Unique case identifier
  parent:   // {Number} Optional ID of parent case (required for child collections)
  values: { // {Object} Attribute-value pairs
    /* "Height": 65, "Name": "Sam" */
  }
}
```

#### **Resource Selector Patterns + Supported Actions**

-   **`dataContext[dataContextId].collection[name].case`**
    -   Create or update one or more cases
    -   Supported actions:
        -   `create`
        -   `update`
-   **`dataContext[dataContextId].collection[name].caseByID[id]`**
    -   Operate on a specific case by ID
    -   Supported actions:
        -   `get`
        -   `update`
        -   `delete`
-   **`dataContext[dataContextId].collection[name].caseByIndex[index]`**
    -   Get, update, or delete a case by index (0-based, order reflects case table)
    -   Supported actions:
        -   `get`
        -   `update`
        -   `delete`
-   **`dataContext[dataContextId].collection[name].caseFormulaSearch[expression]`**
    -   Return cases matching a formula condition (preferred search method)
    -   Supported actions:
        -   `get`
-   **`dataContext[dataContextId].collection[name].caseCount`**
    -   Count of cases in a collection
    -   Supported actions:
        -   `get`
-   **`dataContext[dataContextId].collection[name].allCases`**
    -   Delete all cases in a collection
    -   Supported actions:
        -   `delete`
-   **`dataContext[dataContextId].caseByID[id]`**
    -   Alternative path to get/update/delete a case by ID (collection context omitted)
    -   Supported actions:
        -   `get`
        -   `update`
        -   `delete`

#### Notes:
-   Cases in **child collections require a parent case ID**.
-   If the cases being created / updated refer to a parent case, the parent must already exist.
-   Use `create` to add one or multiple cases; use `update` to change values of existing ones.
-   Formula search syntax aligns with CODAP formula functions (see 'Attributes' section for formatting rules, and see list of available formula functions here: https://codap.concord.org/help/work-functions)
-   Case order (by index) reflects grouping by parent and order of insertion.
-   Deleting a case or all cases removes associated data, but not attributes or collections.

### Items

#### The item object

The item object is a map of non-formula attribute names to values. For example:

```json
{
  "Mammal": "Lion",
  "Order": "Carnivora",
  "LifeSpan": 15,
  "Height": 2.5,
  "Mass": 250,
  "Sleep": 20,
  "Speed": 80,
  "Habitat": "land",
  "Diet": "meat"
}
```

#### **Resource Selector Patterns + Supported Actions**

-   **`dataContext[dataContextId].item`**
    -   Create or update one or more items
    -   Supported actions:
        -   `create`
        -   `update`
-   **`dataContext[dataContextId].item[index]`**
    -   Operate on an item by index (0-based)
    -   Supported actions:
        -   `get`
        -   `update`
        -   `delete`
-   **`dataContext[dataContextId].itemByID[id]`**
    -   Operate on an item by item ID
    -   Supported actions:
        -   `get`
        -   `update`
        -   `delete`
-   **`dataContext[dataContextId].itemByCaseID[id]`**
    -   Operate on an item by corresponding case ID
    -   Supported actions:
        -   `get`
        -   `update`
        -   `delete`
-   **`dataContext[dataContextId].itemSearch[expression]`**
    -   Search for matching items using simple expressions or `*`
    -   Supported actions:
        -   `get`
        -   `delete`
-   **`dataContext[dataContextId].itemCount`**
    -   Count total items in the data context
    -   Supported actions:
        -   `get`

### SelectionLists

#### The selectionList object

The selectionList object is just an array of case ids.

```json
[25, 29, 30]
```

#### **Resource Selector Patterns + Supported Actions**

-   **`dataContext[dataContextId].selectionList`**
    -   Supported actions:
        -   `create`
        -   `update`
        -   `get`
-   **`selectionList`** (default data context)
    -   Supported actions:
        -   `create`
        -   `update`
        -   `get`

#### Notes:
-   `create` sets a new selection; `update` adds to the existing selection.
-   `get` returns selected cases along with their collection names and IDs.

### Components

#### **Resource Selector Patterns + Supported Actions**

-   **`component`**
    -   Creates a new component
    -   Supported actions:
        -   `create`
-   **`component[name]`**
    -   Reference by name
    -   Supported actions:
        -   `get`
        -   `update`
        -   `delete`
        -   `notify`
-   **`component[id]`**
    -   Reference by ID
    -   Supported actions:
        -   `get`
        -   `update`
        -   `delete`
        -   `notify`
-   **`componentList`**
    -   Get metadata for all existing components
    -   Supported actions:
        -   `get`

#### Base Component Properties

```json
{
  type:            /* {String} Component type, e.g. "graph" */,
  name:            /* {String} Unique identifier, set only at create */,
  title:           /* {String} Optional UI title (defaults to name) */,
  dimensions: {    /* {Object} Size in pixels */
    width:  Number,
    height: Number
  },
  position:        /* {"top" | "bottom" | { left: Number, top: Number }} */,
  cannotClose:     /* {Boolean} Hide "X" in title bar */
}
```

#### The graph object

```json
{
  type: "graph",
  ...baseComponentProperties,
  dataContext: /* {String} Name of the data context that the attributes associated with the graph belong to. MUST be present in the create request if the properties xAttributeName, yAttributeName, y2AttributeName, and/or legendAttributeName are also present. */
  xAttributeName: /* {String} An attribute name within the data context */,
  yAttributeName: /* {String} An attribute name within the data context */,
  y2AttributeName: /* {String} An attribute name within the data context */,
  legendAttributeName: /* {String} An attribute name within the data context */
  enableNumberToggle: /* {Boolean} whether the numberToggle display should be presented in this graph */
  numberToggleLastMode: /* {Boolean} whether numberToggle display should be in "last mode" */
  exportDataUri: /* {String} Optional. Not used in creating or updating a graph, but is returned when getting a graph. A data URI string that corresponds to an image of the graph. */
}
```

#### The caseTable object

```json
{
  type: "caseTable",
  ...baseComponentProperties,
  dataContext: /* {String} Name of a data context */
  horizontalScrollOffset: /* {Number} Scroll offset in pixels from the left. */
  isIndexHidden: /* {Boolean} Whether the index column is shown in case table collections */
}
```

#### The map object

```json
{
  type: "map",
  ...baseComponentProperties,
  dataContext: /* {String} Name of a data context */
  legendAttributeName: /* {String} Name of the attribute to be displayed in the legend. Optional. */
  center: /* {Array} a two element array consisting of a decimal latitude and longitude of the desired map center. */
  zoom: /* {Number} A zoom factor. 1: entire globe, higher numbers closer in. */
}
```

#### The slider object

```json
{
  type: "slider",
  ...baseComponentProperties,
  "globalValueName": {string},/* Name of global value slider is managing. Global value must be created prior to slider creation. */
  "animationDirection": {number},
  "animationMode": {number},
  "lowerBound": {number},
  "upperBound": {number}
}
```

#### The calculator object

```json
{
  type: 'calculator',
  ...baseComponentProperties
}
```

#### The text object

```json
{
  type: 'text',
  ...baseComponentProperties,
  text: /*{String} The text displayed in the component .*/
}
```

#### The webView object

Note that setting the dimensions is required for a webView component.

```json
{
  type: 'webView',
  ...baseComponentProperties,
  URL: /* {String} */
}
```

#### Example: create graph component

```json
{
  "action": "create",
  "resource": "component",
  "values": {
    "type": "graph",
    "dataContext": "foo"
    "name": "HeightAge",
    "dimensions": {
      "width": 240,
      "height": 240
    },
    "position": "top",
    "xAttributeName": "Age",
    "yAttributeName": "Height",
    "legendAttributeName": "Studio",
    "enableNumberToggle": false
  }
}
```

### Data Display

#### **Resource Selector Patterns + Supported Actions**

-   **`dataDisplay[componentId]`**
    -   Retrieves a base64-encoded image of the component
    -   Supported actions:
        -   `get`

#### The DataDisplay Object

```json
{ exportDataUri: /* {String} A data URI string representing the graph image */ }
```

#### Notes
-   Only available for components of type `"graph"`.
-   The returned `exportDataUri` can be embedded directly as an image (e.g., in an `<img>` tag or downloaded).

### Globals

#### The Global Object

```json
{
  name: /* {String} Unique name of the global value */
  value: /* {Number} Numeric value associated with the global */
}
```

#### **Resource Selector Patterns + Supported Actions**

-   **`global`**
    -   Supported actions:
        -   `create`
-   **`global[name]`**
    -   Supported actions:
        -   `update`
        -   `get`
-   **`globalList`**
    -   Supported actions:
        -   `get`

#### Notes

-   Global values must be created before they can be linked to sliders.
-   `name` cannot be changed after creation.

### Formula Engine

#### **Resource Selector Patterns + Supported Actions**

-   **`formulaEngine`**
    -   Supported actions:
        -   `get` - Returns information about built-in functions
        -   `notify` - Evaluates expressions

#### The Function Object

```json
{
  name: /* {String} Function name */
  displayName: /* {String} Display name for UI */
  description: /* {String} Function description */
  category: /* {String} Category like "Arithmetic Functions", "Statistical Functions", etc. */
  args: /* {Array} Argument definitions with name, description, required, type */
  examples: /* {Array<String>} Example formulas using this function */
  maxArgs: /* {Number} Maximum arguments allowed */
  minArgs: /* {Number} Minimum arguments required */
}
```

#### Example: Evaluate Expression

```json
{
  "action": "notify",
  "resource": "formulaEngine",
  "values": {
    "request": "evalExpression",
    "source": "a + 1",
    "records": [
      { "a": 1 },
      { "a": 2 },
      { "a": 3 }
    ]
  }
}
```

#### Notes
-   The `records` field contains environments for evaluation.
-   Returns one result per record provided.