//@component
// =============================================================================
// PhysicsCollision2D.js  —  run something when a body starts / stops touching
// -----------------------------------------------------------------------------
// Drop this next to a PhysicsBody2D and it calls a function of yours when that
// body hits something (Enter) and when they come apart again (Exit). The typical
// uses are all one component: collect a coin, trigger a door, play a sound on
// impact, count how many crates the ball knocked over, end the level.
//
// WHAT YOUR FUNCTION RECEIVES
//   handler(otherObject, otherBody)
//     otherObject  the SceneObject that was hit (null for scenery with no
//                  component of its own, e.g. terrain). Check its name, read a
//                  component off it, disable it — whatever the game needs.
//     otherBody    the raw planck body, if you want velocity / mass / position.
//   Both are optional — declare `function onHit(){}` and ignore them if you like.
//
// ENTER AND EXIT are independent: fill in whichever you need and leave the other
//   blank. A blank function name simply never fires.
//
// FIRE ONCE latches Enter and Exit separately, so "Fire Once" means the first hit
//   only — a coin can't be collected twice. It re-arms on the scene-wide Reset, or
//   whenever you call rearm() from script.
//
// OBJECT FILTER (advanced) narrows WHICH objects trigger your function:
//   None (Allow All)           every contact fires (default).
//   Only Listed Objects        a pressure plate that only the player sets off.
//   All Except Listed Objects  a hazard that hurts everything but the scenery.
//   Listing a PARENT counts everything under it, so one "Coins" container covers
//   twenty coins — including ones spawned into it later, which can't be wired up in
//   advance.
//
//   This is a TRIGGER filter, not a physics one: the objects still collide and bounce
//   exactly as before, you just don't hear about the ones you filtered out. To make
//   things pass THROUGH each other you'd need collision filtering on the body itself.
//
// FROM SCRIPT instead of the Inspector: onEnter(cb) / onExit(cb) register as many
//   callbacks as you like, with the same arguments. The Inspector function and the
//   script subscribers all fire; they're not exclusive.
//
// WIRING
//   REQUIRES a PhysicsBody2D on the SAME object — that's the thing whose contacts it
//   watches, so there's nothing to wire. Without one it says so and stops.
//   Call On   -> the ScriptComponent holding your functions. Optional: empty means
//                only script subscribers are called.
//   Physics   -> optional, resolves itself like every other component here.
//   Builds lazily once the body exists, so hierarchy order doesn't matter.
// =============================================================================

// @ui {"widget":"label","label":"<b>Call A Function</b>"}
// @input Component.ScriptComponent callTarget {"label":"Call On","hint":"The script holding the functions named below. Leave empty if you only subscribe from code with onEnter()/onExit()."}
// @input string enterFunction {"label":"On Enter","hint":"Name of the function to call when this body STARTS touching something, e.g. onHit. It receives (otherObject, otherBody) — both optional. Leave blank to ignore contacts starting."}
// @input string exitFunction {"label":"On Exit","hint":"Name of the function to call when this body STOPS touching something. Same arguments as On Enter. Leave blank to ignore contacts ending."}
// @input bool fireOnce = false {"label":"Fire Once","hint":"ON: each of On Enter and On Exit fires a single time, then stops — a coin can't be collected twice. Re-arms on Reset. OFF: fires on every contact, forever."}

// @ui {"widget":"separator"}
// @input bool advanced = false {"label":"Advanced Settings","hint":"Narrow which objects count as a hit, or point at a specific physics world."}
// @input string respondTo = "any" {"label":"Object Filter","widget":"combobox","values":[{"label":"None (Allow All)","value":"any"},{"label":"Only Listed Objects","value":"only"},{"label":"All Except Listed Objects","value":"except"}],"hint":"Which objects are allowed to trigger your function. This does NOT change the physics — everything still bounces off everything. It only decides whose contacts you hear about.","showIf":"advanced"}
// @input SceneObject[] filterObjects {"label":"Object List","hint":"The list the Object Filter works from. Listing a PARENT counts everything inside it, so you can drag one 'Coins' group instead of twenty coins. Ignored when Object Filter is None (Allow All).","showIf":"advanced"}
// @input Component.ScriptComponent physics {"label":"Physics (Physics2D)","hint":"Optional — the shared world. Leave empty to auto-find: nearest Physics2D above this object in the hierarchy, else the scene's first one.","showIf":"advanced"}

var Guard = require("../Core/InputGuard.js");
var guard = Guard.make("PhysicsCollision2D", script);
// Routine status line, silenced by Physics2D's Status Logging. print() is called
// here rather than inside the helper so the Logger still points at this file.
function log(msg){ if (Guard.loggingOn()) print(msg); }

var myBody = null;               // the planck body we watch
var built = false;
var missingReported = false;     // one-shot: no PhysicsBody2D on this object
var enterFired = false;          // Fire Once latches, tracked per direction
var exitFired = false;
var enterSubs = [];              // extra callbacks registered from script
var exitSubs = [];

// The shared world, resolved once. A wired Physics input wins; otherwise ask the
// registry (nearest Physics2D above us, else the default) and cache the answer back
// onto the input, so every script.physics call site below stays as-is.
function resolvePhysics(){
    if (!script.physics && globalThis.Physics2DRegistry)
        script.physics = globalThis.Physics2DRegistry.resolveFor(script.getSceneObject());
    return script.physics;
}

// The PhysicsBody2D on THIS object. Matched on its brand rather than on having a
// getBody() method, because PhysicsDraggable2D exposes getBody() too and a loose
// search could bind to that instead.
function findBodyComponent(){
    var comps = script.getSceneObject().getComponents("Component.ScriptComponent");
    for (var i = 0; i < comps.length; i++){
        if (comps[i] !== script && comps[i].isPhysicsBody2D) return comps[i];
    }
    return null;
}

