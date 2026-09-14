//@component
// =============================================================================
// PhysicsJoint2D.js  —  connect two bodies (or a body to the world) with a joint
// -----------------------------------------------------------------------------
// The joint sibling of PhysicsBody2D: drop it on a SceneObject, point it at two
// PhysicsBody2D components, pick a joint type, and at runtime it builds the planck
// joint in the shared Physics2D world. Like PhysicsBody2D, the SceneObject's
// TRANSFORM is the authoring surface:
//   - its WORLD POSITION is the joint anchor / pivot (single-anchor joints).
//   - its IN-PLANE ORIENTATION is the axis: `right` for prismatic (slider),
//     `up` for wheel (suspension).
// No visual is required — the object is normally an empty marker at the pivot, so
// there's nothing to see and nothing to hide. The component leaves the object exactly
// as authored; if you do put a visual on it, that's yours to manage.
//
// JOINT TYPES (planck factory shapes confirmed against planck.min.js)
//   revolute  (hinge)      anchor = object pos         limits + motor (torque)
//   weld      (rigid)      anchor = object pos         frequency/damping (0 = stiff)
//   distance  (spring/rod) ends = the two body centres length auto from gap; freq/damping
//   prismatic (slider)     anchor + axis = object right limits + motor (force)
//   rope      (max length) ends = the two body centres maxLength auto from gap
//   wheel     (suspension) anchor + axis = object up    freq/damping + motor (torque)
//
// BODY B EMPTY = anchor to the WORLD: the second end attaches to Physics2D's
//   permanent static anchor body (a fixed pivot) — for pendulums, fixed sliders,
//   suspension to a fixed point, etc. For distance/rope the fixed end is the
//   SceneObject position.
//
// UNITS: lengths/translations are SCENE UNITS (converted to metres via the affine,
//   so they match what you author); angles are RADIANS; springs are frequencyHz +
//   dampingRatio; revolute/wheel motor is angular (rad/s, torque), prismatic motor
//   is linear (scene units/s, force).
//
// WIRING
//   Physics -> the Physics2D ScriptComponent (world + affine + world anchor).
//     OPTIONAL: left empty it resolves itself — nearest Physics2D at-or-above this
//     object in the hierarchy, else the scene's first one.
//   Body A  -> a PhysicsBody2D ScriptComponent (required).
//   Body B  -> a PhysicsBody2D ScriptComponent (optional; empty = the world).
//   Builds lazily in LateUpdate once the affine is ready AND both bodies exist
//   (PhysicsBody2D builds its body on its own frame, so we poll until ready).
// =============================================================================

// @ui {"widget":"label","label":"<b>Connects</b>"}
// @typename PhysicsBody2D
// @input PhysicsBody2D bodyA {"label":"Body A","hint":"The object this joint connects. Point it at a PhysicsBody2D. Required."}
// @input PhysicsBody2D bodyB {"label":"Body B","hint":"The other object to connect to. Leave empty to pin Body A to a fixed point in the world instead — for a pendulum, a hinge on a wall, a fixed slider."}
// @input string jointType = "revolute" {"label":"Joint Type","widget":"combobox","values":[{"label":"Revolute (hinge)","value":"revolute"},{"label":"Distance (spring/rod)","value":"distance"},{"label":"Weld (rigid)","value":"weld"},{"label":"Prismatic (slider)","value":"prismatic"},{"label":"Rope (max length)","value":"rope"},{"label":"Wheel (suspension)","value":"wheel"}]}
// @input bool collideConnected = false {"label":"Collide Connected","hint":"Normally two joined objects pass through each other. Turn this on to let them bump instead."}

// @ui {"widget":"separator"}
// --- revolute ---------------------------------------------------------------
// @ui {"widget":"label","label":"<b>Hinge</b>","showIf":"jointType","showIfValue":"revolute"}
// @input bool revEnableLimit = false {"label":"Enable Limit","showIf":"jointType","showIfValue":"revolute"}
// @input float revLowerAngle = -0.785 {"label":"Lower Angle (rad)","showIf":"jointType","showIfValue":"revolute"}
// @input float revUpperAngle = 0.785 {"label":"Upper Angle (rad)","showIf":"jointType","showIfValue":"revolute"}
// @input bool revEnableMotor = false {"label":"Enable Motor","showIf":"jointType","showIfValue":"revolute"}
// @input float revMotorSpeed = 0.0 {"label":"Motor Speed (rad/s)","showIf":"jointType","showIfValue":"revolute"}
// @input float revMaxMotorTorque = 0.0 {"widget":"spinbox","min":0,"step":0.1,"label":"Max Motor Torque","showIf":"jointType","showIfValue":"revolute"}

