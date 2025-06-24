The Data Interactive Plugin API
Introduction
This document is intended to aid developers of CODAP Data Interactive Plugins. It describes the API by which Data Interactives interact with their CODAP host environment and send data for presentation by other CODAP components.

About Data Interactive Plugins
Data Interactive Plugins are a class of components that may be employed in a CODAP workspace. Their role is to provide to CODAP data for analysis. For example, Data Games are Data Interactives that export to CODAP the internal data generated during the execution of simple video games. By analyzing this data students can learn how to improve his or her performance in the game. The Inquiry Space project created a number of Data Interactives for sensor- or simulation-based investigation of the physical world. A student can perform an experiment and then export the data he or she created to CODAP for immediate analysis.

Data Interactives are loosely coupled with CODAP. They can be considered to be plug-ins in this respect. They need not have the same origin web server as the CODAP instance in which they are run. They are contained in IFrames and communicate with the CODAP engine through PostMessage-based transport.

About IFramePhone
The Data Interactives API uses IFramePhone as a transport library to implement communication between an installed Data Interactive and CODAP. IFramePhone is a wrapper for the PostMessage API. It simplifies the establishment of the connection and implements a simple remote procedure call (RPC) interface.

CODAP defines command object structures and response object structures that are passed through the IFramePhone connectors to the CODAP instance. In most cases, the Data Interactive initiates a command and passes a callback to receive the response object. Some commands are initiated from the CODAP side. The mechanics of IFramePhone interchange are the same in either case.

Definitions
Case: An individual record or relation. Cases have attributes.
Attribute: A field of a Case record. Cases of a given Collection all have the same set of Attributes.
Collection: A set of Cases with the same set of Attributes. Typically, Data Interactives will define a parent and a child Collection where zero, one, or many child Cases are associated with each parent case and exactly one parent case associate with each child case.
Data Context A set of collections. Data contexts define a chain of parent/child relationships among collections. There can be any number of collections in a data context. A typical data interactive will interact with a single data context. In CODAP a Data Context is synonymous with a data set.
API Overview
About Data Interactive-CODAP Communication Patterns
CODAP is oriented to the handling of hierarchically structured data. Often, the hierarchy is a natural consequence of the repetition of a process in the Data Interactive. For example, in scientific data interactives, the hierarchy will come about from the repetition of an experiment. The parent collections will describe the overall conditions and parameters of experiments, and the child collections, the samples taken during the execution of each experiment. Similarly, game Data Interactives are built on the natural repetitions built into game play. A game Data Interactive will have parent collections that represent the conditions and outcomes of the games, and the child collections will describe the moves or other events that occurred during the play of an individual game. The execution of such a program will be like this:

Set up environment
In a loop repeat:
Begin an experiment (or game)
Collect experimental samples (or game moves)
Conclude experiment (or game)
A Data Interactive following the above pattern would look like this:

Set up environment
Initialize IFramePhone connection
Find out if the interactive has saved prior state by getting the interactiveFrame.
Set the desired layout in CODAP by updating the interactiveFrame
Establish the structure of the data by creating a data context. This call will create collections and attributes.
In a loop repeat:
Begin an experiment (or game)
Call openCase to create the parent case. In the callback, fetch and store the case id.
Collect experimental samples (or game moves)
Call createCase to create a child case for each sample or game move.
Conclude experiment (or game)
Call closeCase to close the parent case.
Other patterns of interaction are possible, but the above pattern occurs pretty regularly.

Required Dependencies
This API requires the IFramePhone Library. It may be included in your HTML page, like this:

<script src="js/iframe-phone.js" type="text/javascript"></script>
There are no other dependencies for a Data Interactive. The Data Interactive will be placed in an IFrame and will be a draggable, resizable component within the CODAP workspace.

Establishing a IFramePhone link to CODAP
As soon as possible during the initialization process of the javascript you should initiate a communication link with the CODAP application. This permits exchange of messages between the Data Interactive and CODAP. Like this:

this.codapPhone = new iframePhone.IframePhoneRpcEndpoint(
  doCommandHandler, "data-interactive", window.parent);
Arguments:

handler: a function to respond to commands initiated from CODAP, see, CODAP-Initiated Actions.
name: a string identifying the Data Interactive to CODAP. The value must be "data-interactive".
target: the parent element. Generally you will pass window.parent.
Returns: an IFramePhone instance. This object has a method, call, that is used to issue commands to CODAP.

When CODAP activates a connection it will send this message to the Data Interactive: {message: "codap-present"}. This message is an historical artifact and doesn't conform to the pattern of requests and replies subsequently exchanged. It can, however, be taken as an indication that the communication is active.

Names, IDs, and Titles
CODAP has a two parallel schemes for referencing objects. Data Interactives may refer to objects by the value of their 'name' property. Data Interactives will generally specify the value of this property and are responsible for its uniqueness within its scope. Internally, CODAP will also assign an 'id' property and will use these values in references. The purpose of this dual naming is to facilitate the writing of data interactives without having to deal with the complexities of chaining asynchronous requests. Plugins can generally use either the 'name' property or the 'id' property in a resource clause of a request.

Generally, objects will be required to be created with names and these names are immutable once created. Names should be composed of letters, digits, or underscores, with the initial character being a letter. Often objects will also define a 'title' property. Titles are generally mutable. Titles are arbitrary strings. The title is employed where ever the object is referred to in the user interface, but, if absent, the name will be used.

An important exception to this rule is the Attribute. This is for historical reasons. Attribute names are mutable through the UI. Attribute names are displayed in the Case Table and graphs.

Collections and Cases versus Items
CODAP presents a hierarchical view of a data set. A data set may have multiple collections organized in series. Each collection has a set of cases and cases in a superordinate collection are related to one or more cases (called child cases) in the immediate subordinate collection. Every case in a subordinate collection is related to exactly one parent case in the collection's immediately superordinate collection.

This collections and cases view of a data set is engrained deeply in CODAP and is the Data Interactive API primarily supports this view. However, there is another view of data that has limited support through this API, that of Data Items. You can think of a Data Item as the union of attributes of a case in the most subordinate collection with the attributes of each of its ancestor cases. For example, using JSON object syntax to describe cases, if you have two collections, and a case in the parent collection has attributes:

{ "Mfr": "Chevrolet", "Model": "Equinox" }
and a child case has:

{ "Year": 20016, "MSRP": 23100 }
Then the corresponding item has the attributes of the parent case and the child case, as follows:

{ "Mfr": "Chevrolet", "Model": "Equinox", "Year": 20016, "MSRP": 23100 }
From the perspective of the Data Interactive, there can be several benefits to this view of data. If the data interactive is creating data and adding it to a data set in CODAP, it can be simpler to create items than it is to manage cases in a collection hierarchy. A CODAP user can reorganize the collection hierarchy, unless specifically prevented by the Data Interactive owning the data set. If the Data Interactive is only adding items, it permit this sort of reorganization.

Note: At this moment, creation is the only operation supported for data items.

The Structure of Messages
Request objects, generally, are JSON objects with 'action', 'resource', and 'values' properties. This is true whether the request was initiated by the Data Interactive or by CODAP. They look like this:

{
  "action": "create",
  "resource": "component",
  "values": {
    "type": "graph",
    "name": "myGraph",
    "dimensions": {"width": 320, "height": 240},
    "xAttributeName": "Age",
    "yAttributeName": "Height"
  }
}
action: one of 'create', 'update', 'get', 'delete', or 'notify'

create requests the creation of a resource in CODAP

update requests a modification of a resource in CODAP

get requests a facsimile of a resource from CODAP

delete requests the removal of a resource from CODAP

notify informs CODAP or the DI of an event, possibly providing identifying information about resources involved in the event.

resource: selects a resource or collection of resources. Resource selectors are strings.

values: An object or an array. For the 'create' action, passes one or more instances of the named object. For update, passes an object fragment with changed values.

Generally, 'create', 'update', and 'notify' requests require a 'values' property, and 'get' and 'delete' requests do not.

Response objects look like this:

{
  "success": true,
  "values": {

  }
}
success: a boolean indicating whether the action completed successfully.
values: Optional.
Generally, a success value will always be provided. 'Create' requests will return identifying information about the objects created. 'Get' requests will return a copy of the current state of the object. It will have a high degree of resemblance to the corresponding section of a CODAP document. Responses to 'update', 'delete', or 'notify' requests will generally not contain a 'values' property.

If an action fails, the "success" property will be set to false. An error message may be present, as follows:

{
  "success": false,
  "values": {
    "error": "Unknown message type: xxx"
  }
}
Often the API provides a list resource parallel to the principal object types. These are, naturally enough, named by appending 'List' to the base type. For example, the list resource for the DataContext base type is DataContextList and the list resource for the Attribute base type is AttributeList. List resources are provided as as a basic query capability. They generally only support the 'get' action, and they will return only identifying properties of the objects.

Compound requests
Requests from data interactives to CODAP may be combined into an array. They will be processed in the order they appear in the array. CODAP will return an array of return objects one for each request object and in order. For example,

Send:

  [{
    "action": "update",
    "resource": "interactiveFrame",
    "values": {
      "title": "DI-API Test",
      "version": "0.1",
      "preventBringToFront": false,
      "dimensions": {
        "width": 600,
        "height": 500
      }
    }
  },{
    "action": "get",
    "resource": "interactiveFrame"
  }]
Receive:

  [{
    "success": true
  },{
    "success": true,
    "values": {
      "title": "DI-API Test",
      "version": "0.1",
      "dimensions": {
        "width": 600,
        "height": 500
      }
    }
  }]
Data Types and Typeless Data
CODAP makes an effort to be flexible about data types. It will attempt to determine the most appropriate interpretation of the data-type for the context in which it is presented regardless of how it was introduced to CODAP. Here are the data types CODAP currently understands:

Numeric: Basically, integers or positive or negative decimal numbers. Numeric data may be sent to CODAP as Javascript numbers or as numeric strings. General the English/US interpretation of numeric strings is applied. Periods are interpreted as decimal points. Commas as grouping separators are not recognized, nor, are commas as decimal points, as is the interpretation in continental Europe.
Date: Dates or date/times. Generally, these are received by CODAP as strings. ISO dates or typical US date formats are generally recognized. Recognized US date formats include dd-mmm-yyyy, dd-mmm-yy, mm/dd/yy, mm/dd/yyyy (where ‘mmm' is three letter month string and ‘mm’ is one or two digit month number. For example 22-may-2016 or 05/22/16.) US time formats recognise hh:mm, hh:mm:ss, hh:mm:ss.ddd. AM or PM may be applied. If omitted, times will be interpretted as 24hour times. Times are recognised as a part of a date/time string, but not recognized independently. ISO date formats include: yyyy-mm-dd, yyyy-mm-dd hh:mm:ss, yyyy-mm-ddThh:mm:ss, but not yyyy-mm-dd hh:mm. Time zones are not understood.
Nominal: Strings that don't look like numbers or dates are interpreted to have this data type. Boolean values are also classified as Nominal.
Color: CODAP recognizes strings as colors if they conform to CSS syntax for rgb, rgba, or hex colors.
Drag and Drop of Attributes
You can drag attributes from a plugin to the CODAP main page under certain circumstances. This is useful for plugins that wish to permit the users to configure the axes of a graph, for example. To do this, the plugin must have the same origin as the CODAP instance (this is a browser enforced limitation.) You must also specify a special data transfer mime type in the DragStart handler. In this case, the mime type will carry data needed for CODAP to determine the attribute. It must be "application/x-codap-attr-xxx", where "xxx" is replaced with the id of the attribute that you have previously retrieved from CODAP. Like:

  dataTransfer.setData('application/x-codap-attr-' + id, id)
The value of is of this datatransfer item is not consulted, only the type.

Data Interactive-Initiated Actions
The command-specific arguments are documented by example in the sections below.

InteractiveFrames
Used to pass information relevant to the embedding of the interactive's iFrame in CODAP. The 'create' action is not supported, because, the frame will have already been created for the Data Interactive to exist.

Supported Actions: update, get, notify

Resource Selector Patterns:

'interactiveFrame' (update, get, notify)
The interactiveFrame object
{
  name: /* {String} The name of the interactive frame, will be synthesized by codap from the data interactive url. */
  title: /* {String} Settable and modifiable by the interactive, that will appear in the interactive's titlebar */
  version: /* {String} Settable and modifiable by the interactive, that will appear right-justified in the interactive's titlebar */
  dimensions: { /* Defines the dimensions of the interactive's screen real estate. */
    width: {Number} in pixels,
    height: {Number} in pixels
  },
  preventBringToFront: {Boolean} /* If true, prevents the data interactive
    from coming to the foreground upon selection. This may be desirable to allow
    graphs to be superimposed above the interactive. */
  preventDataContextReorg: {Boolean} /* If true, prevents the default data set for the data interactive
    from being reorganized in ways that the data interactive is unprepared to handle. For example, prevents
    operations that would create new collections or remove collections in the data set. */
  externalUndoAvailable: {Boolean} /* Indicates to the interactive that the current CODAP mode supports
    undo and can manage
    undo for the Data Interactive. See Undo topics elsewhere in this document. READONLY for the interactive. */
  standaloneUndoModeAvailable: {Boolean} /* Indicates to the interactive that CODAP is running in a mode that
    hides CODAP Undo and Redo buttons. If the interactive needs coordinated undo services and can provide
    controls, it should manage the initiation of Undo and Redo through the UndoButtonPress and RedoButtonPress
    notifications to CODAP. READONLY for the interactive. */
  cannotClose: {Boolean} /* if true, removes the close component control in the
    right corner of the component title bar. */
  isResizable: { /* If false, the user will not be able to change the flagged dimension. Defaults to true. */
    width: {Boolean}
    height: {Boolean}
  }
  savedState: /* {object} Content determined by data interactive, having been
   saved in a prior response to CODAP interactiveFrame request. READONLY for the interactive. */
}
Interactive Frame Notifications
Notifications are the means by which the plugin communicates transient occurrence that CODAP may wish to, or even should, respond to.

Notification values:

dirty: true

The user has altered the internal state of the plugin, so its state is no longer what was last reported to CODAP.

image: data url

Communicates a snapshot image of the plugin.

request: action

The plugin would like CODAP to initiate a change in the UI that can neither be captured by a component update nor a data operation. E.g. a request to invoke a toolbar button.

possible requests:

"openGuideConfiguration": requests that CODAP open the Guide Configuration Dialog
"indicateBusy": requests that CODAP disable inputs and provide an indication of ongoing activity (e.g. a splash screen or wait cursor).
"indicateIdle": requests that CODAP remove its busy indication.
cursorMode: requests that the busy indicator be a wait cursor and not a splash screen.

Example: Update Interactive Frame
Send:

{
  "action": "update",
  "resource": "interactiveFrame",
  "values": {
    "name": "Tester",
    "title": "DI-API Test",
    "version": "0.1",
    "preventBringToFront": false,
    "preventDataContextReorg": false,
    "cannotClose": true,
    "dimensions": {
      "width": 600,
      "height": 500
    }
  }
}
Receive:

{
  "success": true
}
Example: Get Interactive Frame
Send:

{
  "action": "get",
  "resource": "interactiveFrame"
}
Receive:

{
  "success": true,
  "values": {
    "name": "Tester",
    "title": "DI-API Test",
    "version": "0.1",
    "preventBringToFront": false,
    "preventDataContextReorg": false,
    "dimensions": {
      "width": 600,
      "height": 500
    },
    "externalUndoAvailable": true,
    "standaloneUndoModeAvailable": false
  }
}
Example: Notify Interactive Frame is dirty
Notifies CODAP that a change has occurred causing the plugin to be dirty. If auto-save is enabled, this will trigger an autosave. As a normal part of the document save process, CODAP will request the plugin's state and incorporate it into the current CODAP document.

Send:

{
  "action": "notify",
  "resource": "interactiveFrame",
  "values": {
    "dirty": true
  }
}
Receive:

{
  "success": true
}
Example: Notify Interactive Frame has screenshot
Notifies CODAP that a snapshot of the plugin's state is available, and passes that image. Image is expected to be a base64 data url with content type image/png or image/gif.

Send:

{
  "action": "notify",
  "resource": "interactiveFrame",
  "values": {
    "image": "data:image/png;base64,alksdfjaslkdjf=="
  }
}
Receive:

{
  "success": true
}
Example: Request Guide Configuration Menu
Requests that CODAP display the Guide Configuration dialog.

Send:

{
  "action": "notify",
  "resource": "interactiveFrame",
  "values": {
    "request": "openGuideConfiguration"
  }
}
Receive:

{
  "success": true
}
Example: Request Busy Indication
Requests that CODAP display an indication of non-interruptable activity, by default, the splash screen. This command will lock out user activity until the plugin requests 'indicateIdle', then the busy indication will be removed. It is the responsibility of the plugin to request 'indicateIdle'.

For a Splash screen indication, send:

{
  "action": "notify",
  "resource": "interactiveFrame",
  "values": {
    "request": "indicateBusy"
  }
}
For a translucent screen with a wait cursor, send:

{
  "action": "notify",
  "resource": "interactiveFrame",
  "values": {
    "request": "indicateBusy",
    "cursorMode": true
  }
}
Receive:

{
  "success": true
}
Example: Request Idle Indication
Requests that CODAP restore its normal view and normal interaction, removing the translucent screens that block user interaction.

Send:

{
  "action": "notify",
  "resource": "interactiveFrame",
  "values": {
    "request": "indicateIdle"
  }
}
Receive:

{
  "success": true
}
DataContexts
Specifies the properties of the set of collections that are organized in a hierarchy. An interactive may create more than one data context. A data context will be created by default for each data interactive at the time it is first requested. The default data context can be referred to by the name dataContext without brackets.

The API permits a plugin to create a Data Context from a URL referencing a data set that CODAP can interpret. Most often, this data set is a CSV formatted or tab-delimited text file. CODAP will infer the structure of the data set from the data it reads in. In the case of a CSV or tab-delimited text file, CODAP assumes that file is structured as a flat, non-hierarchical, data set and that the first line contains the names of the attributes.

Supported Actions: create, update, get, delete

Resource Selector Patterns:

dataContext (for create action or to refer to Data Interactive's default data context for update, get, and delete actions)
dataContext[name] (update, get, delete, notify)
dataContextList (get list)
dataContextByURL (create)
The dataContext object
{
  values: {
    name: /* {String} A unique string by which the interactive will refer to
            this data context. Once set, is cannot be changed.*/
    title: /* {String} Optional string to be used as the title of the case table
            for this data context. If not provided, _name_ will be displayed.*/
    description: /* {String} Currently not used but may be displayed in the future. */
    collections: /* {Object} Collections contained by the data context. (See
            below for object definition. ) */
  }
}
Example: Create Data Context
Notes:

The collections for a data context can be created with this command simply by providing the collection object in the values property of the request. See below for the structure of the collection object.
If there is already a data context present in the document a new data context with that name will not be made. Instead, the result will contain information about the existing data context.
Send:

{
  "action": "create",
  "resource": "dataContext",
  "values": {
    "name": "DataSet",
    "title": "A data set about people",
    "collections": [ {
      "name": "People",
      "title": "Data about People",
      "labels": {
        "singleCase": "person",
        "pluralCase": "people"
      },
      "attrs": [
        { "name": "Name" },
        { "name": "Age", "type": "numeric", "precision": 0 }
      ]
    }]
  }
}
Receive:

{
  "success": true,
  "values": {
    "name": "DataSet",
    "id": 17,
    "title": "A data set about people"
  }
}
Example: create dataContext from URL
Notes:

To succeed the URL must be configured to allow foreign origin requests.
As noted above, the URL would usually point to a CSV or tab-delimited file.
Send:

{
  "action": "create",
  "resource": "dataContextFromURL",
  "values": {
    "URL": "https://ed-public-download.apps.cloud.gov/downloads/Most-Recent-Cohorts-Scorecard-Elements.csv"
  }
}
Receive:

{
  "success": true
}
Example: Update Data Context
Notes:

The data context name, once created, cannot be changed.
Although collections can be created through the above 'create' action, they cannot be updated through this dataContext 'update' action. Use the 'update operation of the 'collection' object.
Send:

{
  "action": "update",
  "resource": "dataContext[DataSet]",
  "values": {
    "title": "A new title for the data set"
  }
}
Receive:

{
  "success": true
}
Example: Update Data Context causing rerandomization
Notes:

A data context may contain formulas that make use of functions that produce random values. Such data contexts may form the bases of a simulation. In such situations, a plugin can cause the data context's formulas to be re-evaluated, generating new random values. It does so by passing a rerandomize property with a value of true in an update. In response CODAP will re-evaluate all formulas that depend on functions that produce random values. It will do this once. If there are no such formulas, the update will have no effect.
The value of rerandomize is treated as "truthy" or "falsy," thus values of 1 and 0 will be treated the same as true and false.
Send:

{
  "action": "update",
  "resource": "dataContext[DataSet]",
  "values": {
    "rerandomize": true
  }
}
Receive:

{
  "success": true
}
Example: Delete Data Context
Notes:

The named data context will be removed from CODAP with all its collections and their associated attributes and case data.
Send:

{
  "action": "delete",
  "resource": "dataContext[DataSet]"
}
Receive:

{
  "success": true
}
Example: Get Data Context
Notes:

The get operation will return an object that contains any collections defined for the dataContext, and the collection attributes, but will not contain any case data.
Send:

{
  "action": "get",
  "resource": "dataContext[DataContext1]"
}
Receive:

{
  "success": true,
  "values": {
    "id": 2,
    "name": "DataCard2",
    "title": "A new title for the data set",
    "collections": [ {
      "name": "People",
      "title": "Data about People",
      "labels": {
        "singleCase": "person",
        "pluralCase": "people"
      },
      "attrs": [
        { "name": "Name" },
        { "name": "Age", "type": "numeric", "precision": 0 }
      ]
    }]
  }
}
Example: Get Data Context List
Notes:

Will return identifying properties for each dataContext.
Send:

{
  "action": "get",
  "resource": "dataContextList"
}
Receive:

{
  "success": true,
  "values": [ {
        "id": 2,
        "name": "DataSet2",
    "title": "A new title for the data set"
  },
    {
      "id": 3,
      "name": "DataSet3",
      "title": "Another title for the data set"
    }
  ]
}
Example: set aside cases
Send:

{
  "action": "notify",
  "resource": "dataContext[Mammals]",
  "values": {
    "request": "setAside",
    "caseIDs": [
      13,
      14
    ]
  }
}
Receive:

{
  "success": true
}
Example: restore set-aside cases
Send:

{
  "action": "notify",
  "resource": "dataContext[Mammals]",
  "values": {
    "request": "restoreSetasides"
  }
}
Receive:

{
  "success": true
}
Example: Sort attribute
Notes:

isDescending is an optional property, and if absent, will assume sort is ascending.
attr can be either the attribute name or the attribute id.
Send:

{
  "action": "update",
  "resource": "dataContext[Mammals]",
  "values": {
    "sort": {
      "attr": "Order",
      "isDescending": true
    }
  }
}
Receive:

{
  "success": true
}
Collections
A collection is a set of cases with a particular group of attributes. A collection is a part of a Data Context. It may have a parent collection and/or a child collection. If it has a parent collection, then each of its cases will have exactly one parent case in the parent collection. If it has a child collection, then each member case will have some number of child cases in the child collection.

Supported Actions: create, update, get, delete

Resource Selector Patterns:

'collection' (create)1
'collection[name]' (update, get, delete)1
'collectionList' (get list)1
'dataContext[name].collection' (create)
'dataContext[name].collection[name]' (update, get, delete)
'dataContext[name].collectionList' (get list)
1 Pattern applies to default data context

The collection object
{
    "name": /* {String} A unique string by which the interactive will refer to
                this collection. Once set, is cannot be changed.*/,
    title: /* {String} Optional string to be used as the title of this
                collection as reflected in the case table*/,
    description: /* {String} Currently not used but may be displayed in the
                future.*/,
    parent: /* {String} Name of parent collection. The parent collection should
                have been created before it can be referred to. If no parent is
                provided, the collection will be appended as the last collection
                in the collection list. "_root_" is a reserved name. It
                designates that this collection should be created as the parent
                collection to the current parent collection. */
    attrs:/* {[Object]} Optional array of attribute objects. The attribute
                object is defined below.*/,
    labels: /* {Object} Each of these fields is optional. */
    	singleCase: /* {String} used to refer to a single case. E.g. 'observation'*/,
    	pluralCase: /* {String} used to refer to more than one case. E.g. 'observations'*/,
    	singleCaseWithArticle: /* {String} showing how to prefix with an article. E.g. 'an observation'*/,
    	setOfCases: /* {String} used to refer to a group of cases. E.g. 'experiment'*/,
    	setOfCasesWithArticle: /* {String} showing how to prefix a set of cases with an article. E.g. 'an experiment'*/
}
Example: collection create
Notes:

Collection name must be unique within the data context.
Collection attributes can be specified within this request or, later, in a separate request.
A collection hierarchy is a strict hierarchy, so each collection can have at most one parent and child and every collection for a data context is in the hierarchy with no cycles.
The example creates a collection for the default data context.
If no parent is specified and the Data Context already has collections, then the new collection's parent will be the last collection in the collection list.
If "root" is specified for the parent property, the collection will be created as the root collection of the hierarchy: the ancestor of all other collections.
The values property can contain either a single collection or an array of collections. If an array is specified, they should be ordered first parent to last child. The example shows a hierarchy with two collections, "People" and "Measurements". "Measurements is a child collection of "People."
Send:

{
  "action": "create",
  "resource": "collection",
  "values": [{
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
Receive:

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
Example: collection update
Notes:

The collection name, once created, cannot be changed.
The 'update' action cannot be used to update the collection parent.
The 'update' action of collection should not be used to update the attribute definitions. If, for example, you need to add one or more additional attributes you should perform a create action on the collection's attribute resource. If you need to delete an attribute or change its properties you would perform a delete or update attribute operation.
Only one object can be updated per request.
Send:

{
  "action": "update",
  "resource": "dataContext[DataCard2].collection[People]",
  "values": {
    "title": "Students",
    "labels": {
      "singleCase": "student",
      "pluralCase": "students"
    }
  }
}
Receive:

{
  "success": true
}
Example: collection get
Send:

{
  "action": "get",
  "resource": "dataContext[DataCard2].collection[People]"
}
Receive:

{
  "success": true,
  "values": {
    "id": 3,
    "name": "People",
    "title": "Students",
    "labels": {
      "singleCase": "student",
      "pluralCase": "students"
    }
  }
}
Example: collection delete
If a collection is deleted, all its attributes will also be deleted.
Send:

{
  "action": "delete",
  "resource": "dataContext[DataCard].collection[People]"
}
Receive:

{
  "success": true
}
Example: collection list get
Send:

{
  "action": "get",
  "resource": "dataContext[DataCard2].collectionList"
}
Receive:

{
  "success": true,
  "values": [
      {
        "id": 45,
        "name": "People",
        "title": "People"
      },
      {
        "id": 46,
        "name": "Measurements",
        "title": "Measurements"
      }
  ]
}
Attributes
Attributes are typed properties of cases. They may be numeric or categorical (numbers or strings).

Supported Actions: create, update, get, delete

Resource Selector Patterns:

'collection[name].attribute' (create)1
'collection[name].attribute[name]' (update, get, delete)1
'collection[name].attributeList' (get list)1
'dataContext[name].collection[name].attribute' (create)
'dataContext[name].collection[name].attribute[name]' (update, get, delete)
'dataContext[name].collection[name].attributeList' (get list)
1 Pattern applies to default data context

The attribute object
{
    "name": /* {String}  Names must (a) be unique within the attributes of the
                    data context, and (b) be made up of letters, numbers and underscores.
                    Names which do not meet these criteria will be modified on creation to fit these
                    rules. Spaces and punctuation will be converted to underscores. */,
    "title": /* {String}. If not specified, the title of an attribute defaults to
  	                its name. */,
    "type": /* {'numeric' | 'categorical'} Optional. If not
                    specified, CODAP will decide dynamically whether to treat
                    the attribute as numeric or categorical based on the
                    presence of non-null, non-numeric values.*/,
    "colormap": /* {Object} Optional. For categorical attributes, a hashmap of values
                    to colors as hex strings. For numeric attributes, an object
                    with color assignments for the keys 'high-attribute-color',
                    'low-attribute-color', and 'attribute-color'. */
    "description": /* {String} Optional. A descriptive string that will appear
                    in the form of a tooltip in various situations
                    when user hovers over attribute name. */,
    "editable": /* {Boolean} Whether the values of the attribute can be edited by the user.
                    Defaults to true. */,
    "formula": /* {String} Optional. An expression. If present, the value of this attribute will be the
                    result of evaluation of the expression. See the rules for formatting expressions below. */,
    "hidden": /* {Boolean} Whether the attribute is hidden. Caution: use with care as there is currently
                    no UI support for managing hidden attributes from the CODAP side. */,
    "precision": /* {Number} For numeric attributes, the number of
                    digits to the right of the decimal point that will be
                    displayed in case table. Defaults to two. */,
    "unit": /* {String} Optional. The units of a numeric attribute. Displayed
                    in various places in the user interface. */
}
Attribute formula property expression formatting rules
The whole expression should be wrapped in double-quotes
Correct formatting: "formula": "LifeSpan > 30"
Incorrect formatting: "formula": LifeSpan > 30
The names of attributes should not be wrapped in any quotation marks
Correct formatting: "formula": "LifeSpan > 30"
Incorrect formatting: "formula": "'LifeSpan' > 30"
If an expression contains a value that is a string, it should be wrapped in single-quotes, or double-quotes with backwards slashes before them
Correct formatting:
"formula": "Diet='meat'"
"formula": "Diet==\"meat\""
Incorrect formatting:
"formula": "Diet=meat"
"formula": "Diet=”meat”"
Numerical values should not be wrapped in quotation marks
Correct formatting: "formula": "LifeSpan > 30"
Incorrect formatting: "formula": "LifeSpan > '30'"
Regardless of what collection level the new attribute with its formula is being created within, any attribute being used in the formula should be referenced ONLY by its name and not its collection path (i.e. Diet, not CollectionName.Diet)
Correct formatting:
  "action": "create",
  "resource": "dataContext[Mammals].collection[Diets].attribute",
  "values": [
   {
     "name": "Average LifeSpan",
     "type": "categorical",
     "title": "Average LifeSpan",
     "description": "The average lifespan for mammals that eat this diet",
     "editable": false,
     "formula": "mean(LifeSpan)"
   }
  ]
Incorrect formatting:
  "action": "create",
  "resource": "dataContext[Mammals].collection[Diets].attribute",
  "values": [
   {
     "name": "Average LifeSpan",
     "type": "categorical",
     "title": "Average LifeSpan",
     "description": "The average lifespan for mammals that eat this diet",
     "editable": false,
     "formula": "mean(Cases.LifeSpan)"
   }
  ]
Example: attribute create
Notes:

Attribute name must be unique within the data context.
Send:

{
  "action": "create",
  "resource": "dataContext[DataCard2].collection[Measurements].attribute",
  "values": [
    {
      "name": "sampleDate",
      "title": "date of sample",
      "type": "dateTime"
    },
    {
      "name": "Age",
      "title": "Age",
      "type": "numeric",
      "description": "Age of person in years",
      "precision": 0
    },
    {
      "name": "Height",
      "title": "Height",
      "type": "numeric",
      "description": "Height of person in inches",
      "precision": 1,
      "colormap": {
        "high-attribute-color": "#0000ff",
        "attribute-color": "#ccccff"
      }
    },
    {
      "name": "Flavor",
      "title": "Favorite ice cream flavor",
      "type": "categorical",
      "colormap": {
        "vanilla": "#f3e5ab",
        "chocolate": "#d2691e",
        "strawberry": "#fc5a8d"
      }
    }
  ]
}
Receive:

{
  "success": true
}
Example: attribute update
Notes:

The attribute name, once created, cannot be changed.
Send:

{
  "action": "update",
  "resource": "dataContext[DataCard2].collection[People].attribute[Height]",
  "values": {
      "precision": 2
    }
}
Receive:

{
  "success": true,
  "values": {
      "id": 8,
      "name": "Height",
      "title": "Height",
      "type": "numeric",
      "description": "Height of person in inches",
      "precision": 2
  }
}
Example: attribute get
Send:

{
  "action": "get",
  "resource": "dataContext[DataCard2].collection[People].attribute[Height]"
}
Receive:

{
  "success": true,
  "values": {
      "id": 8,
      "name": "Height",
      "title": "Height",
      "type": "numeric",
      "description": "Height of person in inches",
      "precision": 2
   }
}
Example: attribute delete
Send:

{
  "action": "delete",
  "resource": "dataContext[DataCard].collection[Measurements].attribute[Flavor]"
}
Receive:

{
  "success": true
}
Example: attribute list get
Note that the objects in the returned list have id, name and title as properties.

Send:

{
  "action": "get",
  "resource": "dataContext[DataCard2].collection[Measurements].attributeList"
}
Receive:

{
  "success": true,
  "values": [
    {
        "id": 8,
        "name": "SampleDate",
        "title": "SampleDate"
    },
    {
        "id": 9,
        "name": "Height",
        "title": "Height"
    },
    {
        "id": 12,
        "name": "Age",
        "title": "Age"
    },
    {
        "id": 13,
        "name": "Flavor",
        "title": "Flavor"
    }
]
}
AttributeLocations
This resource describes the location of an attribute in a data set by collection and position within the attribute list of the collection. It can be used to move an attribute from one location to another within the data set.

Supported Operation: update

Resource Selector Patterns:

'collection[name].attributeLocation' (update)
'dataContext[name].collection[name].attributeLocation' (update)
'dataContext[name].attributeLocation' (update)
The attributeLocation object
{
  "collection": /* name of the collection to move the attribute to or
    "parent" to move the attribute one collection up */,
  "position": /* zero indexed position of the attribute in the list of attributes
}
Cases
A case is an item which can be characterized by some knowable attributes. It may be a thing that can be measured and described, or it may be an event or observation. A case may describe the characteristics of an aggregate or it may be an individual member of a larger aggregate.

Supported Actions: create, update, get, delete

Resource Selector Patterns:

'dataContext[name].collection[name].case' (create, update)
'dataContext[name].collection[name].allCases' (get, delete)
'dataContext[name].collection[name].caseByID[id]' (get, update, delete)
'dataContext[name].collection[name].caseByIndex[index]' (get, update, delete)
'dataContext[name].collection[name].caseCount (get)
'dataContext[name].collection[name].caseSearch[search-expression]' (get)1
'dataContext[name].collection[name].caseFormulaSearch[search-expression]' (get)
'dataContext[name].caseByID[id]' (get, update, delete)
1 Deprecated: use caseFormulaSearch.

The case object
{
  id: /* {number} case id */
  parent: /* {String} Case selector */,
  values: /* {Object} key/value pairs, one for each attribute that gets a value.
  Key is attribute name.*/
}
Example: create case
Notes:

You can create one or more cases this way.
If the cases refer to a parent case, the parent must already exist.
Cases in child collections must have a parent.
Send:

{
  "action": "create",
  "resource": "dataContext[People].collection[Measurements].case",
  "values":[
    {
      "parent": 12,
      "values": {
        "SampleDate": "12/1/2015",
        "Age": 12,
        "Height": 66,
        "Favorite": "Vanilla"
      }
    }, {
      "parent": 13,
      "values": {
        "SampleDate": "12/1/2015",
        "Age": 11,
        "Height": 63,
        "Favorite": "Rocky Road"
      }
    }
  ]
}
Receive:

{
  "success": true,
  "values": [
    {
      "id": 15
    }, {
      "id": 16
    }
  ]
}
Example: update multiple cases by ID
Notes:

If a referenced case doesn't exist in CODAP. This will not cause the request to be failed.
If a referenced attribute doesn't exist, it will be be ignored. This will not cause the request to be failed.
The response message will list the cases found and updated, even if the attribute was not found or an attribute value was the same as the existing value.
Send:

{
  "action": "update",
  "resource": "dataContext[Mammals].collection[Mammals].case",
  "values": [
    {
      "id": 13,
      "values":  {
        "LifeSpan": 17
       }
    },
    {
      "id": 14,
      "values":  {
        "LifeSpan": 34
       }
    }
  ]
}
Receive:

{
  "success": true,
  "caseIDs": [
    13,
    14
  ]
}
Example: update case by ID
Effect: Updates a single case.

Notes:

Case ID is unique and sufficient within a DataContext, so 'collection[...]' phrase in the resource name is not required.
Send:

{
  "action": "update",
  "resource": "dataContext[People].collection[People].caseByID[15]",
  "values": {
    "values": {
      "Favorite": "Chocolate"
    }
  }
}
Receive:

{
  "success": true
}
Example: get case by index
Index values are numeric and range from 0 to n-1 where n is the number of cases in the collection.
Cases are ordered as in the case tables: grouped so that the children of each parent are together. Within this group they are ordered by arrival: oldest cases first.
Send:

{
  "action": "get",
  "resource": "dataContext[Mammals].collection[Diets].caseByIndex[0]"
}
Receive:

{
  "success": true,
  "values": {
    "case": {
      "id": 53,
      "parent": null,
      "collection": {
        "name": "Diets",
        "id": 52
      },
      "values": {
        "Diet": "plants"
      },
      "children": [ 13,14,20,21,25,36,37]
    },
    "caseIndex": 0
  }
}
Example: get case by ID
Send:

{
  "action": "get",
  "resource": "dataContext[People].collection[People].caseByID[15]"
}
Receive:

{
  "success": true,
  "values": {
    "case": {
    "id": 15,
      "values": {
        "Name": "Jim",
        "Age": 15,
        "Height": 68
      }
    }
  }
}
Example: get case by formula search
Notes:

Returns the cases that satisfy a formula expression. Formula expressions in CODAP are used to set the values of formula attributes. The CODAP website has a description of the syntax: https://codap.concord.org/help/work-functions. All cases are returned for which the formula returns a truthy value (boolean true, a non-zero number, or a non-empty string).
All strings must be quoted and attribute names should be surrounded by backquotes if they contain spaces or non-ascii characters.
Use of this resource is preferred to the 'caseSearch' resource.
Send:

{
  "action": "get",
  "resource": "dataContext[Mammals].collection[Mammals].caseFormulaSearch[Mass=max(Mass)]"
}
Receive:

{
  "success": true,
  "values": [
    {
      "id": 13,
      "parent": null,
      "collection": {
        "name": "Mammals",
        "id": 3
      },
      "values": {
        "Order": "Proboscidae",
        "Mammal": "African Elephant",
        "LifeSpan": 70,
        "Height": 4,
        "Mass": 6400,
        "Sleep": 3,
        "Speed": 40,
        "Habitat": "land",
        "Diet": "plants"
      }
    }
  ]
}
Example: get case by search
Notes:

Only simple expressions are supported of the form: attr oper value where 'attr' is an attribute name, 'oper' is one of '==', '!=', '<', '>', '<=', or '>=', and 'value' is a numeric or string value.
This API endpoint is deprecated in favor of the more capable caseFormulaSearch.
Send:

{
  "action": "get",
  "resource": "dataContext[Mammals].collection[Mammals].caseSearch[Mammal==Lion]"
}
Receive:

{
  "success": true,
  "values": [
    {
      "id": 30,
      "parent": null,
      "collection": {
        "name": "Mammals",
        "id": 3
      },
      "values": {
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
    }
  ]
}
Example: delete case by Index
Send:

{
  "action": "delete",
  "resource": "dataContext[People].collection[Measurements].caseByIndex[15]"
}
Receive:

{
  "success": true
}
Example: get all cases
Send:

{
  "action": "get",
  "resource": "dataContext[Mammals].collection[Mammals].allCases"
}
Receive:

{
  "success": true,
  "values": {
    "collection": {
      "name": "Mammals",
      "id": 3
    },
    "cases": [
      {
        "case": {
          "id": 13,
          "children": [],
          "values": {
            "Mammal": "African Elephant",
            "Order": "Proboscidae",
            "LifeSpan": 70,
            "Height": 4,
            "Mass": 6400,
            "Sleep": 3,
            "Speed": 40,
            "Habitat": "land",
            "Diet": "plants"
          }
        },
        "caseIndex": 0
      },
      // ...
    ]
  }
}
Example: delete all cases
Send:

{
  "action": "delete",
  "resource": "dataContext[People].collection[Measurements].allCases"
}
Receive:

{
  "success": true
}
Example: count cases
Send:

{
  "action": "get",
  "resource": "dataContext[People].collection[Measurements].caseCount"
}
Receive:

{
  "success": true,
  "values": 43
}
Items
Data Items are an alternate view of a data set. A data item can be thought of as a "complete" case: the union of a leaf (rightmost) case with its ancestor cases. That is, if you have a data set with three hierarchical collections, "A", "B", and "C", and suppose you have a case in collection "C", then its associated Data Item is the tuple consisting of the values of attributes this case, the values the attributes of its parent case in collection "B" and the values of the attributes of its grandparent case in collection "A".

Items can be accessed several ways. They can be accessed by sequential index (resource clause: 'item'), they can be accessed by ID (resource clause: 'itemByID'), they can be accessed by case id of a case that refers to them (resource clause: 'caseID'), or they can be accessed by search (resource clause: 'itemSearch').

Supported Actions: create, update, delete, get

Resource Selection Patterns:

'dataContext[name].item' (create, update)
'dataContext[name].item[index]' (get, update, delete)
'dataContext[name].itemByID[id]' (get, update, delete)
'dataContext[name].itemByCaseID[id]' (get, update, delete)
'dataContext[name].itemSearch[expr]' (get, delete)
'dataContext[name].itemCount' (get)
The item object
The item object is a map of non-formula attribute names to values. For example:

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
Example: Create One Item
Send:

{
  "action": "create",
  "resource": "dataContext[Mammals].item",
  "values": {
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
}
Receive:

{
  "success": true,
  "caseIDs": [
    57
  ],
  "itemIDs": [
    "id:AoD-mEmPTNCCS9SC"
  ]
}
Example: Create Items
Send:

{
  "action": "create",
  "resource": "dataContext[Mammals].item",
  "values": [{
        "Mammal": "Jaguar",
        "Order": "Carnivora",
        "LifeSpan": 20,
        "Height": 1.8,
        "Mass": 115,
        "Sleep": 11,
        "Speed": 60,
        "Habitat": "land",
        "Diet": "meat"
      },{
        "Mammal": "Killer Whale",
        "Order": "Cetacea",
        "LifeSpan": 50,
        "Height": 6.5,
        "Mass": 4000,
        "Sleep": "",
        "Speed": 48,
        "Habitat": "water",
        "Diet": "meat"
      }
  ]
}
Receive:

{
  "success": true,
  "caseIDs": [
    58,
    59
  ],
  "itemIDs": [
    "id:GTaBRDxhb4yP8yaN",
    "id:B5XmlRCjaRRqRGcH"
  ]
}
Example: item get by item id
Send:

{
  "action": "get",
  "resource": "dataContext[Mammals].itemByID[id:u__D8skHsFBskPdd]"
}
Receive:

{
  "success": true,
  "values": {
    "values": {
      "Mammal": "African Elephant",
      "Order": "Proboscidae",
      "LifeSpan": 17,
      "Height": 4,
      "Mass": 6400,
      "Sleep": 3,
      "Speed": 40,
      "Habitat": "land",
      "Diet": "plants"
    },
    "id": "id:u__D8skHsFBskPdd"
  }
}
Example: item get by case id
Send:

{
  "action": "get",
  "resource": "dataContext[Mammals].itemByCaseID[20]"
}
Receive:

{
  "success": true,
  "values": {
    "values": {
      "Mammal": "Donkey",
      "Order": "Perissodactyla",
      "LifeSpan": 40,
      "Height": 1.2,
      "Mass": 187,
      "Sleep": 3,
      "Speed": 50,
      "Habitat": "land",
      "Diet": "plants"
    },
    "id": "id:abP83Pfzfs3ZDygR"
  }
}
Example: item get by search
Item search expressions generally have the form:
  attribute_name operator value
Where attribute_name is the name of an attribute, operator is one of "==", "!=", "<", "<=", ">", ">=", and value is a string, numerical, or boolean value, as appropriate.

Item search also supports a wild card, *, that matches all items.
Send:

{
  "action": "get",
  "resource": "dataContext[Mammals].itemSearch[Mammal==Donkey]"
}
Receive:

{
  "success": true,
  "values": [
    {
      "values": {
        "Mammal": "Donkey",
        "Order": "Perissodactyla",
        "LifeSpan": 40,
        "Height": 1.2,
        "Mass": 187,
        "Sleep": 3,
        "Speed": 50,
        "Habitat": "land",
        "Diet": "plants"
      },
      "id": "id:abP83Pfzfs3ZDygR"
    }
  ]
}
Send:

{
  "action": "get",
  "resource": "dataContext[Mammals].itemSearch[*]"
}
Receive:

{
  "success": true,
  "values": [
    {
      "values": {
        "Mammal": "African Elephant",
        "Order": "Proboscidae",
        "LifeSpan": 17,
        "Height": 4,
        "Mass": 6400,
        "Sleep": 3,
        "Speed": 40,
        "Habitat": "land",
        "Diet": "plants"
      },
      "id": "id:u__D8skHsFBskPdd"
    },
    {
      "values": {
        "Mammal": "Asian Elephant",
        "Order": "Proboscidae",
        "LifeSpan": 34,
        "Height": 3,
        "Mass": 5000,
        "Sleep": 4,
        "Speed": 40,
        "Habitat": "land",
        "Diet": "plants"
      },
      "id": "id:NiHdzbygLteiLirP"
    },
...
  ]
}
Example: item update by item id
Send:

{
  "action": "update",
  "resource": "dataContext[Mammals].itemByID[id:u__D8skHsFBskPdd]",
  "values": {
    "Mass": "7777"
  }
}
Receive:

{
  "success": true,
  "values": {
    "createdCases": [],
    "deletedCases": []
  }
}
Example: item update by case id
Send:

{
  "action": "update",
  "resource": "dataContext[Mammals].itemByCaseID[20]",
  "values": {
    "Sleep": "20"
  }
}
Receive:

{
  "success": true,
  "values": {
    "createdCases": [],
    "deletedCases": []
  }
}
Example: update multiple items
Its possible to update multiple items in a single request. Use the resource specification without indicating an id. Specify values as an array of item objects, with id, as in the example below.

Send:

{
  "action": "update",
  "resource": "dataContext[Mammals].item",
  "values": [
     {
       "id": "id:1A4G6RaW9X2bc_H",
       "values": {
         "Height": "60"
       }
     },
     {
       "id": "id:q3MZKW6nMofQhx_H",
       "values": {
         "Height": "60"
       }
     }
  ]
}
Receive: json { "success": true, "values": { "createdCases": {}, "deletedCases": {} } }

Example: item delete by search
Send:

{
  "action": "delete",
  "resource": "dataContext[Mammals].itemSearch[Diet==plants]"
}
Receive:

{
  "success": true,
  "values": [
    "id:u__D8skHsFBskPdd",
    "id:NiHdzbygLteiLirP",
    "id:abP83Pfzfs3ZDygR",
    "id:V06SOWduQzzlzEQa",
    "id:cKL2c3V9I8yx8Q8w",
    "id:_qFN98M8J9K4SguK",
    "id:S6SjvuM1rqEaKPyv"
  ]
}
Example: item count
Send:

{
  "action": "get",
  "resource": "dataContext[Mammals].itemCount"
}
Receive:

{
  "success": true,
  "values": 27
}
SelectionLists
This API is for managing selection of cases in CODAP.

Supported Actions: create, update, get

Resource Selection Patterns:

'dataContext[name].selectionList' (create, update, get)
'selectionList' (create, update, get for default data context)
The selectionList object
The selectionList object is just an array of case ids. Cases may belong to different collections. Selection is inherited by the children of cases, so more cases may be displayed in CODAP after the selectionList request is sent.

[
  25,
  29,
  30
]
Example: selectionList create
Send:

{
  "action": "create",
  "resource": "dataContext[name].selectionList",
  "values": [
      25,
      29,
      30
  ]
}
Receive:

{
  "success": true
}
Example: selectionList update
Notes

selectionList update adds to the existing selection.
Send:

{
  "action": "update",
  "resource": "dataContext[name].selectionList",
  "values": [
      25,
      29,
      30
  ]
}
Receive:

{
  "success": true
}
Example: selectionList get
Send:

{
  "action": "get",
  "resource": "dataContext[name].selectionList"
}
Receive:

{
  "success": true,
  "values": [
    {
      "collectionID": 3,
      "collectionName": "Mammals",
      "caseID": 36
    },
    {
      "collectionID": 3,
      "collectionName": "Mammals",
      "caseID": 37
    },
    {
      "collectionID": 3,
      "collectionName": "Mammals",
      "caseID": 25
    }
  ]
}
Components
Components are independently manipulated graphical elements in the CODAP UI. They can be positioned and sized. Often they present a visualization of an underlying data set. For example, graphs, case tables, maps, and sliders are all components.

Component objects share a base set of properties that identify them and position and size them in the UI. They may add additional configuration properties according to their type.

The position property can specify a positioning rule ('top' or 'bottom') or specify an explicit location. If the former, the layout manager will place the component so to avoid overlap with existing components.

Supported Actions: create, update, delete, get, notify

Resource Selection Patterns:

'component' (create)
'component[name]' (get, update, delete, notify)
'component[id]' (get, update, delete, notify)
'componentList' (get)
Notifications

A component can issue a notification to influence other components in a limited number of ways. It can cause another component to be selected and can cause another component (e.g. a Case Table or Graph) to autoscale. It does this by issuing a notification specifying the target component as the resource and setting a value of an object with a single property, 'request'. The property, 'request', should have the value of 'select' or 'autoScale'.

The graph object
{
  type: 'graph'
  name: /*{String}. Must be unique. */
  title: /*{String} Optional. Displayed in graph titlebar. If omitted, graph name is used. */
  dimensions: {
    width: /* {Number} in pixels*/,
    height: /* {Number in pixels */
  }
  backgroundColor: /* {String} The color of the graph's background in hex format */
  cannotClose: /* {Boolean} Whether close button is displayed in upper right */
  captionAttributeName: /* {String} The name of the attribute assigned to the caption */
  captionAttributeID: /* {Number} The id of the attribute assigned to the caption */
  dataContext: /* {String} Name of a data context */
  displayOnlySelectedCases: /* {Boolean} Whether the graph displays all or only selected cases */
  enableNumberToggle: /* {Boolean} whether the numberToggle display should be
    presented in this graph */
  filterFormula: /* {String} The formula used to filter cases out of the graph */
  hiddenCases: /* {Number[]} An array of ids of the cases explicitly hidden in the graph */
  legendAttributeName: /* {String} An attribute name within the data context */
  legendAttributeID: /* {Number} The id of the attribute assigned to the legend */
  numberToggleLastMode: /* {Boolean} whether numberToggle display should be in "last mode" */
  pointColor: /* {String} The color of the graph's points in hex format */
  pointConfig: /* {points|bars|bins|histogram} The way in which points are being displayed */
  pointsFusedIntoBars: /* {Boolean} Whether the graph's points should be displayed as bars */
  pointSize: /* {Number} The size of the graph's points. 1 is normal, 0.5 is half, 2 is double. */
  position: /* {String} Default is 'top'. If 'bottom' CODAP will position the graph in empty space as
    close to the bottom of the document as it can manage. */
  rightSplitAttributeName: /* {String} The name of the attribute assigned to the right split */
  rightSplitAttributeID: /* {Number} The id of the attribute assigned to the right split */
  showMeasuresForSelection: /* {Boolean} Whether or not measurements are displayed for selected cases */
  strokeColor: /* {String} The color of the graph's points' outlines in hex format */
  strokeSameAsFill: /* {Boolean} Whether the graph's points should have the same outline as fill color */
  topSplitAttributeName: /* {String} The name of the attribute assigned to the top split */
  topSplitAttributeID: /* {Number} The id of the attribute assigned to the top split */
  transparent: /* {Boolean} Whether the graph should have a transparent background */
  xAttributeName: /* {String} An attribute name within the data context */
  xAttributeID: /* {Number} The id of the attribute assigned to the x axis */
  xAttributeType: /* {numeric|categorical|date|qualitative|boundary|checkbox|color} The type
    interpretation of the attribute on the x axis. The attribute may be interpreted differently
    than the attribute's actual type. */
  xLowerBound: /* {Number} The lower bound of the x axis */
  xUpperBound: /* {Number} The upper bound of the x axis */
  yAttributeName: /* {String} An attribute name within the data context */
  yAttributeNames: /* {String[]} An array of the names of all attributes assigned to the y axis */
  yAttributeID: /* {Number} The id of the first attribute assigned to the y axis */
  yAttributeIDs: /* {Number[]} An array of the ids of all attributes assigned to the y axis */
  yAttributeType: /* {numeric|categorical|date|qualitative|boundary|checkbox|color} The type
    interpretation of the on the y axis. The attributes may be interpreted differently than the
    attributes' actual type. */
  yLowerBound: /* {Number} The lower bound of the y axis */
  yUpperBound: /* {Number} The upper bound of the y axis */
  y2AttributeName: /* {String} An attribute name within the data context */
  y2AttributeID: /* {Number} The id of the attribute assigned to the y2 (right numeric) axis */
  y2AttributeType: /* {numeric|categorical|date|qualitative|boundary|checkbox|color} The type
    interpretation of the attribute on the y2 axis. The attribute may be interpreted differently than
    the attribute's actual type. */
  y2LowerBound: /* {Number} The lower bound of the y2 axis */
  y2UpperBound: /* {Number} The upper bound of the y2 axis */
}
The caseTable object
{
  type: 'caseTable',
  name: /*{String}. Must be unique, and is settable only at create time. */,
  title: /*{String} Optional. Displayed in graph titlebar. If omitted, graph name is used. */,
  dimensions: {
    width: /* {Number} in pixels*/,
    height: /* {Number in pixels */
  },
  position: /*{String} Default is 'top'. If 'bottom' CODAP will position the graph in empty space as close to the bottom of the document as it can manage.*/,
  cannotClose: /* {Boolean} Whether close button is displayed in upper right
  dataContext: /* {String} Name of a data context */
  horizontalScrollOffset: /* {Number} Scroll offset in pixels from the left. */
  isIndexHidden: /* {Boolean} Whether the index column is shown in case table collections */
}
The map object
{
  type: 'map',
  name: /*{String}. Must be unique, and is settable only at create time. */,
  title: /*{String} Optional. Displayed in graph titlebar. If omitted, graph name is used. */,
  dimensions: {
    width: /* {Number} in pixels*/,
    height: /* {Number in pixels */
  },
  position: /*{String} Default is 'top'. If 'bottom' CODAP will position the graph in empty space as close to the bottom of the document as it can manage.*/,
  cannotClose: /* {Boolean} Whether close button is displayed in upper right
  dataContext: /* {String} Name of a data context */
  legendAttributeName: /* {String} Name of the attribute to be displayed in the legend. Optional. */
  center: /* {Array} a two element array consisting of a decimal latitude and longitude of the desired map center. */
  zoom: /* {Number} A zoom factor. 1: entire globe, higher numbers closer in. */
}
The slider object
Note: Global object must exist prior to slider object creation. Initial value of slider comes from the Global.

{
  "type": "slider",
  "title": /* {String} A title to be displayed in the components top bar. */,
  "dimensions": {
    "width": /* {number} pixels */,
    "height": /* {number} pixels */
  },
  "position": /* {"top"||"bottom"||{"left": {number}, "top": {number} } See above discussion */,
  "cannotClose": /* {Boolean} Whether close button is displayed in upper right
  "globalValueName": {string},/* Name of global value slider is manageing.
                                 Global value must be created prior to slider creation. */
  "animationDirection": {number},
  "animationMode": {number},
  "lowerBound": {number},
  "upperBound": {number}
}
The calculator object
{
  type: 'calculator',
  name: /*{String}. Must be unique. */,
  title: /*{String} Optional. Displayed in graph titlebar. If omitted, graph name is used. */,
  dimensions: {
    width: /* {Number} in pixels. Not settable.*/,
    height: /* {Number in pixels. Not settable. */
  },
  position: /*{String} Default is 'top'. If 'bottom' CODAP will position the graph in empty space as close to the bottom of the document as it can manage.*/,
  cannotClose: /* {Boolean} Whether close button is displayed in upper right
}
The text object
{
  type: 'text',
  name: /*{String}. Must be unique. */,
  title: /*{String} Optional. Displayed in graph titlebar. If omitted, graph name is used. */,
  dimensions: {
    width: /* {Number} in pixels*/,
    height: /* {Number in pixels */
  },
  position: /*{String} Default is 'top'. If 'bottom' CODAP will position the graph in empty space as close to the bottom of the document as it can manage.*/,
  cannotClose: /* {Boolean} Whether close button is displayed in upper right
  text: /*{String} The text displayed in the component .*/
}
The webView object
Note that setting the dimensions is required for a webView component.

{
  type: 'webView',
  name: /*{String}. Must be unique. */,
  title: /*{String} Optional. Displayed in graph titlebar. If omitted, graph name is used. */,
  dimensions: {
    width: /* {Number} in pixels*/,
    height: /* {Number in pixels */
  },
  position: /*{String} Default is 'top'. If 'bottom' CODAP will position the graph in empty space as close to the bottom of the document as it can manage.*/,
  cannotClose: /* {Boolean} Whether close button is displayed in upper right
  URL: /* {String} */
}
The guide object
Specify some number of guide pages as "items". Guide pages are name, url combinations.
There can only be one guide, so if you attempt to create a new one, this will be ignored. Use update instead.
If isVisible is true, the guide page will be presented. Otherwise it will be hidden.
{
  type: 'guideView',
  name: /*{String}. Must be unique. */,
  title: /*{String} Optional. Displayed in graph titlebar. If omitted, graph name is used. */,
  dimensions: {
    width: /* {Number} in pixels*/,
    height: /* {Number in pixels */
  },
  position: /*{String} Default is 'top'. If 'bottom' CODAP will position the graph in empty space as close to the bottom of the document as it can manage.*/,
  cannotClose: /* {Boolean} Whether close button is displayed in upper right */,
  isVisible: /* {Boolean} Whether the guide is visible */,
  currentItemIndex: /* {non-negative Integer} index of the guide section to be displayed. Zero refers to the first item. */
  items: [{
    itemTitle:  /* {String} */,
    url: /* {String */
  },...
  ]
}
Example: create graph component
Send:

{
  "action": "create",
  "resource": "component",
  "values": {
    "type": "graph",
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
Receive:

{
  "success": true
}
Example: create slider component
Send:

[
  {
    "action": "create",
    "resource": "global",
    "values": {
      "name": "g2",
      "value": 0
    }
  },
  {
    "action": "create",
    "resource": "component",
    "values": {
      "title": "slider-title",
      "type": "slider",
      "globalValueName": "g2",
      "lowerBound": -10,
      "upperBound": 10
    }
  }
]
Receive:

[
  {
    "success": true,
    "values": {
      "name": "g2",
      "value": 0,
      "id": 10
    }
  },
  {
    "success": true,
    "values": {
      "id": 11,
      "name": "slider-title",
      "title": "slider-title",
      "type": "slider"
    }
  }
]
Example: update map component
Tells CODAP to change legend on a map.

Send:

{
  "action": "update",
  "resource": "component[myMap]",
  "values": {
	  "legendAttributeName": "Height",
    "center": [34.75, -114.328],
    "zoom": 6
  }
}
Receive:

{
  "success": true
}
Example: display guide
Display the guide, assuming it currently is not displayed.

Send:

{
  "action": "update",
  "resource": "component[myGuide]",
  "values": {
	  "isVisible": true
  }
}
Receive:

{
  "success": true
}
Example: get caseTable component
Tells CODAP to create a case table.

Send:

{
  "action": "get",
  "resource": "component[myTable]"
}
Receive:

{
  "success": true,
  "values": {
      "type": "caseTable",
      "name": "myTable",
      "dimensions": {
        "width": 320,
        "height": 240
      },
      "position": "top",
      "dataContext": "DataCard"
  }
}
Example: get component list
Returns an array of identifying information for existent components.

Send:

{
  "action": "get",
  "resource": "componentList"
}
Receive:

{
  "success": true,
  "values": [
    {
      "id": 2,
      "type": "game"
    },
    {
      "id": 8,
      "title": "My Data Context",
      "type": "caseTable"
    }
  ]
}
Example: delete slider component
Tells CODAP to delete a slider.

Send:

{
  "action": "delete",
  "resource": "component[mySlider]"
}
Receive:

{
  "success": true
}
Example: notify of component selection
Notifies CODAP that the plugin requests selection of a component. Selecting a component brings it to the foreground and activates its inspector.

Send:

{
  "action": "notify",
  "resource": "component[mySlider]",
  "values": {
    "request": "select"
  }
}
Receive:

{
  "success": true
}
Globals
Global values, in CODAP are named values that can be manipulated with a slider.

Supported Actions: create, update, get

Resource Selector Patterns:

global (create)
global[name] (update, get)
globalList (get)
The global object
{
  name: /* {String} */
  value: /* {Number} */
}
Example: Create Global Value
Send:

{
  "action": "create",
  "resource": "global",
  "values": {
    "name": "x",
    "value": "1"
  }
}
Receive:

{
  "success": true,
  "values": {
    "id": 2,
    "name": "x"
  }
}
Example: Update Global Value
Notes:

name may not be modified through this API.
Send:

{
  "action": "update",
  "resource": "global[x]",
  "values": {
    "value": "2"
  }
}
Receive:

{
  "success": true
}
Example: Get Global Value
Notes:

Send:

{
  "action": "get",
  "resource": "global[x]"
}
Receive:

{
  "success": true,
  "values": {
    "name": "x",
    "value": 2
  }
}
Example: Get Global Value List
Notes:

Send:

{
  "action": "get",
  "resource": "globalList"
}
Receive:

{
  "success": true,
  "values": [{
      "name": "v1",
    "value": 0
  },
    {
      "name": "x",
      "value": 2
    }
  ]
}
Formula Engine
The Formula Engine can be used to evaluate and get information about CODAP formulas from your plugin.

Supported Actions: get, notify

Resource Selector Patterns:

'formulaEngine' (get, notify)
The argument object
{
  name: /* {String} The name of the argument. */
  description: /* {String} The description of the argument. */
  required: /* {Boolean} Whether the argument is required. */
  type: /* {String} The type of the argument, e.g. "number", "string",
           "boolean", etc. */
}
The function object
{
  name: /* {String} The name of the function. */
  displayName: /* {String} The display name of the function. */
  description: /* {String} The description of the function. */
  category: /* {String} The category of the function. Can be "Arithmetic
               Functions", "Data/Time Functions", "Lookup Functions",
               "Other Functions", "Statistical Functions", "String Functions",
               or "Trigonometric Functions". */
  args: /* {[Argument]} An array of argument objects representing the arguments
           to this function. */
  examples: /* {[String]} An array of example formulas using this function */
  maxArgs: /* {Number} The maximum number of arguments allowed */
  minArgs: /* {Number} The minimum number of arguments allowed */
}
Example: get information about built-in functions
Send:

{
  "action": "get",
  "resource": "formulaEngine"
}
Receive:

{
  "success": true,
  "values": {
    "Arithmetic Functions": {
      "abs": { "name": "abs", "displayName": "abs", ... },
      ...
    },
    "Date/Time Functions": {
      "date": { "name": "date", "displayName": "date", ... },
      ...
    },
    ...
  }
}
Example: evaluate a CODAP formula
Notes:

The records field should contain an array of environments in which the given formula gets evaluated.
As many results will be produced as the number of records.
Send:

{
  "action": "notify",
  "resource": "formulaEngine",
  "values": {
    "request": "evalExpression",
    "source": "a + 1",
    "records": [
      {
        "a": 1
      },
      {
        "a": 2
      },
      {
        "a": 3
      }
    ]
  }
}
Receive:

{
  "success": true,
  "values": [
    2,
    3,
    4
  ]
}
Configuration
CODAP has very minimal in the way of configuration options. At the time of this writing there is only one configuration parameter that can be set through the plugin API. But this may change in the future.

Supported Actions: get, update

Resource Selector Patterns:

configuration[name] (update, get)
configurationList (get)
The configuration object

{
    name: /* {String} */
    value: /* {String} */
}
Example: Update Configuration Value

Send:

{
"action": "update",
"resource": "configuration[gaussianFitEnabled]",
"values": {
  "value": "yes"
  }
}
Receive:

{
"success": true
}
Example: Get Configuration Value

Send:

{
"action": "get",
"resource": "configuration[gaussianFitEnabled]"
}
Receive:

{
"success": true,
"values": {
    "name": "gaussianFitEnabled",
    "value": ""
  }
}
Example: Get Configuration List

Send:

{
"action": "get",
"resource": "configurationList"
}
Receive:

{
    "success": true,
    "values": [{
      "name": "gaussianFitEnabled",
      "value": "yes"
      }
    ]
}
LogMessages
Tells CODAP to log a message to CODAP's Log Server. As a side effect, notifies CODAP that the plugin's state has changed in a material way, and CODAP should consider this state to be "dirty". If autosave is enabled for CODAP this will trigger document save activity.

Supported Actions: notify

Resource Selector Patterns:

'logMessage' (notify)
The logMessage object
{
  formatStr: /* Format string for the log statement. Use %@ for replaceable
  parameters. The format string follows SproutCore string format conventions,
  so %@1 can be used for specific identification. E.g. 'Launched rocket with
  %@ engine toward %@' */,
  replaceArgs: /* [*] An array of values used to replace %@ instances in
  formatStr. E.g. ['red', 'satellite']*/
}
Example: logMessage notify
Send:

{
  "action": "notify",
  "resource": "logMessage",
  "values": {
    "formatStr": "Launched rocket with %@ engine toward %@",
    "replaceArgs": ["red", "satellite"]
  }
}
Receive:

{
  "success": true
}
UndoChangeNotices
Notifies CODAP of a Data Interactive Change relating to Undo/Redo according to the 'operation' property.

If the operation is 'undoableActionPerformed', notifies CODAP that the DI has performed an undoable action. This is used when the DI expects CODAP to take control over undoing and redoing actions. No arguments are sent, CODAP simply adds a "data interactive undoable action" to its undo stack, and when a user clicks Undo and Redo at the appropriate point in the stack, CODAP sends undoAction or redoAction to the DI as appropriate. The Data Interactive is responsible for maintaining its own undo stack, CODAP is simply responsible for initiating the undo or redo events.

If the operation is 'UndoButtonPressed', or 'RedoButtonPressed', then we assume the data interactive has an undo or redo button and this is a notice of a user event on this control. CODAP will respond to this event by performing the action as if its own undo or redo button had been pressed.

CODAP replies will include a brief summary of the state of the undo and redo stacks. If there is an undoable action on the undo stack, codap replies will report "canUndo" as true. Likewise, if the is a redoable action on the redo stack it will report "canRedo" as true.

Supported Actions: notify

Resource Selector Patterns:

'undoChangeNotice' (notify)
The undoChangeNotice object
{
  operation: /* {'undoableActionPerformed'|'undoButtonPress'|'redoButtonPress'} */,
  logMessage: /* {string} An optional log message. */
}
Example: undoChangeNotice notify
Send:

{
  "action": "notify",
  "resource": "undoChangeNotice",
  "values": {
    "operation": "undoableActionPerformed",
    "logMessage": "Set focal length: 1m"
  }
}
Receive:

{
  "success": true,
  "values": {
    "canUndo": true,
    "canRedo": false
  }
}
Example: undoButtonPress notify
Send:

{
  "action": "notify",
  "resource": "undoChangeNotice",
  "values": {
    "operation": "undoButtonPress"
  }
}
Receive:

{
  "success": true,
  "values": {
    "canUndo": true,
    "canRedo": false
  }
}
LogMessageMonitor
When a DI registers for log messages and a log message is matched against the parameters in the register call the DI will receive a "notify" action on the "logMessageNotice" resource with the log message plus information about how the log message was matched.

Supported Actions: register, unregister

register - this takes at least one of the following parameters which are used to match incoming log messages

topic - matches against the topic set in the log message
topicPrefix - matches against the start of the topic in the log message
formatStr - matches the formatStr used in the log message
message - matches the formatStr merged with the log parameters
and can take an additional optional clientId parameter which is an opaque value used in unregister

unregister - this takes one of the following two parameters

id - the autogenerated id returned from the register call
clientId - this is a opaque value provided by the client in the register call
CODAP-Initiated Actions
The IFramePhone-based API is entirely symmetric. It is a full duplex channel. The mechanism for CODAP-initiated actions is the same as for Data Interactive-initiated actions. The request is encapsulated in a command object, and the requester receives replies asynchronously through a callback.

The Data Interactive should register a dispatch function by providing it as an argument when initiating IFramePhone. Like this:

this.codapPhone = new iframePhone.IframePhoneRpcEndpoint(requestHandler,
        "data-interactive", window.parent);
Here, 'requestHandler' is a function that will be called to handle requests from CODAP. As with the Data Interactive to CODAP request traffic, the payload of the CODAP to Data Interactive requests is a serializable object of the same form. The object will have an 'action' and 'resource' field, and may have a 'values' field. The payload of the response from the Data Interactive should consist of a serializable object with a 'success' field and possibly a 'values' field.

{
  "action": "get",
  "resource": "interactiveState"
}
The form of the callback function might look like this:

function requestHandler( iCommand, callback) {
  switch( iCommand.resource) {
    case 'interactiveState':
      if (iCommand.action = 'get') {
        callback(cartGame.model.saveState());
      } else {
        callback({"success": false});
      }
      break;
    case 'undoChangeNotice':
      // ...
      break;
    default:
      callback({"success": false});
  }
}
We see that the requestHandler function is passed a callback. It should be called with the results of executing the command handler.

If the Data Interactive has persistent state, it should implement a request handler that dispatches to implementation of saveState function. It should implement a 'get' request to 'interactiveState' as a part of its initialization to retrieve the state it may have previously saved. If it does not have persistent state, it need not implement a request handler at this time. The requests from CODAP will be ignored.

Likewise, if the data interactive does not support exchange of other resources, it can ignore these actions as well.

Most actions flowing from CODAP to the data interactives are notifications. The intent is to alert the data interactive of some event occurring in CODAP that may be of interest to the interactive. Often, no meaningful data will accompany the request. The interactive is expected to query further if it requires details.

interactiveState
The interactiveState is an arbitrary JSON object defined by the Data Interactive. It is requested by CODAP when CODAP wishes to save the state of the entire CODAP application. It can be retrieved by the data interactive as a part of the interactiveState object.

Supported Actions: get

Resource Selector Patterns:

'interactiveState' (get)
Example: interactiveState get
Notes:

Occurs when CODAP is about to save its application state as a document.
If the data interactive does not maintain state from one invocation to another it can ignore this request.
CODAP Sends:

{
  "action": "get",
  "resource": "interactiveState"
}
Data Interactive Sends:

{
  "success": true,
  "values": {
  }
}
undoChangeNotice
This request notifies the interactive of undo request activity. These notifications refer to undoableActionPerformed notices sent from the interactive to CODAP. If an interactive implements undo and/or redo and wishes to participate in CODAP's undo/redo stack, these actions permit this.

The following notifications are possible:

'undoAction' will be sent when a user requests undo and a previously registered 'undoableActionPerformed' notice from this DI is at the top of the undo stack.
'redoAction' will be sent when a user requests redo and a previously registered 'undoableActionPerformed' notice from this DI is at the top of the redo stack.
'clearUndo' will be sent when a user requests an activity that would break the undo stack and this DI has previously registered an 'undoableActionPerformed' notice.
'redoAction' will be sent when a user requests an activity that would break the undo stack and this DI has previously registered an 'undoableActionPerformed' notice that has been undone.
CODAP will send an indication of the status of the undo stack. It will set the 'canUndo' property to true, iff there are undoable actions on the stack whether they are plugin related undo actions or not. Likewise, it will set the 'canRedo', property iff there are redoable actions on the stack.

Supported Actions: notify

Resource Selector Patterns:

'undoChangeNotice' (notify)
The undoChangeNotice object
{
  "operation": { "undoAction" | "redoAction" | "clearUndo" | "clearRedo" },
  "canUndo": {boolean},
  "canRedo": {boolean}
}
Example: undoChangeNotice notify
CODAP Sends:

{
  "action": "notify",
  "resource": "undoChangeNotice",
  "values": {
    "operation": "undoAction",
    "canUndo": true,
    "canRedo": false
  }
}
Response:

{
  "success": true
}
documentChangeNotice
This request notifies the interactive of document level activity. Examples of such activity include the creation or destruction of globals, or data contexts.

Supported Actions: notify

Resource Selector Patterns:

'documentChangeNotice' (notify)
The documentChangeNotice object
{
  "operation": /* {string} operation name. See below */
}
The following operations are possible:

Operation	Description
dataContextCountChanged	This count of dataContexts change, indicating addition or removal of one or more data contexts
dataContextDeleted	This indicates the deletion of a data context
updateDocumentBegun	CODAP has received a new document object and has begun processing and updating its current state
updateDocumentEnded	CODAP has finished updating its state using a received document object. This notification is sent after a 200ms delay so that final notifications from the update process itself will have been sent
Example: documentChangeNotice notify of dataContextCountChanged
Notes:

CODAP Sends:

{
  "action": "notify",
  "resource": "documentChangeNotice",
  "values": {
    "operation": "dataContextCountChanged"
  }
}
Response:

{
  "success": true
}
Example: dataContextDeleted notice
CODAP Sends:

{
  "actions": "notify",
  "resource": "documentChangeNotice",
  "values": {
    "operation": "dataContextDeleted",
    "deletedContext": "Context Name"
  }
}
Response:

{
  "success": true
}
Example: documentChangeNotice notify of updateDocumentBegun | updateDocumentEnded
Notes:

CODAP Sends:

{
  "action": "notify",
  "resource": "documentChangeNotice",
  "values": {
    "operation": "updateDocumentBegun" // or "updateDocumentEnded"
  }
}
Response:

{
  "success": true
}
Component change notifications
This message notifies the interactive of component changes. Examples of such activity include component create, delete, move, or resize or significant events specific to specific component types.

Supported Actions: notify

Resource Selector Patterns:

'component' (notify)
The component change object
{
  operation: ,/* create, delete, update */
  id: ,/* number */
  type: , /* string component type */
  ...
}
Collection change notifications
This message notifies the interactive of change to a collection. Examples of such activity include the creation, modification, or destruction of collection instances. Events initiated directly by the data interactive are suppressed from this notification, although events that are an indirect consequence may result in a notice. Notifications may or may not provide some information about the event.

Supported Actions: notify

Resource Selector Patterns:

'dataContext[dataContextName].collection' (notify)
The collection change object
[{
  operation: ,/* {string} operation name: createCollection or deleteCollection */
  result: /* */
}, { /* ... */ }
]
Example: Collection change notification
Notes:

CODAP Sends:

{
  "action": "notify",
  "resource": "dataContext[Mammals].collection",
  "values": {
    "operation": "createCollection",
    "result": {
    }
  }
}
Response:

{
  "success": true
}
Attribute change notifications
This message notifies the interactive of change to an attribute. Examples of such activity include the creation, modification, repositioning, or destruction of attribute instances. Events initiated directly by the data interactive are suppressed from this notification, although events that are an indirect consequence may result in a notice. Notifications may or may not provide some information about the event.

Supported Actions: notify

Resource Selector Patterns:

'dataContext[dataContextName].attribute' (notify)
The Attribute change notification object
[{
  operation: /* {string} operation name: createAttribute, updateAttribute, deleteAttribute, moveAttribute */
  result: /* */
}, { /* ... */ }
]
Example: Attribute change notification
Notes:

CODAP Sends:

{
  "action": "notify",
  "resource": "dataContext[Mammals].attribute",
  "values": {
    "operation": "createAttribute",
    "result": {
    }
  }
}
Response:

{
  "success": true
}
Case change notifications
This message notifies the interactive of change to one or more cases. Examples of such activity include the creation, modification, or destruction of cases. Events initiated directly by the data interactive are suppressed from this notification, although events that are an indirect consequence may result in a notice. Notifications may or may not provide some information about the event.

Supported Actions: notify

Resource Selector Patterns:

'dataContext[dataContextName].case' (notify)
The case change notification object
[{
  operation: /* {string} operation name: createCase, createCases, updateCases, deleteCases */
  result: /* */
}, { /* ... */ }
]
Example: Case change notification
Notes:

CODAP Sends:

{
  "action": "notify",
  "resource": "dataContext[Mammals].case",
  "values": {
    "operation": "updateCases",
    "result": [
      34, 35, 69
    ]
  }
}
Response:

{
  "success": true
}
Selection list change notifications
This message notifies the interactive of change to the selection list for a data context. Each data context has exactly one selection list, though the list may be empty at any given moment. Selection lists are lists of case ids. Examples of such activity include the changes in the membership of a selection list. Events initiated directly by the data interactive are suppressed from this notification, although events that are an indirect consequence may result in a notice.

Supported Actions: notify

Resource Selector Patterns:

'dataContext[dataContextName].selectionList' (notify)
The Selection list change notification object
[{
  operation: /* {string} operation name: selectCases */
  result: /* */
}, { /* ... */ }
]
Example: Selection list change notification
Notes: The "extend" property indicates whether the given cases have been added to the selection (true) or represent a new selection (false).

CODAP Sends:

{
  "action": "notify",
  "resource": "dataContext[Mammals].selectionList",
  "values": {
    "operation": "selectCases",
    "result": {
      "cases": [
        { "id": 15,
          "values": {
            "SampleDate": "12/1/2015",
            "Age": 12,
            "Height": 66,
            "Favorite": "Vanilla"
          }
        }
      ],
      "extend": false,
      "success": true
    }
  }
}
Response:

{
  "success": true
}
Global Value change notification
This message notifies the interactive of change to a Global Value.

Supported Actions: notify

Resource Selector Patterns:

'global[globalName or ID]' (notify)
The Global Value object
{
    globalValue: 9999
}
Example: Global Value change notification
CODAP Sends:

{
  "action": "notify",
  "resource": "global[name or id]",
  "values": {
    "globalValue": 999
  }
}
Response:

{
  "success": true
}
Drag and Drop Notifications
Notifications from CODAP to plugin that the user has dragged an attribute over the plugin. Because of trust barriers and technology differences the plugin cannot receive these events directly so they are transmitted through the API. The plugin can handle these notifications in a manner quite similar to the way they might handle the corresponding DOM events.

Supported Actions: notify

Resource Selector Patterns:

dragDrop[attribute]
Operations:

dragstart
dragend
dragenter
dragleave
drag
drop
Example: drop attribute
This is, of course the culmination of the drag operation. It occurs when the user releases the mouse button and the pointer is over the plugin in question. Note that the position values are pixel values in the plugin's coordinate space.

CODAP Sends:

{
  "action": "notify",
  "resource": "dragDrop[attribute]",
  "values": {
    "operation": "drop",
    "text": "Order",
    "attribute": {
      "id": 25,
      "name": "Order",
      "title": "Order"
    },
    "collection": {
      "id": 24,
      "name": "Mammals",
      "title": "Mammals"
    },
    "context": {
      "id": 23,
      "name": "Mammals",
      "title": "Mammals"
    },
    "position": {
      "x": 69,
      "y": 445
    }
  }
}
Response:

{
  "success": true
}
Simple Plugin Example
A simple plugin example generates random numbers. The code can be found here. To see other plugins in action, visit the CODAP Data Interactive Plugins site.