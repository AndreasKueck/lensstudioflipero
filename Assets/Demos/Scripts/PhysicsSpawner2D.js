//@component
// =============================================================================
// PhysicsSpawner2D.js  —  tap to drop a shape into the world
// -----------------------------------------------------------------------------
// Give it a list of prefabs and every tap on empty space spawns one where the
// finger landed. That's the whole thing — a sandbox toy, a level editor, a "throw
// more blocks at it" button.
//
// THE PREFABS ARE ORDINARY OBJECTS. Anything you'd build by hand works: a
//   PhysicsBody2D for a shape that falls, a PhysicsDraggable2D so it can be picked
//   back up, a PhysicsCollision2D to score it. The spawned copy finds the shared
//   world by itself, exactly as an authored object does, so nothing needs rewiring
//   per prefab.
//
// WHICH ONE gets spawned is In Order by default (round-robin through the list, so
//   the player sees all of them) or Random. With one prefab in the list it makes no
//   difference.
//
// SPAWNING ON EMPTY SPACE ONLY. A tap that lands on an existing draggable object
//   picks it up instead, because grabbing something you can see beats spawning
//   another one on top of it. Physics2D arbitrates that — this waits a frame and
//   only spawns if nothing got grabbed.
//
// SPAWN ON TAP can be turned off, leaving the spawner as a script-driven supply of
//   objects: nothing happens on touch, and spawnAtWorld() is the only way in. That's
//   what a game wants when it replaces a lost ball rather than letting the player
//   conjure more.
//
// LIMIT keeps a cap on how many are alive: past it, spawning the next one removes
//   the oldest. That's what stops a tap-happy player melting the frame rate, and it
//   makes the toy self-cleaning. Set it to 0 for no limit.
//
// WIRING
//   Shapes  -> the ObjectPrefabs to spawn. Drag your prefabs in.
//   Spawn Under -> optional parent for the spawned objects. Empty = this object, so
//     everything stays tidy under one parent and Clear can find them.
//   Physics -> optional, resolves itself like every other component here.
//   Needs Physics2D's Touch Input ON — that's what turns a tap into a world point.
// =============================================================================

// @input Asset.ObjectPrefab[] shapes {"label":"Shapes","hint":"The prefabs to spawn. Each tap drops one of these where you touched. Any prefab works — put a PhysicsBody2D on it and it falls, add a PhysicsDraggable2D and it can be picked up again."}
// @input string pickMode = "order" {"label":"Pick","widget":"combobox","values":[{"label":"In Order","value":"order"},{"label":"Random","value":"random"}],"hint":"How the next shape is chosen from the list. In Order cycles through them so the player sees every shape; Random picks one each time."}
// @input int limit = 30 {"widget":"spinbox","min":0,"max":10000,"step":1,"label":"Limit","hint":"How many spawned objects can exist at once. Spawning past the limit removes the oldest, which keeps the frame rate steady however fast the player taps. 0 = no limit."}

// @input bool spawnOnTap = true {"label":"Spawn On Tap","hint":"ON: every tap on empty space drops a shape — the sandbox toy. OFF: the spawner only acts when something calls spawnAtWorld() from script, so it can top up a game without the player being able to spawn at will."}

// @ui {"widget":"separator"}
// @input bool advanced = false {"label":"Advanced Settings","hint":"Change where spawned objects are parented, or point at a specific physics world."}
// @input SceneObject spawnUnder {"label":"Spawn Under","hint":"Parent for everything spawned. Leave empty to parent to this object, which keeps them together and lets Clear find them.","showIf":"advanced"}
// @input Component.ScriptComponent physics {"label":"Physics (Physics2D)","hint":"Optional — the shared world, used to turn a touch into a world position. Leave empty to auto-find: nearest Physics2D above this object in the hierarchy, else the scene's first one.","showIf":"advanced"}

var spawned = [];               // oldest first, so the limit trims from the front
var nextIndex = 0;              // round-robin cursor for In Order
var reported = false;           // one-shot: nothing to spawn
var pending = null;             // a tap waiting a frame to see if it grabbed something

function resolvePhysics(){
    if (!script.physics && globalThis.Physics2DRegistry)
        script.physics = globalThis.Physics2DRegistry.resolveFor(script.getSceneObject());
    return script.physics;
}

function parentObject(){
    return script.spawnUnder ? script.spawnUnder : script.getSceneObject();
}

// The prefabs that are actually set. A half-filled list is normal while authoring —
// LS leaves empty slots — so skip the holes rather than spawning nothing.
function usablePrefabs(){
    var list = script.shapes, out = [];
    if (list){
        for (var i = 0; i < list.length; i++) if (list[i]) out.push(list[i]);
    }
    return out;
}

function pickPrefab(){
    var list = usablePrefabs();
    if (!list.length){
        if (!reported){
            reported = true;
            print("PhysicsSpawner2D: '" + script.getSceneObject().name + "' has no Shapes to " +
                  "spawn, so tapping does nothing. Drag one or more prefabs into the Shapes list.");
        }
        return null;
    }
    if (script.pickMode === "random") return list[Math.floor(Math.random() * list.length)];
    var p = list[nextIndex % list.length];
    nextIndex++;
    return p;
}

// Drop the oldest survivors until we're back under the cap. Done before spawning, so
// the count never actually exceeds the limit.
function trimToLimit(){
    var cap = script.limit;     // 0 is meaningful — it means no limit
    if (!(cap > 0)) return;
    while (spawned.length >= cap){
        var old = spawned.shift();
        if (old && !isNull(old)) old.destroy();     // PhysicsBody2D tears its body down
    }
}

function spawnAt(worldPos){
    var prefab = pickPrefab();
    if (!prefab) return null;

    trimToLimit();

    var obj = prefab.instantiate(parentObject());
    // Keep the prefab's authored Z so it lands on the same plane as everything else;
    // only the tapped XY is ours. A shape spawned off-plane would look right and
    // collide with nothing.
    var tf = obj.getTransform();
    var z = tf.getWorldPosition().z;
    tf.setWorldPosition(new vec3(worldPos.x, worldPos.y, z));

    spawned.push(obj);
    return obj;
}

// A tap is resolved one frame late on purpose. Physics2D decides on the SAME touch
// whether something was grabbed, and the order the two touch handlers run in isn't
// guaranteed — so instead of racing it, remember the point and check next frame.
script.createEvent("TouchStartEvent").bind(function(eventData){
    if (!script.spawnOnTap) return;      // script-driven only
    pending = eventData.getTouchPosition();
});

script.createEvent("UpdateEvent").bind(function(){
    if (!pending) return;
    var touchPos = pending;
    pending = null;

    var phys = resolvePhysics();
    if (!phys || !phys.isReady || !phys.isReady()) return;

    // Something got picked up by this tap — the player meant to grab, not to spawn.
    if (phys.isGrabbing && phys.isGrabbing()) return;

    if (typeof phys.touchToWorld !== "function") return;
    var w = phys.touchToWorld(touchPos);
    if (w) spawnAt(w);
});

// ---- public API -------------------------------------------------------------
// Spawn from script — a UI button, a timer, a scripted level.
script.spawnAtWorld = function(worldPos){ return worldPos ? spawnAt(worldPos) : null; };
script.getSpawnedCount = function(){ return spawned.length; };
// Remove everything this spawner made, leaving the authored scene alone.
script.clear = function(){
    for (var i = 0; i < spawned.length; i++){
        if (spawned[i] && !isNull(spawned[i])) spawned[i].destroy();
    }
    spawned = [];
};