// --- distance ---------------------------------------------------------------
// @ui {"widget":"label","label":"<b>Spring / Rod</b>","showIf":"jointType","showIfValue":"distance"}
// @input float distLength = 0.0 {"widget":"spinbox","min":0,"step":1,"label":"Length","hint":"How far apart the two objects are held, in scene units. 0 = keep whatever gap they start at.","showIf":"jointType","showIfValue":"distance"}
// @input float distFrequencyHz = 0.0 {"widget":"spinbox","min":0,"max":30,"step":0.1,"label":"Springiness","hint":"0 = a rigid rod. Higher = a looser spring, in Hz.","showIf":"jointType","showIfValue":"distance"}
// @input float distDampingRatio = 0.0 {"widget":"spinbox","min":0,"max":10,"step":0.05,"label":"Damping Ratio","showIf":"jointType","showIfValue":"distance"}

// --- weld -------------------------------------------------------------------
// @ui {"widget":"label","label":"<b>Weld</b>","showIf":"jointType","showIfValue":"weld"}
// @input float weldFrequencyHz = 0.0 {"widget":"spinbox","min":0,"max":30,"step":0.1,"label":"Springiness","hint":"0 = welded solid. Higher = the joint gives, in Hz.","showIf":"jointType","showIfValue":"weld"}
// @input float weldDampingRatio = 0.0 {"widget":"spinbox","min":0,"max":10,"step":0.05,"label":"Damping Ratio","showIf":"jointType","showIfValue":"weld"}

// --- prismatic --------------------------------------------------------------
// @ui {"widget":"label","label":"<b>Slider</b>","showIf":"jointType","showIfValue":"prismatic"}
// @input bool priEnableLimit = false {"label":"Enable Limit","showIf":"jointType","showIfValue":"prismatic"}
// @input float priLowerTranslation = -100.0 {"label":"Slide Min","hint":"How far it can slide backwards along the axis, in scene units.","showIf":"jointType","showIfValue":"prismatic"}
// @input float priUpperTranslation = 100.0 {"label":"Slide Max","hint":"How far it can slide forwards along the axis, in scene units.","showIf":"jointType","showIfValue":"prismatic"}
// @input bool priEnableMotor = false {"label":"Enable Motor","showIf":"jointType","showIfValue":"prismatic"}
// @input float priMotorSpeed = 0.0 {"label":"Motor Speed","hint":"How fast the motor drives it along the axis, in scene units per second.","showIf":"jointType","showIfValue":"prismatic"}
// @input float priMaxMotorForce = 0.0 {"widget":"spinbox","min":0,"step":0.1,"label":"Max Motor Force","showIf":"jointType","showIfValue":"prismatic"}

// --- rope -------------------------------------------------------------------
// @ui {"widget":"label","label":"<b>Rope</b>","showIf":"jointType","showIfValue":"rope"}
// @input float ropeMaxLength = 0.0 {"widget":"spinbox","min":0,"step":1,"label":"Max Length","hint":"The furthest the two objects can get apart, in scene units. 0 = keep whatever gap they start at.","showIf":"jointType","showIfValue":"rope"}

// --- wheel ------------------------------------------------------------------
// @ui {"widget":"label","label":"<b>Suspension</b>","showIf":"jointType","showIfValue":"wheel"}
// @input float whFrequencyHz = 4.0 {"widget":"spinbox","min":0.1,"max":30,"step":0.1,"label":"Springiness","hint":"How soft the suspension is, in Hz. Lower is softer. Must stay above 0 — a wheel's spring can't be switched off, so use a Revolute joint if you want the wheel held rigid.","showIf":"jointType","showIfValue":"wheel"}
// @input float whDampingRatio = 0.7 {"widget":"spinbox","min":0,"max":10,"step":0.05,"label":"Damping Ratio","showIf":"jointType","showIfValue":"wheel"}
// @input bool whEnableMotor = false {"label":"Enable Motor","showIf":"jointType","showIfValue":"wheel"}
// @input float whMotorSpeed = 0.0 {"label":"Motor Speed (rad/s)","showIf":"jointType","showIfValue":"wheel"}
// @input float whMaxMotorTorque = 0.0 {"widget":"spinbox","min":0,"step":0.1,"label":"Max Motor Torque","showIf":"jointType","showIfValue":"wheel"}

