//@component
// =============================================================================
// TouchBlocking.js  —  keep touches inside the Lens
// -----------------------------------------------------------------------------
// By default Snapchat watches every touch for its own gestures, so a swipe across
// your Lens can flick to the next Lens, and a long press can open the carousel —
// mid-drag, mid-flip, mid-shot. Turning touch blocking ON tells Snapchat to leave
// them alone and let the Lens have them.
//
// A physics sandbox is exactly the case that needs it: dragging an object is a long
// horizontal swipe, which is also the gesture that changes Lens. Without this,
// throwing something across the screen can throw the player out of the Lens.
//
// It's one global switch for the whole Lens, not a per-object setting, so ONE of
// these anywhere in the scene is all you need. Two would just set the same flag
// twice.
//
// TURN IT OFF if your Lens wants Snapchat's gestures back — say a Lens with no
//   dragging where players still expect to swipe between Lenses. That's why this is
//   a toggle on a component rather than a line of code you'd have to delete.
//
// WIRING
//   Nothing. Drop it on any object; it runs once at startup.
// =============================================================================

// @input bool blockTouches = true {"label":"Block Touches","hint":"ON: touches go to this Lens only, so dragging can't accidentally swipe to the next Lens or open the carousel. Turn OFF to give Snapchat its gestures back."}

// touchSystem is a global provided by the Lens runtime. Guarded rather than assumed:
// if it's ever missing, a silent failure here would show up much later as "swiping
// keeps exiting the Lens", which is a horrible thing to have to track down.
if (global.touchSystem) {
    global.touchSystem.touchBlocking = !!script.blockTouches;
} else {
    print("TouchBlocking: '" + script.getSceneObject().name + "' — no touch system available, " +
          "so touches can't be blocked. Swipes may exit the Lens instead of reaching it.");
}
