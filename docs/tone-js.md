# Tone.js

Tone.js is used for the sonification parts of this plugin.
- [repo](https://github.com/Tonejs/Tone.js)
- [website](https://tonejs.github.io/): main page is a rendering of repo readme, but seems to missing links to sub pages:
  - [examples](https://tonejs.github.io/examples/): very useful demos, generated from files in the repo
  - [API](https://tonejs.github.io/docs): kind of useful, but does not include clear docs of the main `Transport` class. It seems to redirect to the latest API documentation 15.1.22 as of this writing.
- [wiki](https://github.com/Tonejs/Tone.js/wiki): contains some very useful documentation
- internet/AI searches will often link to the older version API docs for example: https://tonejs.github.io/docs/14.7.39/index.html

## Transport Time

The wiki has good docs about this to get you started. The basic [Transport page](https://github.com/Tonejs/Tone.js/wiki/Transport) is a nice place to start. The [TransportTime page](https://github.com/Tonejs/Tone.js/wiki/TransportTime) has more details at the end about how the event callbacks that you add when scheduling an event are actually called in advance of the event. The [Performance page](https://github.com/Tonejs/Tone.js/wiki/Performance) describes the `lookAhead` configuration which determines how far in advance those callbacks will be called.

All of these concepts are complex enough, however it is actually even more complex than this: Transport is intended to manage a schedule of audio and time events. This means that it needs to be able to compute the transport time at any time in the past, now, and in the future. It has to do this so the scheduled events know what time they are being played at. And it supports looping so it needs to be able to start over in the past and repeat what was scheduled. And beyond this even the "speed" of the transport can be changed with events on the timeline.

Instead of storing a current time value, the transport uses two event timelines to encode the transport time. With this approach it is possible to look up the transport time given any "absolute" time in the past, now, or the future. This "absolute" time is more properly called the AudioContext time. As described in the TransportTime wiki page, the AudioContext time starts at 0 on page load. I'm using the term "absolute" here since it seems more meaningful than AudioContext time.

First to help if you are looking through the code, the hierarchy to get to the two timelines is:
- `Transport`
  - has:
    - `_clock: Clock`: used to compute transport time, and trigger state change events
  - `start()` calls `_clock.start()`
- `Clock`
  - has:
    - `_tickSource: TickSource`:  used to compute transport time
    - `_state: StateTimeline`: used to emit state change events, **not** used to compute transport time
  - `start()` calls `_tickSource.start()`
- `TickSource`
  - has:
    - `_state: StateTimeline`: tracks state change events which are used to compute the transport time.
    - `_tickOffset: Timeline`: tracks direct changes to the transport time for example when a stop resets the time to `0` or when a user calls `Tone.getTransport().seconds = newTime`.

The main time calculations are defined in `TickSource#getTicksAtTime` and `TickSource#getSecondsAtTime` which both use `TickSource#_state` and `TickSource#_tickOffset`. However before detailing how it works, it's useful to understand the path from `Tone.getTransport().seconds` to this `TickSource#getSecondsAtTime`. The path from `Tone.getTransport().ticks` is basically the same.

Where does `Tone.getTransport().seconds` come from:
- `Transport#get seconds` returns `this._clock.seconds`
- `Clock#get seconds` returns `this._tickSource.seconds`
- `TickSource#get seconds` returns `this.getSecondsAtTime(this.now())`: `now()` is absolute time + the lookAhead

Getting into `getSecondsAtTime(time)`. The time argument is an absolute time. It is supposed to compute what the transport time is, was, or will be at this absolute time. It does this by going through the state timeline. It looks for the last stopped event that is before the passed-in time. Then it adds up the difference in the stored absolute time in events that happen after each started event. In order have an end point to this loop a temporary "paused" event is added to the state timeline. The time of this "paused" event is the time passed to `getSecondsAtTime`. While looping through the state timeline events, it also looks for offset events in `_tickOffset`. If it finds one, it resets its accumulated time to the time recorded in the offset event. This way if the user modified the transport time instead of just letting the transport play, these modifications will be accounted for. In addition to all of this, there is an optimization to cache the transport time computed for a particular absolute time.  This is stored in a third timeline. This way it doesn't have to fully iterate over all of the events if the same time or a future time is requested.

To make this even more complex, the absolute time stored in the events and passed to `getSecondsAtTime` is the `now()` time. This includes the `lookAhead` offset. This offset is ignored because as long as the absolute time is consistent it doesn't matter. The `getSecondsTime` calculation only uses differences between these absolute times, and looking up events also uses this offset time, so it will find correct event. However where this seems to be a problem is when you want to figure out what the immediate Transport time is.

### Immediate Transport time

The immediate transport time is useful sometimes. For example if you want to display the current transport time in the UI. Or the sounds represent some visual items like the points this plugin is sonifying and you want to animate a line moving across the points.

Tone.js provides a mechanism for drawing things synchronized with the transport using its Draw object. There is a [Animation Example](https://tonejs.github.io/examples/animationSync) which demos this. It is also described on the [Performance wiki page](https://github.com/Tonejs/Tone.js/wiki/Performance#syncing-visuals). And there is some jsdoc which doesn't show up in the generated API site in [Draw.ts](https://github.com/Tonejs/Tone.js/blob/ee43c940574c1110f11c2bf382383fdd7f73f6ed/Tone/core/util/Draw.ts#L16-L33)

However this Draw approach isn't great for updating a line or time display. In those cases we want the time display to update as fast as possible. So we want to trigger an update on every animation frame. Using the Draw mechanism for this requires scheduling a loop with an interval that is less than the minium animation frame time. This could result in extra draw events being called, or not enough if the interval is wrong.

So the best approach seems to be to have an animation frame loop which can then figure out the immediate transport time.

The `now()` method provided on several Tone.js objects provides the current absolute time plus the `lookAhead` offset. It also has an `immediate()` method which returns the current absolute time without the offset. Getting the Transport's immediate time is not so clear.

When the transport has been stopped or paused for longer than `lookAhead` time, just calling `Tone.getTransport().seconds()` should be accurate. If the transport is playing, then it should be best to call `Tone.getTransport().getSecondsAtTime(Tone.immediate())`. The tricky part is what to use right around the state transitions. The state transition events are emitted early with the `lookAhead` offset just like the scheduled callbacks. The actual sounds should not be started or stopped until the immediate time. If the displayed time is being updated by a start, stop, or pause event handler then `Tone.getTransport().seconds` is good. Or better is to get the time associated with the event and call `Tone.getTransport().getSecondsAtTime(time)`. This will tell you what the time will be when the sounds are stopped, started, or paused. If you call `Tone.getTransport().getSecondsAtTime(Tone.immediate())` when receiving one of these events the time you get back will represent the time when the event was emitted not the time when the event is applied. So here are some cases to illustrate this:

- The Transport was playing, then you pause it, receive the event, and call `Tone.getTransport().getSecondsAtTime(Tone.immediate())`. In this case the result will be the pause time minus the `lookAhead`. It if there is code running before you make the `Tone.immediate()` call, such as React rendering, then the result will be a little bit bigger. As long at the transport stays paused the result will never be greater than the `Tone.getTransport().seconds`
- The Transport was paused, then you stop it, receive the event, and call `Tone.getTransport().getSecondsAtTime(Tone.immediate())`. In this case if `Tone.immediate()` is less than `Tone.now()` when the event was actually emitted (which is likely) the result will be the pause time instead of 0 which is what it should be when the transport is actually stopped. If you wait more than `lookAhead` from when the event was emitted and then call `Tone.getTransport().getSecondsAtTime(Tone.immediate())` the result will be 0.

To solve this, the TransportManager class in this plugin keeps track of its own transport time in a `position` property and the transport state in a `state` property. When the state is "playing" an animation loop updates the `position` with the immediate time: `Tone.getTransport().getSecondsAtTime(Tone.immediate())`. When a state event arrives, the `position` is updated to be the transport time from event with `Tone.getTransport().getSecondsAtTime(eventArg0)`. If the animation loop fires when the state is not "playing" it skips updating the transport time.

When a pause or stop event happens our transport time jumps forward by `lookAhead - renderingTime`. Since the number or line stops changing immediately after this jump that seems OK. When a start event happens the transport time is updated again and the animation loop starts up again. This can result in a couple of renders right next to each other, but generally the transport time is increasing between these renders.

There is one unhandled issue with this approach. If the transport is stopped and started quicker than the `lookAhead` time. In this case the animation frame might happen early enough that the `Tone.immediate()` value is before stop event on the timeline. So then `Tone.getTransport().getSecondsAtTime(Tone.immediate())` will return a transport time that is around time it was stopped. So the `position` will be set to `0` by the stop and start event handlers, and then be set to some value such as `1.67`, and then quickly jump back to `0` again. This issue can also be seen when the the speed is changed without stopping the sonification. This could be fixed by delaying the start of the animation frame for at least the `lookAhead` time, but it doesn't seem worth the added complexity at this point.
