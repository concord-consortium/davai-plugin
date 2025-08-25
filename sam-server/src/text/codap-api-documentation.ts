export const codapApiDoc = `### DataContexts

#### The dataContext object

{
  values: {
    name:        // {String} Unique, immutable identifier for the data context
    title:       // {String} Optional UI title (defaults to \`name\`)
    description: // {String} Currently unused (reserved for future)
    collections: // {Array} Hierarchical structure containing collections (and their attributes)
  }
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`dataContext\`**
    -   Supported actions:
        -   \`create\`
        -   \`get\`
-   **\`dataContext[dataContextId]\`**
    -   Explicit reference by ID (e.g., \`dataContext[123]\`)
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`dataContextList\`**
    -   List of all data contexts in the CODAP document
    -   Supported actions:
        -   \`get\`
-   **\`dataContextFromURL\`**
    -   Import data from CSV/tab-delimited URLs (must support CORS)
    -   Supported actions:
        -   \`create\`

### Collections

#### The Collection Object

{
  name:        // {String} Unique, immutable identifier for the collection
  title:       // {String} Optional UI title (defaults to \`name\`)
  description: // {String} Currently unused (reserved for future)
  parent:      // {String} Name of the parent collection, "_root_" to make this the new root
  attrs: [     // {Array<Object>} Attribute definitions (see Attribute object spec)
    // { name, type, precision, … }
  ],
  labels: {    // {Object} Optional custom labels for UI wording
    singleCase,            // e.g. "observation"
    pluralCase,            // e.g. "observations"
    singleCaseWithArticle, // e.g. "an observation"
    setOfCases,            // e.g. "experiment"
    setOfCasesWithArticle  // e.g. "an experiment"
  }
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`collection\`**
    -   Creates a collection for the default dataset
    -   Supported actions:
        -   \`create\`
-   **\`collection[name]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`collectionList\`**
    -   List of all collections in the default data context
    -   Supported actions:
        -   \`get\`
-   **\`dataContext[dataContextId].collection\`**
    -   Supported actions:
        -   \`create\`
-   **\`dataContext[dataContextId].collection[name]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`dataContext[dataContextId].collectionList\`**
    -   List of collections within the specified data context
    -   Supported actions:
        -   \`get\`

### Attributes

#### The Attribute Object

{
  name:        // {String} Unique, immutable identifier for the attribute
  title:       // {String} Optional UI title (defaults to \`name\`)
  description: // {String} Currently unused (reserved for future)
  type:        // {String} Data type: "numeric", "categorical", "date", "time", "bound", "text"
  precision:   // {Number} For numeric types, number of decimal places
  formula:     // {String} Optional formula expression
  hidden:      // {Boolean} Whether attribute is hidden in UI
  editable:    // {Boolean} Whether attribute values can be edited
  width:       // {Number} Column width in pixels
  collection:  // {String} Name of the collection this attribute belongs to
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`attribute\`**
    -   Creates an attribute in the default collection
    -   Supported actions:
        -   \`create\`
-   **\`attribute[name]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`attributeList\`**
    -   List of all attributes in the default collection
    -   Supported actions:
        -   \`get\`
-   **\`collection[name].attribute\`**
    -   Supported actions:
        -   \`create\`
-   **\`collection[name].attribute[name]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`collection[name].attributeList\`**
    -   List of attributes within the specified collection
    -   Supported actions:
        -   \`get\`

### Cases

#### The Case Object

{
  id:          // {String} Unique identifier for the case
  values:      // {Object} Key-value pairs of attribute names and values
  parent:      // {String} ID of parent case (for hierarchical data)
  children:    // {Array<String>} IDs of child cases
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`case\`**
    -   Creates a case in the default collection
    -   Supported actions:
        -   \`create\`
-   **\`case[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`collection[name].case\`**
    -   Supported actions:
        -   \`create\`
-   **\`collection[name].case[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`collection[name].allCases\`**
    -   List of cases within the specified collection
    -   Supported actions:
        -   \`get\`

### Items

#### The Item Object

{
  id:          // {String} Unique identifier for the item
  values:      // {Object} Key-value pairs of attribute names and values
  parent:      // {String} ID of parent item (for hierarchical data)
  children:    // {Array<String>} IDs of child items
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`item\`**
    -   Creates an item in the default collection
    -   Supported actions:
        -   \`create\`
-   **\`item[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`itemList\`**
    -   List of all items in the default collection
    -   Supported actions:
        -   \`get\`
-   **\`collection[name].item\`**
    -   Supported actions:
        -   \`create\`
-   **\`collection[name].item[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`collection[name].itemList\`**
    -   List of items within the specified collection
    -   Supported actions:
        -   \`get\`

### Components

#### The Component Object

{
  id:          // {String} Unique identifier for the component
  type:        // {String} Component type: "graph", "table", "text", "slider", etc.
  title:       // {String} Optional UI title
  description: // {String} Optional description
  position:    // {Object} Position and size: { x, y, width, height }
  data:        // {Object} Component-specific data and configuration
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`component\`**
    -   Creates a component in the default collection
    -   Supported actions:
        -   \`create\`
-   **\`component[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`componentList\`**
    -   List of all components in the default collection
    -   Supported actions:
        -   \`get\`
-   **\`dataContext[dataContextId].component\`**
    -   Supported actions:
        -   \`create\`
-   **\`dataContext[dataContextId].component[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`dataContext[dataContextId].componentList\`**
    -   List of components within the specified data context
    -   Supported actions:
        -   \`get\`

### Selection Lists

#### The SelectionList Object

{
  id:          // {String} Unique identifier for the selection list
  name:        // {String} Name of the selection list
  cases:       // {Array<String>} Array of case IDs that are selected
  collections: // {Array<String>} Array of collection names involved in the selection
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`selectionList\`**
    -   Creates a selection list
    -   Supported actions:
        -   \`create\`
-   **\`selectionList[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`selectionListList\`**
    -   List of all selection lists
    -   Supported actions:
        -   \`get\`

### Attribute Locations

#### The AttributeLocation Object

{
  collection:  // {String} Name of the collection
  position:    // {Number} Position within the collection's attribute list
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`attributeLocation\`**
    -   Creates an attribute location
    -   Supported actions:
        -   \`create\`
-   **\`attributeLocation[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`attributeLocationList\`**
    -   List of all attribute locations
    -   Supported actions:
        -   \`get\`

### Notifications

#### The Notification Object

{
  type:        // {String} Type of notification: "info", "warning", "error"
  message:     // {String} The notification message
  title:       // {String} Optional notification title
  duration:    // {Number} Optional duration in milliseconds
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`notification\`**
    -   Creates a notification
    -   Supported actions:
        -   \`create\`
-   **\`notification[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`notificationList\`**
    -   List of all notifications
    -   Supported actions:
        -   \`get\`

### Data Display

#### The DataDisplay Object

{
  id:          // {String} Unique identifier for the data display
  type:        // {String} Type of display: "table", "graph", "text", etc.
  title:       // {String} Optional UI title
  description: // {String} Optional description
  data:        // {Object} Display-specific data and configuration
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`dataDisplay\`**
    -   Creates a data display
    -   Supported actions:
        -   \`create\`
-   **\`dataDisplay[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`dataDisplayList\`**
    -   List of all data displays
    -   Supported actions:
        -   \`get\`
-   **\`dataContext[dataContextId].dataDisplay\`**
    -   Supported actions:
        -   \`create\`
-   **\`dataContext[dataContextId].dataDisplay[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`dataContext[dataContextId].dataDisplayList\`**
    -   List of data displays within the specified data context
    -   Supported actions:
        -   \`get\`

### Formulas

#### The Formula Object

{
  name:        // {String} Name of the formula
  expression:  // {String} The formula expression
  description: // {String} Optional description
  collection:  // {String} Name of the collection this formula belongs to
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`formula\`**
    -   Creates a formula
    -   Supported actions:
        -   \`create\`
-   **\`formula[name]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`formulaList\`**
    -   List of all formulas
    -   Supported actions:
        -   \`get\`
-   **\`collection[name].formula\`**
    -   Supported actions:
        -   \`create\`
-   **\`collection[name].formula[name]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`collection[name].formulaList\`**
    -   List of formulas within the specified collection
    -   Supported actions:
        -   \`get\`

### Plugins

#### The Plugin Object

{
  id:          // {String} Unique identifier for the plugin
  name:        // {String} Name of the plugin
  version:     // {String} Plugin version
  description: // {String} Plugin description
  url:         // {String} URL to the plugin
  enabled:     // {Boolean} Whether the plugin is enabled
}

#### **Resource Selector Patterns + Supported Actions**

-   **\`plugin\`**
    -   Creates a plugin
    -   Supported actions:
        -   \`create\`
-   **\`plugin[id]\`**
    -   Supported actions:
        -   \`update\`
        -   \`get\`
        -   \`delete\`
-   **\`pluginList\`**
    -   List of all plugins
    -   Supported actions:
        -   \`get\`

### Examples

#### Creating a Data Context

\`\`\`json
{
  "action": "create",
  "resource": "dataContext",
  "values": {
    "name": "myDataset",
    "title": "My Dataset",
    "description": "A sample dataset"
  }
}
\`\`\`

#### Creating a Collection

\`\`\`json
{
  "action": "create",
  "resource": "collection",
  "values": {
    "name": "People",
    "title": "Data about People",
    "parent": "_root_",
    "attrs": [
      {
        "name": "Name",
        "type": "categorical"
      },
      {
        "name": "Age",
        "type": "numeric",
        "precision": 0
      }
    ]
  }
}
\`\`\`

#### Creating Cases

\`\`\`json
{
  "action": "create",
  "resource": "case",
  "values": [
    {
      "values": {
        "Name": "Alice",
        "Age": 25
      }
    },
    {
      "values": {
        "Name": "Bob",
        "Age": 30
      }
    }
  ]
}
\`\`\`

#### Getting Data

\`\`\`json
{
  "action": "get",
  "resource": "collection[1].allCases"
}
\`\`\`

#### Updating Data

\`\`\`json
{
  "action": "update",
  "resource": "case[1]",
  "values": {
    "Age": 26
  }
}
\`\`\`

#### Deleting Data

\`\`\`json
{
  "action": "delete",
  "resource": "case[1]"
}
\`\`\`

#### Creating a graph component

\`\`\`json
{
  "action": "create",
  "resource": "component",
  "values": {
    "type": "graph",
    "dataContext": "My Dataset",
    "title": "Height vs Age",
    "xAttributeID": 7,
    "yAttributeID": 9
  }
}
\`\`\`

##### Graph adornments

Graphs can display adornments that show various measures along with the points. Plugins can modify adornments via create, update, and delete requests. These work similarly to how create, update, and delete requests work for components except that they are tied to a particular graph component.

Create, Update, and Delete are not fully implemented. Delete will work for all adornments. Create and Update are currently supported only by these:

- Count
- Percent
- Least Squares Line (LSRL)
- Mean
- Median
- Movable Value
- Standard Deviation
- Region of Interest

###### CREATE

1. Example: Count adornment create

Send:
\`\`\`json
{
  "action": "create",
  "resource": "component[graphId].adornment",
  "values": {
    "type": "Count"
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true,
  "values": {
    "id": "ADRNT0bgXef4xVhb",
    "showCount": true,
    "showPercent": false,
    "type": "Count",
    "data": [
      {
        "count": 27
      }
    ]
  }
}
\`\`\`

2. Example: Percent adornment create

Send:
\`\`\`json
{
  "action": "create",
  "resource": "component[123].adornment",
  "values": {
    "type": "Percent"
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true,
  "values": {
    "id": "ADRNkoqSZUmDf6YN",
    "showCount": false,
    "showPercent": true,
    "type": "Percent",
    "data": [
      {
        "percent": "88.89%",
        "categories": {
          "Habitat": "land"
        }
      },
      {
        "percent": "7.41%",
        "categories": {
          "Habitat": "water"
        }
      },
      {
        "percent": "3.7%",
        "categories": {
          "Habitat": "both"
        }
      }
    ]
  }
}
\`\`\`

3. Example: LSRL adornment create

Send:
\`\`\`json
{
  "action": "create",
  "resource": "component[123].adornment",
  "values": {
    "type": "LSRL"
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true,
  "values": {
    "id": "ADRNBvu_Wenqa3Kr",
    "isVisible": true,
    "showConfidenceBands": false,
    "type": "LSRL",
    "data": [
      {
        "category": "__main__",
        "intercept": 46.0819344740109,
        "rSquared": 0.2913769175823716,
        "sdResiduals": 18.367278750769525,
        "slope": -1.9882873643871106
      }
    ]
  }
}
\`\`\`

4. Example: Mean adornment create

Send:
\`\`\`json
{
  "action": "create",
  "resource": "component[123].adornment",
  "values": {
    "type": "Mean"
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true,
  "values": {
    "id": "ADRNHtTqhndWc0qx",
    "isVisible": true,
    "type": "Mean",
    "data": [
      {
        "mean": 10.791666666666666
      }
    ]
  }
}
\`\`\`

5. Example: Median adornment create

Send:
\`\`\`json
{
  "action": "create",
  "resource": "component[123].adornment",
  "values": {
    "type": "Median"
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true,
  "values": {
    "id": "ADRNHtTqhndWc0qx",
    "isVisible": true,
    "type": "Median",
            "data": [
          {
            "median": 11
          }
        ]
  }
}
\`\`\`

6. Example: Standard Deviation adornment create

Send:
\`\`\`json
{
  "action": "create",
  "resource": "component[123].adornment",
  "values": {
    "type": "Standard Deviation"
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true,
  "values": {
    "id": "ADRNlcE9eSUty0Rl",
    "isVisible": true,
    "type": "Standard Deviation",
    "data": [
      {
        "min": 4.998273378005741,
        "max": 16.58505995532759,
        "mean": 10.791666666666666
      }
    ]
  }
}
\`\`\`

7. Example: Movable Value adornment create

Send:
\`\`\`json
{
  "action": "create",
  "resource": "component[123].adornment",
  "values": {
    "type": "Movable Value"
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true,
  "values": {
    "id": "ADRNeH5WViQvDUDF",
    "isVisible": true,
    "type": "Movable Value",
    "data": [
      {
        "movableValues": [
          7
        ]
      }
    ]
  }
}
\`\`\`

If a numeric value for the Movable Value is not specified in the request, CODAP will automatically determine a value to use in the same way it does if you click a graph's "Add Movable Value" button in the CODAP UI. 

You can also specify a numeric value for the Movable Value. To do so, you need to supply a cell key for the subplot you want to add the value to in the request. When there is only a single, undivided plot, the cell key is {}.

\`\`\`json
{
  "action": "create",
  "resource": "component[43].adornment",
  "values": {
    "type": "Movable Value",
    "values": [["{}", 5]]
  }
}
\`\`\`

When there are multiple subplots due to categorical splits, you need to supply cell keys that correspond to the categorical values.

\`\`\`json
{
  "action": "create",
  "resource": "component[43].adornment",
  "values": {
    "type": "Movable Value",
    "values": [
      ["{\"Diet\":\"both\"}", 5],
      ["{\"Diet\":\"meat\"}", 6.5],
      ["{\"Diet\":\"plants\"}", 3]
    ]
  }
}
\`\`\`

\`\`\`json
{
  "action": "create",
  "resource": "component[43].adornment",
  "values": {
    "type": "Movable Value",
    "values": [
      ["{\"Diet\":\"both\", \"Habitat\":\"both\"}", 5],
      ["{\"Diet\":\"both\", \"Habitat\":\"land\"}", 10],
      ["{\"Diet\":\"both\", \"Habitat\":\"water\"}", 15],
      ["{\"Diet\":\"meat\", \"Habitat\":\"both\"}", 20],
      ["{\"Diet\":\"meat\", \"Habitat\":\"land\"}", 25],
      ["{\"Diet\":\"meat\", \"Habitat\":\"water\"}", 30],
      ["{\"Diet\":\"plants\", \"Habitat\":\"both\"}", 35],
      ["{\"Diet\":\"plants\", \"Habitat\":\"land\"}", 40],
      ["{\"Diet\":\"plants\", \"Habitat\":\"water\"}", 45]
    ]
  }
}
\`\`\`

8. Example: Region of Interest adornment create

Send:
\`\`\`json
{
  "action": "create",
  "resource": "component[43].adornment",
  "values": {
    "type": "Region of Interest",
    "primary": { "position": 0, "extent": 10 },
    "secondary": { "position": "20%", "extent": "50%" }
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true,
  "values": {
    "id": "ADRNuDEIIJzsJwXO",
    "isVisible": true,
    "type": "Region of Interest",
    "primary": "{\"extent\":10,\"position\":0}",
    "secondary": "{\"extent\":\"50%\",\"position\":\"20%\"}"
  }
}
\`\`\`

Both position and extent can take either a numeric coordinate value or a percent string value. A coordinate value corresponds to the values of the axis. A percentage value corresponds to a percentage of the plot.

The secondary value property is optional. If it is not specified in the request, the secondary extent will be 100% and the position will be 0.

###### UPDATE

Except for the Movable Value and Region of Interest, the only property you can update for most adornments that support update is the \`isVisible\` property.

1. Example: Count adornment update

Send:
\`\`\`json
{
  "action": "update",
  "resource": "component[123].adornment",
  "values": {
    "isVisible": false,
    "type": "Count"
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true
}
\`\`\`

2. Example: Movable Value adornment update

To modify an existing Movable Value, you need to supply the cell key for the Movable Value you want to adjust, and a new numeric value. When there is only a single, undivided plot, the cell key is {}.

Send:
\`\`\`json
{
  "action": "update",
  "resource": "component[43].adornment",
  "values": {
    "type": "Movable Value",
    "values": [["{}", 10]]
  }
}
\`\`\`

When there are multiple subplots due to categorical splits, you need to supply cell keys that correspond to the categorical values.

\`\`\`json
{
  "action": "update",
  "resource": "component[43].adornment",
  "values": {
    "type": "Movable Value",
    "values": [
      ["{\"Diet\":\"both\"}", 10],
      ["{\"Diet\":\"meat\"}", 20],
      ["{\"Diet\":\"plants\"}", 30]
    ]
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true
}
\`\`\`

3. Example: Region of Interest adornment update

Send:
\`\`\`json
{
  "action": "update",
  "resource": "component[43].adornment",
  "values": {
    "type": "Region of Interest",
    "primary": { "position": 10, "extent": 10 },
    "secondary": { "position": "10%", "extent": "100%" }
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true
}
\`\`\`

###### DELETE

1. Example: adornment delete

Send:
\`\`\`json
{
  "action": "delete",
  "resource": "component[123].adornment",
  "values": {
    "type": "Count"
  }
}
\`\`\`

Receive:
\`\`\`json
{
  "success": true
}
\`\`\`

Movable Value is currently the only adornment with its own special Delete handler. That allows API calls to actually delete Movable Value instances instead of just setting the adornment's \`isVisible\` property to \`false\`. This works similarly to clicking on the "Remove Movable Value" button in the CODAP UI where the most recently-added Movable Value will be removed. Subsequent delete requests will remove the next most-recently added Movable Value until all movable values have been removed.

### Error Handling

All API calls return a response object with the following structure:

\`\`\`json
{
  "success": true/false,
  "values": [...], // Data on success
  "error": "Error message" // On failure
}
\`\`\`

Common error scenarios:
- Invalid resource selector
- Missing required fields
- Permission denied
- Resource not found
- Invalid data type
- Formula syntax error

### Best Practices

1. **Resource Naming**: Use descriptive, unique names for resources
2. **Error Handling**: Always check the success field in responses
3. **Batch Operations**: Use arrays in values for creating multiple items
4. **Data Validation**: Ensure data types match attribute definitions
5. **Performance**: Use specific resource selectors rather than broad queries
6. **Security**: Validate all input data before sending to the API
7. **Monitoring**: Log API calls and responses for debugging
8. **Caching**: Cache frequently accessed data when appropriate
`;