// @ui {"widget":"separator"}
// @input bool advanced = false {"label":"Advanced Settings","hint":"Point this joint at a specific physics world."}
// @input Component.ScriptComponent physics {"label":"Physics (Physics2D)","hint":"Optional — the physics world to build the joint in. Leave empty to auto-find: nearest Physics2D above this object in the hierarchy, else the scene's first one.","showIf":"advanced"}

var P = require("../Core/planck.min.js");   // planck (Box2D) module
var Vec2 = P.Vec2;
var world = null;        // shared planck world (from Physics2D)

var joint = null;
var built = false;
var tf = null;
// ---- input validation -------------------------------------------------------
// These numbers go straight into planck's solver, and a bad one does not fail where
// you set it: a WheelJoint with Springiness 0 drives a body to NaN, which surfaces
// frames later as "Cannot read property 'x' of undefined" deep inside TimeOfImpact,
// with nothing in the message pointing back at the joint. It halts the whole lens.
// Verified on this planck build: wheel Springiness 0 crashes, 0.1 is stable, and weld
// and distance at 0 are fine (0 means rigid for those two, which is their default).
var Guard = require("../Core/InputGuard.js");
var guard = Guard.make("PhysicsJoint2D", script);
// Routine status line, silenced by Physics2D's Status Logging. print() is called
// here rather than inside the helper so the Logger still points at this file.
function log(msg){ if (Guard.loggingOn()) print(msg); }
var MIN_WHEEL_HZ = 0.1;
// A spring can't be resolved faster than the timestep samples it. At the default
// 60Hz step that puts the ceiling at 30Hz; past it the spring gains energy instead
// of losing it.
var MAX_SPRING_HZ = 30;

var misconfigured = false;   // one-shot: wiring can never succeed, stop polling

function reportOnce(msg){
    if (misconfigured) return;
    misconfigured = true;
    print("PhysicsJoint2D: " + msg);
}

// The shared world, resolved once. A wired Physics input wins; otherwise ask the
// registry (nearest Physics2D above us, else the default) and cache the answer back
// onto the input, so every script.physics call site below stays as-is.
function resolvePhysics(){
    if (!script.physics && globalThis.Physics2DRegistry)
        script.physics = globalThis.Physics2DRegistry.resolveFor(script.getSceneObject());
    return script.physics;
}

function ready(){
    if (!resolvePhysics()) return false;
    if (typeof script.physics.getWorld !== "function") return false;
    if (typeof script.physics.worldToPhysics !== "function") return false;
    if (!script.physics.isReady || !script.physics.isReady()) return false;   // affine ready
    world = script.physics.getWorld();
    if (!world || !P) return false;
    // Wiring problems are permanent — nothing will fix them at runtime — so report
    // once and stop, rather than polling forever in silence like this used to.
    if (!script.bodyA){
        reportOnce("'" + script.getSceneObject().name + "' has no Body A, so no joint " +
                   "can be made. Point Body A at the PhysicsBody2D you want to connect.");
        return false;
    }
    if (!isBodyRef(script.bodyA)){
        reportOnce("'" + script.getSceneObject().name + "' has Body A pointed at something " +
                   "that isn't a PhysicsBody2D. Joints connect bodies — pick the object's " +
                   "PhysicsBody2D component.");
        return false;
    }
    if (script.bodyB && !isBodyRef(script.bodyB)){
        reportOnce("'" + script.getSceneObject().name + "' has Body B pointed at something " +
                   "that isn't a PhysicsBody2D. Leave Body B empty to anchor to the world.");
        return false;
    }

    if (!bodyOf(script.bodyA)) return false;               // wired fine, just not built yet
    if (script.bodyB && !bodyOf(script.bodyB)) return false;
    return true;
}