function ready(){
    if (!resolvePhysics()) return false;
    if (typeof script.physics.registerCollisionHandler !== "function") return false;

    var src = findBodyComponent();
    if (!src){
        // Nothing to watch, and nothing that will ever appear — components aren't
        // added at runtime here. Say so once and stop polling, rather than sitting
        // silent forever while the designer wonders why nothing fires.
        if (!missingReported){
            missingReported = true;
            print("PhysicsCollision2D: '" + script.getSceneObject().name + "' needs a " +
                  "PhysicsBody2D on the same object and there isn't one, so it can never " +
                  "detect a collision. Add a PhysicsBody2D to '" + script.getSceneObject().name +
                  "', or move this component onto the object that has one.");
        }
        return false;
    }

    myBody = src.getBody();      // null for the first frames, while that body builds
    return !!myBody;
}

// Is `so` the listed object itself, or anything parented under it? Matching
// descendants is what lets you filter a whole group by dragging in one container
// object, instead of listing every child — and it keeps working for objects spawned
// under that container at runtime, which can't be wired up in advance.
function isAtOrUnder(so, ancestor){
    for (var cur = so; cur; cur = (cur.getParent ? cur.getParent() : null)){
        if (cur === ancestor) return true;
    }
    return false;
}

function inFilterList(otherObject){
    var list = script.filterObjects;
    if (!otherObject || !list) return false;
    for (var i = 0; i < list.length; i++){
        if (list[i] && isAtOrUnder(otherObject, list[i])) return true;
    }
    return false;
}

// Should this contact reach your function? Note this is a TRIGGER filter, not a
// physics one — the two objects still collide and bounce either way.
//
// otherObject is null for scenery that has no component of its own (terrain, the
// world anchor). That counts as "not in the list": it can never satisfy Only these,
// and is always allowed through by All except these.
function passesFilter(otherObject){
    var mode = script.respondTo;
    if (mode !== "only" && mode !== "except") return true;      // "any" / unset
    var listed = inFilterList(otherObject);
    return (mode === "only") ? listed : !listed;
}

// Call the named function on the target script, plus every script subscriber.
// A missing function name is normal (that direction is unused); a name that doesn't
// resolve is a wiring mistake, so say so once rather than failing silently.
function fire(name, subs, other, otherObject){
    if (name){
        var fn = script.callTarget ? script.callTarget[name] : null;
        if (typeof fn === "function") fn(otherObject, other);
        else print("PhysicsCollision2D: '" + script.getSceneObject().name + "' — no function '" +
                   name + "' on the Call On script.");
    }
    for (var i = 0; i < subs.length; i++) subs[i](otherObject, other);
}

// The SceneObject behind a planck body, or null for scenery nothing owns.
function sceneObjectFor(body){
    return script.physics.getSceneObjectForBody
         ? script.physics.getSceneObjectForBody(body) : null;
}

var handler = {
    onEnter: function(other){
        var otherObject = sceneObjectFor(other);
        if (!passesFilter(otherObject)) return;
        if (script.fireOnce && enterFired) return;
        enterFired = true;
        fire(script.enterFunction, enterSubs, other, otherObject);
    },
    onExit: function(other){
        var otherObject = sceneObjectFor(other);
        if (!passesFilter(otherObject)) return;
        if (script.fireOnce && exitFired) return;
        exitFired = true;
        fire(script.exitFunction, exitSubs, other, otherObject);
    }
};

function build(){
    script.physics.registerCollisionHandler(myBody, handler);
    if (script.physics.registerResettable) script.physics.registerResettable(script);
    built = true;

    var filtering = (script.respondTo === "only" || script.respondTo === "except");
    var listed = script.filterObjects ? script.filterObjects.length : 0;
    log("PhysicsCollision2D: '" + script.getSceneObject().name + "' watching contacts" +
          (script.fireOnce ? " (once)" : "") +
          (filtering ? " (" + script.respondTo + " " + listed + " listed)" : "") + ".");

    // "Only these" with an empty list can never fire. That's almost always a half-done
    // wiring job rather than an intent, and it's invisible at runtime, so say so.
    if (script.respondTo === "only" && listed === 0){
        print("PhysicsCollision2D: '" + script.getSceneObject().name + "' has Object Filter set to " +
              "'Only Listed Objects' but the Object List is empty, so it can never fire. " +
              "Add objects, or set the filter back to None (Allow All).");
    }
}

script.createEvent("LateUpdateEvent").bind(function(){
    if (built || missingReported) return;   // missing body is permanent — stop polling
    if (ready()) build();
});

// ---- public API -------------------------------------------------------------
// Subscribe from script; same arguments as the Inspector function.
script.onEnter = function(cb){ if (typeof cb === "function") enterSubs.push(cb); };
script.onExit  = function(cb){ if (typeof cb === "function") exitSubs.push(cb); };
// Re-arm after Fire Once. Also the scene-wide Reset hook.
script.rearm   = function(){ enterFired = false; exitFired = false; };
script.respawn = function(){ script.rearm(); };
script.hasFired = function(){ return enterFired || exitFired; };

// --- teardown ----------------------------------------------------------------
// Drop the subscription so the world stops holding a handler that would call into a
// destroyed component. (The body itself belongs to PhysicsBody2D, which cleans up
// its own.)
script.createEvent("OnDestroyEvent").bind(function(){
    if (!built) return;
    var phys = script.physics;
    if (phys){
        if (phys.unregisterCollisionHandler) phys.unregisterCollisionHandler(myBody, handler);
        if (phys.unregisterResettable)       phys.unregisterResettable(script);
    }
    myBody = null;
    built = false;
});
