//@component
// =============================================================================
// PhysicsKillZone2D.js  —  destroy what fell in, and put a fresh one back
// -----------------------------------------------------------------------------
// The handler half of a pit: a pinball drain, a hole in a platformer, the bottom
// of the screen in a stacking game. It does two things and nothing else — destroy
// the object it was handed, and ask a PhysicsSpawner2D for a replacement.
//
// IT DOESN'T WATCH FOR COLLISIONS. PhysicsCollision2D already does that, so this
//   is wired as its callback rather than registering a second contact handler of
//   its own. Three components on the pit object, each doing one job:
//     PhysicsBody2D       the static trigger volume
//     PhysicsCollision2D  notices what touched it        -> On Enter: killAndRespawn
//     PhysicsKillZone2D   destroys it and orders another <- Call On: this script
//   Which also means the collision side is yours to configure: use its Object
//   Filter to make the pit swallow only the ball and ignore everything else.
//
// IT DESTROYS, IT DOESN'T RESET. The object that fell in is gone, and the
//   replacement is a new copy from the spawner's prefab list — so a lost ball
//   arrives fresh instead of being teleported home still carrying its old spin.
//
// ONLY MOVING THINGS ARE DESTROYED. Static and kinematic bodies are ignored, so a
//   wall or a moving platform that clips the pit won't disappear.
//
// WHERE THE REPLACEMENT APPEARS is Spawn At, or the spawner's own position when
//   that's empty — so putting the spawner object where things should appear is the
//   whole setup.
//
// WIRING
//   On the pit object: a static PhysicsBody2D, a PhysicsCollision2D with Call On
//   pointed at THIS script and On Enter set to `killAndRespawn`, and this.
//   Spawner  -> a PhysicsSpawner2D holding the prefab to respawn. Turn its Spawn On
//               Tap off unless you also want the player tapping objects in.
//   Spawn At -> optional; where the replacement appears.
// =============================================================================

// @ui {"widget":"label","label":"<b>Replace</b>"}
// @input Component.ScriptComponent spawner {"label":"Spawner","hint":"The PhysicsSpawner2D that supplies the replacement. Leave empty to destroy things without replacing them."}
// @input SceneObject spawnAt {"label":"Spawn At","hint":"Where the replacement appears. Leave empty to use the spawner object's own position."}

var warned = false;              // one-shot: wired to a spawner with nowhere to spawn

// Where a replacement should appear, in scene units.
function spawnPoint(){
    if (script.spawnAt) return script.spawnAt.getTransform().getWorldPosition();
    if (script.spawner && script.spawner.getSceneObject)
        return script.spawner.getSceneObject().getTransform().getWorldPosition();
    return null;
}

// ---- public API -------------------------------------------------------------
// Point PhysicsCollision2D's On Enter at this. It hands us (otherObject, otherBody);
// both are optional, and otherObject is null for scenery nothing owns.
script.killAndRespawn = function(otherObject, otherBody){
    // Contacts are flushed AFTER the world step, so destroying here is safe — see
    // the collision service in Physics2D.
    if (!otherObject) return;
    if (otherBody && otherBody.isDynamic && !otherBody.isDynamic()) return;

    otherObject.destroy();      // PhysicsBody2D tears its own body down on destroy

    if (!script.spawner || typeof script.spawner.spawnAtWorld !== "function") return;
    var at = spawnPoint();
    if (at){ script.spawner.spawnAtWorld(at); return; }

    if (!warned){
        warned = true;
        print("PhysicsKillZone2D: '" + script.getSceneObject().name + "' has a Spawner but " +
              "nowhere to put the replacement, so nothing came back. Set Spawn At, or move " +
              "the spawner object to where things should appear.");
    }
};