// The planck body behind a referenced PhysicsBody2D (null until it has built).
// Matched on the brand rather than on having a getBody() method: PhysicsDraggable2D
// exposes getBody() too, and in the Inspector picker both are just "a script", so a
// loose check silently accepts the wrong component.
function bodyOf(ref){
    return (ref && ref.isPhysicsBody2D && typeof ref.getBody === "function") ? ref.getBody() : null;
}

// Is this reference a PhysicsBody2D at all? Separates "wired to the wrong thing"
// from "wired correctly but not built yet", which need different messages.
function isBodyRef(ref){ return !!(ref && ref.isPhysicsBody2D); }

// SceneObject world position -> physics metres (the anchor / pivot point).
function anchorMetres(){
    return script.physics.worldToPhysics(tf.getWorldPosition());   // {x,y} or null
}

// SceneObject in-plane basis vector (right|up), normalised to {x,y}. The joint axis.
function planeAxis(which){
    var v = (which === "up") ? tf.up : tf.right;
    var L = Math.sqrt(v.x * v.x + v.y * v.y);
    if (L < 1e-6) return { x: 1, y: 0 };
    return { x: v.x / L, y: v.y / L };
}

// scene units -> metres (isotropic affine scale).
function toMetres(sceneLen){
    var s = script.physics.getWorldScale ? script.physics.getWorldScale() : 50;
    return sceneLen / s;
}

function centre(body){ var p = body.getPosition(); return Vec2(p.x, p.y); }

function build(){
    tf = script.getSceneObject().getTransform();
    var A = bodyOf(script.bodyA);
    var B = script.bodyB ? bodyOf(script.bodyB)
                         : (script.physics.getWorldAnchor ? script.physics.getWorldAnchor() : null);
    if (!A || !B){ print("PhysicsJoint2D: '" + script.getSceneObject().name + "' — missing body (A required, B or world anchor)."); return; }

    var am = anchorMetres();
    if (!am){ print("PhysicsJoint2D: affine not ready."); return; }
    var anchor = Vec2(am.x, am.y);

    var type = script.jointType;
    var def = { collideConnected: !!script.collideConnected };
    var made = null;

    if (type === "revolute"){
        var revLim = guard.range("Angle", script.revLowerAngle, script.revUpperAngle);
        def.enableLimit = !!script.revEnableLimit;
        def.lowerAngle = revLim.lo;
        def.upperAngle = revLim.hi;
        def.enableMotor = !!script.revEnableMotor;
        def.motorSpeed = guard.num("Motor Speed", script.revMotorSpeed, null, null, 0);
        def.maxMotorTorque = guard.num("Max Motor Torque", script.revMaxMotorTorque, 0, null, 0,
                                 "a torque limit can't be negative");
        made = P.RevoluteJoint(def, A, B, anchor);

    } else if (type === "weld"){
        def.frequencyHz = guard.num("Springiness", script.weldFrequencyHz, 0, MAX_SPRING_HZ, 0);
        def.dampingRatio = guard.num("Damping Ratio", script.weldDampingRatio, 0, 10, 0);
        made = P.WeldJoint(def, A, B, anchor);

    } else if (type === "prismatic"){
        var priLim = guard.range("Slide", script.priLowerTranslation, script.priUpperTranslation);
        def.enableLimit = !!script.priEnableLimit;
        def.lowerTranslation = toMetres(priLim.lo);
        def.upperTranslation = toMetres(priLim.hi);
        def.enableMotor = !!script.priEnableMotor;
        def.motorSpeed = toMetres(guard.num("Motor Speed", script.priMotorSpeed, null, null, 0));
        def.maxMotorForce = guard.num("Max Motor Force", script.priMaxMotorForce, 0, null, 0,
                                "a force limit can't be negative");
        var axR = planeAxis("right");
        made = P.PrismaticJoint(def, A, B, anchor, Vec2(axR.x, axR.y));

    } else if (type === "wheel"){
        // The one that crashes rather than misbehaves — see MIN_WHEEL_HZ above.
        def.frequencyHz = guard.num("Springiness", script.whFrequencyHz, MIN_WHEEL_HZ, MAX_SPRING_HZ, 4,
                              "a wheel's suspension spring can't be switched off; use a " +
                              "Revolute joint if you want the wheel held rigid");
        def.dampingRatio = guard.num("Damping Ratio", script.whDampingRatio, 0, 10, 0.7);
        def.enableMotor = !!script.whEnableMotor;
        def.motorSpeed = guard.num("Motor Speed", script.whMotorSpeed, null, null, 0);
        def.maxMotorTorque = guard.num("Max Motor Torque", script.whMaxMotorTorque, 0, null, 0,
                                 "a torque limit can't be negative");
        var axU = planeAxis("up");
        made = P.WheelJoint(def, A, B, anchor, Vec2(axU.x, axU.y));

    } else if (type === "distance"){
        def.frequencyHz = guard.num("Springiness", script.distFrequencyHz, 0, MAX_SPRING_HZ, 0);
        def.dampingRatio = guard.num("Damping Ratio", script.distDampingRatio, 0, 10, 0);
        if (script.distLength > 0) def.length = toMetres(script.distLength);
        // ends: Body A centre <-> Body B centre (or the fixed scene anchor for "to world").
        var dA = centre(A);
        var dB = script.bodyB ? centre(B) : anchor;
        made = P.DistanceJoint(def, A, B, dA, dB);

    } else if (type === "rope"){
        // Rope's single-anchor helper would tie both ends to one point; set the two
        // local anchors explicitly so the rope spans Body A centre <-> Body B centre
        // (or the fixed scene anchor for "to world").
        var rA = centre(A);
        var rB = script.bodyB ? centre(B) : anchor;
        def.localAnchorA = A.getLocalPoint(rA);
        def.localAnchorB = B.getLocalPoint(rB);
        def.maxLength = script.ropeMaxLength > 0 ? toMetres(script.ropeMaxLength)
                                                 : Vec2.distance(rA, rB);
        made = P.RopeJoint(def, A, B);

    } else {
        print("PhysicsJoint2D: unknown jointType '" + type + "'."); return;
    }

    joint = world.createJoint(made);
    built = true;
    log("PhysicsJoint2D: '" + script.getSceneObject().name + "' -> " + type +
          (script.bodyB ? " (A<->B)" : " (A<->world)") + " joint created.");
    guard.report();   // anything that had to be corrected to get here
}

// Single Late handler: build once when ready (bodies build on their own frames).
script.createEvent("LateUpdateEvent").bind(function(){
    if (built || misconfigured) return;
    if (ready()) build();
});


// --- public API --------------------------------------------------------------
script.getJoint = function(){ return joint; };
// Runtime motor control (no-op for jointless / motorless types). A driver component
// usually wants all three: a motor with speed but no torque limit can't move anything,
// which is the silent failure to avoid.
script.enableMotor = function(on){ if (joint && joint.enableMotor) joint.enableMotor(!!on); };
script.setMotorSpeed = function(s){ if (joint && joint.setMotorSpeed) joint.setMotorSpeed(s); };
// Revolute/wheel take a torque, prismatic a force — planck names the setter differently
// per joint type, so try both and let the one that exists win.
script.setMaxMotorTorque = function(t){
    if (!joint) return;
    if (joint.setMaxMotorTorque) joint.setMaxMotorTorque(t);
    else if (joint.setMaxMotorForce) joint.setMaxMotorForce(t);
};
// Does this joint have a motor to drive at all? Lets a driver say so when it's been
// pointed at a rope or a weld by mistake.
script.hasMotor = function(){
    return !!(joint && joint.setMotorSpeed &&
             (joint.setMaxMotorTorque || joint.setMaxMotorForce));
};
// Are the travel limits on? A motor driving a joint with no limit just turns forever,
// so anything that drives TO a limit (a flipper, a lever, a hatch) needs to know.
script.hasLimit = function(){
    return !!(joint && joint.isLimitEnabled && joint.isLimitEnabled());
};
// Destroy the joint (e.g. to break a constraint at runtime). Tolerant of the joint
// already being gone: planck destroys a body's joints along with it, so if a connected
// PhysicsBody2D was torn down first, this joint no longer exists to destroy.
script.destroyJoint = function(){
    if (joint && world){
        try { world.destroyJoint(joint); } catch (e){}
    }
    joint = null;
    built = false;
};

// --- teardown ----------------------------------------------------------------
// A joint lives in the world, not on this object, so destroying the SceneObject would
// otherwise leave the two bodies still constrained by an invisible joint.
script.createEvent("OnDestroyEvent").bind(function(){ script.destroyJoint(); });
