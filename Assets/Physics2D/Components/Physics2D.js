//@component
// =============================================================================
// Physics2D.js  —  planck (Box2D) world owner for the Lens Studio 2D physics sandbox
// -----------------------------------------------------------------------------
// This is the core of the port: it owns the planck `world`, steps it on a fixed
// timestep, and provides the services every body in the scene shares:
//
//   COORDINATE SYSTEM  physics metres <-> LS scene units. A single affine
//     (worldScale + a scene origin). physicsToWorld()/worldToPhysics() are the
//     ONLY place the two spaces meet. The origin is a `worldOrigin` SceneObject if
//     one is wired, else THIS object's own transform — so it's always known by the
//     end of init and isReady() is true from the first frame. Nothing to wire for a
//     single-world scene: drop Physics2D in and move it to place the world.
//   (NO GROUND)       the world owns no floor and no walls. Ground is authored like
//     anything else: a static PhysicsBody2D — a box for a flat floor, or a traced
//     polygon for shaped ground. A fresh world is empty space.
//   GRAB SERVICE      grabAt(x, y, radius)/moveGrab/releaseGrab drag a body with a
//     MouseJoint. `radius` is the caller's miss tolerance in metres — the world owns
//     the picking geometry, the caller owns how forgiving a touch is.
//     Pickable bodies are those registered via registerGrabbable() (PhysicsBody2D
//     registers itself when `draggable`, Ragdoll registers its parts) OR those a
//     grab handler currently claims (registerGrabHandler — the body is pickable only
//     while its handler is registered, e.g. a launcher projectile). onGrab()
//     lets a consumer react when one of its bodies is grabbed (e.g. go floppy).
//   RESET REGISTRY    registerResettable({respawn})/resetAll() — the Reset button
//     puts the WHOLE scene back to start (ragdoll + every PhysicsBody2D).
//   TOUCH INPUT       optional (Touch Input toggle, on by default): screen touch ->
//     world point -> metres -> the grab service. It lives here rather than in its own
//     component so a scene needs ONE object to have working physics + dragging. A
//     touch that hits nothing is offered to the camera controller as a viewport pan
//     — whichever component registered via registerCameraController (the template's
//     CameraFollow does; this package holds no reference to it).
//   DEBUG DRAW        optional (Debug Draw toggle, off by default): a wireframe of
//     every collider's REAL geometry, drawn over the scene. Built once per body in
//     body-local space and then only moved/rotated, so there's no per-frame rebuild.
//   COLLISION SERVICE ONE pair of world contact listeners, dispatched per body via
//     registerCollisionHandler(body, {onEnter, onExit}) — see PhysicsCollision2D.
//     Contacts fire INSIDE world.step(), where planck forbids creating/destroying
//     bodies, so they're queued and flushed after the step instead; by the time a
//     handler runs it can safely change the world. registerBody() keeps a
//     body -> component map so a hit reports the SceneObject you authored.
//   INSTANCE REGISTRY Physics2D brands itself (isPhysics2D) and registers on
//     globalThis.Physics2DRegistry at awake, so a component whose `physics` input
//     is EMPTY can still find a world: resolveFor(sceneObject) returns the nearest
//     Physics2D at-or-above it in the hierarchy (the LS PhysicsWorld convention),
//     else the default (first-registered) instance. A wired input always wins, so
//     multiple worlds stay addressable.
//
// This script is ragdoll-agnostic: a scene with only PhysicsBody2D balls/crates
// works with NO ragdoll at all (set worldOrigin so the affine is ready at start).
//
// planck: require()d directly as a module, so there is NO planck.min ScriptComponent
//   to remember to put in the scene and no hierarchy-order concern. The path must be
//   a string literal WITH the .js extension — LS resolves requires statically and
//   would otherwise read "planck.min" as stem + an unknown ".min" extension.
// =============================================================================

// EVERY input is optional and hidden behind a toggle, so by default this component
// shows two checkboxes and nothing else. Drop it in and it works.
//
// (A collapsible "group_start" widget was the obvious fit for grouping, but LS always
// renders groups expanded — there's no start-collapsed option — so it showed every
// field by default, which is the opposite of what's wanted. showIf is deterministic.)

// @ui {"widget":"label","label":"<b>Input</b>"}
// @input bool touchInput = true {"label":"Touch Input","hint":"Let the player touch the screen to drag objects around. Turn this off if your game drives the physics some other way, or you want to write your own input."}
// @input Component.Camera touchCamera {"label":"Camera","hint":"The camera the player looks through — needed to turn a touch into a point in the world. Leave empty and it uses the scene's lowest render order camera, which is normally the main one.","showIf":"touchInput"}
// @input bool cameraDefaults = true {"label":"Set Up Camera","hint":"Put the camera into the setup this framework expects: orthographic, viewing 100 scene units, near 1 / far 1000. Applied while the Lens runs — the camera's own Inspector values are left as you authored them. On by default so physics looks right the moment you drop it into a new project. Turn it off to keep a camera you have already set up yourself.","showIf":"touchInput"}
// @input float grabTolerance = 1.0 {"widget":"spinbox","min":0,"step":1,"label":"Grab Tolerance","hint":"How far off an object a touch can land and still pick it up, in scene units. Fingers are bigger than they look — some forgiveness here makes small or thin objects far easier to grab. 0 = must touch exactly.","showIf":"touchInput"}

// @ui {"widget":"separator"}
// @ui {"widget":"label","label":"<b>Debug</b>"}
// @input bool statusLogging = false {"label":"Status Logging","hint":"Print a line as each body, joint and component is built. Useful while you're wiring a scene up; off by default so the Logger stays readable. Problems are reported either way — this only silences the running commentary."}
// @input bool debugDraw = false {"label":"Debug Draw","hint":"Outline every collider on top of the scene, so you can see the shapes the physics is actually using — which is often not the shape of the artwork. A development aid: turn it off before publishing."}
// @input Asset.Material debugMaterial {"label":"Line Material","hint":"An Unlit material for the outlines. Without one the overlay is invisible, so this warns if it's empty.","showIf":"debugDraw"}
// @input bool debugDynamic = true {"label":"Show Dynamic","hint":"Outline bodies that move — the balls, crates and other pieces.","showIf":"debugDraw"}
// @input bool debugStatic = true {"label":"Show Static","hint":"Outline bodies that don't move — floors, walls, terrain. Turn off to declutter scene-sized colliders and concentrate on the pieces.","showIf":"debugDraw"}
// @input vec4 debugDynamicColor = {0.2, 1.0, 0.4, 1.0} {"label":"Dynamic Colour","widget":"color","showIf":"debugDraw"}
// @input vec4 debugStaticColor = {0.6, 0.7, 1.0, 1.0} {"label":"Static Colour","widget":"color","showIf":"debugDraw"}

// @ui {"widget":"separator"}
// @input bool advanced = false {"label":"Advanced Settings","hint":"Show the world's tuning parameters. Every one has a sensible default — you only need these to change gravity/scale, retune the solver, or set an explicit world origin."}

// @input bool autoStep = true {"label":"Auto Step","hint":"Step the world off UpdateEvent. Turn OFF only if a GameManager calls step() explicitly.","showIf":"advanced"}
// @ui {"widget":"label","label":"<b>World</b>","showIf":"advanced"}
// @input float gravity = 10.0 {"widget":"spinbox","min":-1000,"max":1000,"step":0.5,"label":"Gravity (m/s^2)","hint":"Magnitude; applied as (0,-gravity). 10 ~ Earth-ish for this rig scale.","showIf":"advanced"}
// @input float worldScale = 50.0 {"widget":"spinbox","min":0.01,"max":10000,"step":1,"label":"Metres -> Scene Units","hint":"Scene units per physics metre — the whole world<->scene mapping. 50 matches the sample rig.","showIf":"advanced"}
// @input SceneObject worldOrigin {"label":"World Origin","hint":"Optional. Physics (0,0) maps to this object's world position (its Z = render depth). Leave empty to use THIS object's own transform as the origin — so move the Physics2D object to move the whole physics world.","showIf":"advanced"}
// @ui {"widget":"separator","showIf":"advanced"}
// @ui {"widget":"label","label":"<b>Solver</b>","showIf":"advanced"}
// @input int velocityIterations = 8 {"widget":"spinbox","min":1,"max":50,"step":1,"label":"Velocity Iters","showIf":"advanced"}
// @input int positionIterations = 3 {"widget":"spinbox","min":1,"max":50,"step":1,"label":"Position Iters","showIf":"advanced"}
// @input float fixedDt = 0.01666 {"widget":"spinbox","min":0.004166,"max":0.05,"step":0.001,"label":"Fixed Step (s)","hint":"1/60. Don't go below 1/120 without raising iterations.","showIf":"advanced"}
// @input int maxStepsPerFrame = 5 {"widget":"spinbox","min":1,"max":20,"step":1,"label":"Max Steps / Frame","hint":"Catch-up cap after a hitch; avoids the spiral of death.","showIf":"advanced"}

var P = require("../Core/planck.min.js");
var Guard = require("../Core/InputGuard.js");
var guard = Guard.make("Physics2D", script);
// Routine status line, silenced by Physics2D's Status Logging. print() is called
// here rather than inside the helper so the Logger still points at this file.
function log(msg){ if (Guard.loggingOn()) print(msg); }

// Published immediately, at script load, so every other component sees the right
// value before its own first log — they build in LateUpdate, long after this runs.
globalThis.Physics2DLogging = !!script.statusLogging;

var DIRECT_GRAB_EASE = 0.5; // direct (static/kinematic) drag: fraction of the gap to the
// finger closed per 1/60s frame. Emulated spring stiffness.
// Higher = stiffer/snappier, lower = laggier. 1 = instant (avoid).

// ---- module state ----------------------------------------------------------
var world = null;
var worldAnchorBody = null; // permanent fixtureless static body: anchor for grab + world joints
var accumulator = 0;
var stepDt = 1 / 60,
  velIter = 8,
  posIter = 3,
  maxSteps = 5;

var Vec2 = null;

// coordinate affine: physics (0,0) -> `origin` (scene vec3), scaled by worldScaleVal.
var origin = null; // vec3 or null (null => not ready)
var originLocked = false; // true when set from worldOrigin (rig can't override)
var worldScaleVal = 50;

// grab
var mouseJoint = null,
  grabBody = null,
  lastGrabbed = null;
var grabDirect = false; // true when dragging a static/kinematic body by hand
var grabTarget = null; // {x,y} absolute target in metres for a direct grab
var grabOffX = 0,
  grabOffY = 0; // body-pos minus grab-point, so it doesn't snap to centre
var grabbables = []; // bodies eligible to be picked
var grabOptions = new Map(); // body -> per-body drag options (see registerGrabbable)
var EMPTY_OPTS = {};
var grabLockX = 0,
  grabLockY = 0; // grab-time touch point, for single-axis drags
var grabListeners = []; // cb(body) fired when a body is grabbed
var grabHandlers = []; // [{body, handler}] — bodies whose drag is fully claimed
var activeHandler = null; // the handler driving the current grab (if any)

// reset
var resettables = []; // objects exposing respawn()

// collisions
var bodyOwners = new Map(); // planck body -> the component that built it
var collisionHandlers = new Map(); // planck body -> [{onEnter, onExit}]
var contactQueue = []; // buffered contacts, drained after the step

// ---- coordinate affine ------------------------------------------------------
function physicsToWorld(x, y) {
  if (!origin) return null;
  return new vec3(
    origin.x + x * worldScaleVal,
    origin.y + y * worldScaleVal,
    origin.z,
  );
}
function worldToPhysics(worldVec) {
  if (!origin) return null;
  return {
    x: (worldVec.x - origin.x) / worldScaleVal,
    y: (worldVec.y - origin.y) / worldScaleVal,
  };
}
// Calibrate the origin (scene vec3 where physics (0,0) renders). Ignored while the
// origin is locked — which, since init() always resolves an origin, is now always.
// Kept as a safe no-op for Ragdoll's bind-time call: place a rigged ragdoll by
// moving the Physics2D object (or wiring World Origin to the rig) instead.
function calibrate(originVec3) {
  if (originLocked || !originVec3) return;
  origin = originVec3;
  log(
    "Physics2D: origin calibrated to (" +
      origin.x.toFixed(1) +
      ", " +
      origin.y.toFixed(1) +
      ", " +
      origin.z.toFixed(1) +
      "), scale=" +
      worldScaleVal,
  );
}

// ---- grab service ----------------------------------------------------------
// `options` is optional and entirely up to the caller:
//   lockAxis     "x" | "y" — confine the drag to one axis through the grab point
//   frequencyHz / dampingRatio / maxForce — MouseJoint feel for dynamic bodies
//   onGrab() / onRelease() — fired for THIS body only
// Physics2D stays generic: it doesn't know what a draggable component is, only that
// a body may carry drag options. PhysicsDraggable2D is what fills them in.
function registerGrabbable(body, options) {
  if (!body) return;
  if (grabbables.indexOf(body) === -1) grabbables.push(body);
  if (options) grabOptions.set(body, options);
}
function unregisterGrabbable(body) {
  var i = grabbables.indexOf(body);
  if (i !== -1) grabbables.splice(i, 1);
  grabOptions.delete(body);
  unregisterGrabHandler(body);
  if (body === grabBody) releaseGrab();
  if (body === lastGrabbed) lastGrabbed = null;
}
function optionsFor(body) {
  return grabOptions.get(body) || EMPTY_OPTS;
}

// Confine a drag point to one axis, pivoting on where the grab started.
function applyAxisLock(body, wx, wy) {
  var lock = optionsFor(body).lockAxis;
  if (lock === "x") return { x: wx, y: grabLockY };
  if (lock === "y") return { x: grabLockX, y: wy };
  return { x: wx, y: wy };
}

// ---- grab handlers (claim a body's whole drag) -----------------------------
// A grab handler takes a body's drag over completely: when that body is grabbed,
// grabAt routes onGrab/onMove/onRelease (all in physics metres, same as grabAt's
// args) to the handler INSTEAD of the default MouseJoint / direct-ease. The body is
// pickable for as long as the handler is registered (pickAt checks handler bodies),
// and stops being pickable the moment it's unregistered — without touching the
// independent `grabbables` list, so a draggable body stays draggable and a
// non-draggable one doesn't. This keeps custom interactions (e.g. the slingshot
// launcher) inside the one grab arbiter, so they never fight the touch path or the
// camera pan — and Physics2D stays ignorant of what the handler actually does.
function findHandler(body) {
  for (var i = 0; i < grabHandlers.length; i++)
    if (grabHandlers[i].body === body) return grabHandlers[i].handler;
  return null;
}
function registerGrabHandler(body, handler) {
  if (!body || !handler) return;
  // NB: do NOT add to `grabbables` here. A handler makes its body pickable on its
  // own (see pickAt), and unregistering the handler must fully restore pickability.
  // If we registered it as a grabbable too, a non-draggable body (e.g. a launcher
  // projectile) would stay draggable after the handler is dropped — because
  // unregisterGrabHandler can't tell our convenience registration apart from the
  // body's own draggable one. Keeping the two lists independent avoids that.
  if (!findHandler(body)) grabHandlers.push({ body: body, handler: handler });
}
function unregisterGrabHandler(body) {
  for (var i = 0; i < grabHandlers.length; i++) {
    if (grabHandlers[i].body === body) {
      grabHandlers.splice(i, 1);
      break;
    }
  }
}

// Is point p inside any fixture of body b? (precise shape test.)
function fixtureHit(b, wx, wy) {
  var p = Vec2(wx, wy);
  for (var f = b.getFixtureList(); f; f = f.getNext()) {
    if (f.testPoint(p)) return true;
  }
  return false;
}
// Exact point-pick over registered grabbables only (a handful of bodies — fast;
// avoids version-sensitive queryAABB). Static scenery never registers.
function pickAt(wx, wy) {
  for (var i = 0; i < grabbables.length; i++) {
    if (fixtureHit(grabbables[i], wx, wy)) return grabbables[i];
  }
  // Also pickable: any body a grab handler currently claims (e.g. a launcher
  // projectile that isn't an independently-draggable PhysicsBody2D). When the
  // handler is dropped — e.g. after launch — the body stops being pickable here,
  // so a non-draggable projectile can't be grabbed once it's been fired.
  for (var j = 0; j < grabHandlers.length; j++) {
    var hb = grabHandlers[j].body;
    if (grabbables.indexOf(hb) === -1 && fixtureHit(hb, wx, wy)) return hb;
  }
  return null;
}
// Pick the grabbable at (wx,wy), forgiving misses up to `radius` metres. Tries an
// exact hit first (precise wins); if that misses, inflates the finger into a disc
// and samples rings of growing radius, returning the first body any sample lands
// inside. Still uses testPoint, so it stays shape-accurate for thin/rotated limbs
// where a centroid-distance test would mis-pick.
function bodyAt(wx, wy, radius) {
  if (!world) return null;
  var hit = pickAt(wx, wy);
  if (hit || !radius || radius <= 0) return hit;
  var RINGS = [radius * 0.5, radius],
    SAMPLES = 8;
  for (var r = 0; r < RINGS.length; r++) {
    for (var s = 0; s < SAMPLES; s++) {
      var a = (s / SAMPLES) * Math.PI * 2;
      var b = pickAt(wx + Math.cos(a) * RINGS[r], wy + Math.sin(a) * RINGS[r]);
      if (b) return b;
    }
  }
  return null;
}

// `radius` (metres, optional) is the caller's miss tolerance — how far off a body the
// point can land and still pick it. The POLICY of how forgiving a touch should be is an
// input concern, so it's passed in per call — the built-in touch path passes Grab
// Tolerance, converted to metres. Omit / 0 = exact hit only.
function grabAt(wx, wy, radius) {
  if (!world) return false;
  var body = bodyAt(wx, wy, radius > 0 ? radius : 0);
  if (!body) return false;
  releaseGrab();
  grabBody = body;
  lastGrabbed = body;

  // A registered grab handler claims this body's drag entirely — no MouseJoint,
  // no direct-ease. Route the gesture to it (physics metres) and we're done.
  var handler = findHandler(body);
  if (handler) {
    activeHandler = handler;
    body.setAwake(true);
    if (handler.onGrab) handler.onGrab(wx, wy);
    for (var h = 0; h < grabListeners.length; h++) grabListeners[h](body);
    return true;
  }

  var target = Vec2(wx, wy);
  var opts = optionsFor(body);
  grabLockX = wx;
  grabLockY = wy; // axis-lock pivots on where the grab started

  if (body.isDynamic()) {
    // Dynamic: pull it with a MouseJoint (spring-y, respects mass + collisions).
    mouseJoint = world.createJoint(
      P.MouseJoint(
        {
          maxForce: (opts.maxForce > 0 ? opts.maxForce : 2000) * body.getMass(),
          frequencyHz: opts.frequencyHz > 0 ? opts.frequencyHz : 5,
          dampingRatio: opts.dampingRatio >= 0 ? opts.dampingRatio : 0.7,
          target: target,
        },
        worldAnchorBody,
        body,
        target,
      ),
    );
    mouseJoint.setTarget(target);
  } else {
    // Static / kinematic: infinite mass, so a MouseJoint can't move them. We
    // EMULATE the dynamic MouseJoint instead: pin an absolute world target under
    // the finger and EASE the body toward it each frame (updateDirectGrab). The
    // easing is the spring — it's what lets the camera follow the body without the
    // follow feeding back into a hard slide (an instant setTransform did exactly
    // that). The target is fixed between finger moves, so a held finger settles.
    grabDirect = true;
    var gp = body.getPosition();
    grabOffX = gp.x - wx;
    grabOffY = gp.y - wy;
    grabTarget = { x: gp.x, y: gp.y }; // start at rest where it was grabbed
    if (body.isKinematic()) body.setLinearVelocity(Vec2(0, 0));
  }

  body.setAwake(true);
  for (var i = 0; i < grabListeners.length; i++) grabListeners[i](body); // notify consumers
  if (opts.onGrab) opts.onGrab(); // this body's own hook
  return true;
}
// Move the grab target to an absolute world point (metres), keeping the grab offset
// so the body doesn't snap its centre to the finger. Dynamic: drive the MouseJoint.
// Direct (static/kinematic): just update the target; updateDirectGrab eases to it.
function moveGrab(wx, wy) {
  if (activeHandler) {
    if (activeHandler.onMove) activeHandler.onMove(wx, wy);
    return;
  }
  if (grabBody) {
    // honour a single-axis drag
    var p = applyAxisLock(grabBody, wx, wy);
    wx = p.x;
    wy = p.y;
  }
  if (mouseJoint) {
    mouseJoint.setTarget(Vec2(wx, wy));
    return;
  }
  if (grabDirect && grabTarget) {
    grabTarget.x = wx + grabOffX;
    grabTarget.y = wy + grabOffY;
  }
}
// Ease a directly-grabbed body toward its target each frame — the emulated spring.
// Runs in UpdateEvent (before CameraFollow reads the body in LateUpdate). The target
// is a fixed world point (set only on finger-move), so when the finger is still the
// body settles and the camera centres and stops — no runaway. While dragging, the
// easing lag turns the camera-follow coupling into the same gentle drift the dynamic
// MouseJoint gives, instead of the instant-setTransform slide.
function updateDirectGrab() {
  if (!grabDirect || !grabBody || !grabTarget) return;
  var p = grabBody.getPosition();
  var t = 1 - Math.pow(1 - DIRECT_GRAB_EASE, getDeltaTime() * 60); // frame-rate independent
  grabBody.setTransform(
    Vec2(p.x + (grabTarget.x - p.x) * t, p.y + (grabTarget.y - p.y) * t),
    grabBody.getAngle(),
  );
  grabBody.setAwake(true);
}
function releaseGrab() {
  // A claimed grab fires its handler's onRelease (e.g. the launcher throws the
  // body). lastGrabbed is deliberately kept so the camera keeps following it.
  if (activeHandler) {
    var h = activeHandler;
    activeHandler = null;
    if (h.onRelease) h.onRelease();
  }
  if (mouseJoint) {
    world.destroyJoint(mouseJoint);
    mouseJoint = null;
  }
  // Static/kinematic: stop following on release so the camera reverts to its default
  // target instead of centring on the just-placed object (which feels wrong). Dynamic
  // bodies keep being followed (a thrown ball you want to track). grabAt re-sets
  // lastGrabbed right after its own releaseGrab() call, so this can't blank a new grab.
  if (grabDirect) lastGrabbed = null;
  var released = grabBody;
  grabBody = null;
  grabDirect = false;
  grabTarget = null;
  // Fired last, with the grab state already cleared, so a handler is free to start
  // a new grab (or destroy the body) without tripping over a half-released one.
  if (released) {
    var o = optionsFor(released);
    if (o.onRelease) o.onRelease();
  }
}
function onGrab(cb) {
  if (typeof cb === "function") grabListeners.push(cb);
}

// ---- reset registry --------------------------------------------------------
function registerResettable(obj) {
  if (
    obj &&
    typeof obj.respawn === "function" &&
    resettables.indexOf(obj) === -1
  )
    resettables.push(obj);
}
function unregisterResettable(obj) {
  var i = resettables.indexOf(obj);
  if (i !== -1) resettables.splice(i, 1);
}
// Reset EVERYTHING to its start state (every registered object) and return the
// camera follow to its default target (clear last-dragged).
function resetAll() {
  lastGrabbed = null;
  for (var i = 0; i < resettables.length; i++) {
    var r = resettables[i];
    if (r && typeof r.respawn === "function") r.respawn();
  }
}

// ---- collision service -----------------------------------------------------
// Body ownership: PhysicsBody2D (and anything else that builds bodies) registers
// body -> itself, so a collision can be reported as the SceneObject you authored
// rather than a raw planck body nobody can identify.
function registerBody(body, component) {
  if (body && component) bodyOwners.set(body, component);
}
function unregisterBody(body) {
  if (body) bodyOwners.delete(body);
}

// Subscribe to one body's contacts: handler = { onEnter(otherBody), onExit(otherBody) }.
// Keyed by body so a contact only wakes the handlers that asked for it.
function registerCollisionHandler(body, handler) {
  if (!body || !handler) return;
  var hs = collisionHandlers.get(body);
  if (!hs) {
    hs = [];
    collisionHandlers.set(body, hs);
  }
  if (hs.indexOf(handler) === -1) hs.push(handler);
}
function unregisterCollisionHandler(body, handler) {
  var hs = collisionHandlers.get(body);
  if (!hs) return;
  var i = hs.indexOf(handler);
  if (i !== -1) hs.splice(i, 1);
  if (!hs.length) collisionHandlers.delete(body);
}

// planck fires contacts DURING world.step(), where creating or destroying a body is
// illegal — and a collision handler ("collect the coin, remove it") is exactly where
// someone will try. So contacts are only queued here and dispatched after the step.
function queueContact(type, contact) {
  if (collisionHandlers.size === 0) return; // nobody listening
  var a = contact.getFixtureA().getBody();
  var b = contact.getFixtureB().getBody();
  if (!collisionHandlers.has(a) && !collisionHandlers.has(b)) return;
  contactQueue.push({ type: type, a: a, b: b });
}

function dispatchContact(type, body, other) {
  var hs = collisionHandlers.get(body);
  if (!hs) return;
  hs = hs.slice(); // a handler may unsubscribe itself
  for (var i = 0; i < hs.length; i++) {
    var fn = type === "enter" ? hs[i].onEnter : hs[i].onExit;
    if (fn) fn(other);
  }
}

// Drain the queue. Swap the array out FIRST so a handler that causes new contacts
// (spawning something mid-callback) queues them for the next flush instead of
// growing the array we're walking.
function flushContacts() {
  if (!contactQueue.length) return;
  var q = contactQueue;
  contactQueue = [];
  for (var i = 0; i < q.length; i++) {
    dispatchContact(q[i].type, q[i].a, q[i].b); // report to each side, with
    dispatchContact(q[i].type, q[i].b, q[i].a); // the other one as "other"
  }
}

// ---- touch input (optional; Touch Input toggle) -----------------------------
// Screen touch -> world point -> physics metres -> the grab service above. This is
// deliberately the ONLY input path: every drag goes through one arbiter, so nothing
// can fight over the same finger. A touch that lands on nothing is handed to the
// camera controller as a viewport pan, if one is wired.
var touchGrabbing = false;
var touchPanning = false;
var lastTouchScreen = null; // re-projected each frame while direct-dragging
var touchCam = null; // resolved camera
var touchCamResolved = false;

// The camera to unproject through: the wired one, else the scene's only camera. With
// several cameras there's no safe guess (a UI overlay camera would silently produce
// nonsense coordinates), so ask rather than pick.
function resolveTouchCamera() {
  if (touchCamResolved) return touchCam;
  touchCamResolved = true;
  if (script.touchCamera) {
    touchCam = script.touchCamera;
    // Set Up Camera applies to a camera you wired as much as one we found: the point
    // is that the view is right for 2D, and wiring the field says WHICH camera, not
    // that you have already configured it.
    applyCameraDefaults(touchCam, touchCam.getSceneObject().name);
    return touchCam;
  }

  var found = [];
  function scan(so) {
    var c = so.getComponent("Component.Camera");
    if (c) found.push({ cam: c, name: so.name, order: c.renderOrder });
    for (var i = 0; i < so.getChildrenCount(); i++) scan(so.getChild(i));
  }
  var n = global.scene.getRootObjectsCount();
  for (var r = 0; r < n; r++) scan(global.scene.getRootObject(r));

  if (found.length === 0) {
    print(
      "Physics2D: Touch Input is on but there's no Camera in the scene, so touches " +
        "can't be located. Nothing will be draggable.",
    );
    return null;
  }

  // Lowest render order wins. A project's main camera is normally drawn first, with
  // overlays and UI stacked on top at higher orders, so this picks the one the player
  // looks through in the common case — and unlike "there must be exactly one" it
  // still gives an answer in a scene that has several. A wired Camera always beats it.
  found.sort(function (a, b) {
    return a.order - b.order;
  });
  touchCam = found[0].cam;

  if (found.length > 1) {
    var names = [];
    for (var k = 0; k < found.length; k++)
      names.push("'" + found[k].name + "' (" + found[k].order + ")");
    log(
      "Physics2D: " + found.length + " cameras — " + names.join(", ") +
        " — using '" + found[0].name + "', the lowest render order. " +
        "Set the Camera field to pick a different one.",
    );
  }

  applyCameraDefaults(touchCam, found[0].name);
  return touchCam;
}

// The camera setup this framework assumes: a flat, head-on orthographic view. Under a
// perspective camera 2D physics looks wrong — bodies on the same plane splay apart
// toward the edges of frame — so a project never set up for 2D needs this before
// anything looks right.
var CAM_SIZE = 100; // scene units across the view
var CAM_NEAR = 1;
var CAM_FAR = 1000;

function applyCameraDefaults(cam, name) {
  if (!script.cameraDefaults || !cam) return;
  var changed = [];
  // Orthographic is the one that actually matters; the rest just have to be sane.
  if (cam.type !== Camera.Type.Orthographic) {
    cam.type = Camera.Type.Orthographic;
    changed.push("orthographic");
  }
  if (cam.size !== CAM_SIZE) { cam.size = CAM_SIZE; changed.push("size " + CAM_SIZE); }
  if (cam.near !== CAM_NEAR) { cam.near = CAM_NEAR; changed.push("near " + CAM_NEAR); }
  if (cam.far  !== CAM_FAR)  { cam.far  = CAM_FAR;  changed.push("far " + CAM_FAR); }

  if (changed.length)
    log(
      "Physics2D: set up '" + name + "' for 2D — " + changed.join(", ") +
        ". Turn off Set Up Camera to keep your own settings.",
    );
}

// The camera controller to hand an empty-space drag to. Nothing here knows what a
// camera controller IS — whoever wants the gesture registers itself (the template's
// CameraFollow does, in its resolvePhysics) and duck-types beginCameraDrag /
// cameraDragTo / endCameraDrag. Registration rather than discovery keeps this
// package free of references to components that ship outside it, and in a
// multi-world scene it pairs each controller with the Physics2D it resolved —
// hierarchy placement does the disambiguating.
var camController = null;

script.registerCameraController = function (comp) {
  if (!comp) return;
  if (camController && camController !== comp) {
    // Two controllers competing for one gesture is ambiguous; keep the first and
    // say so, since the fix (disable one) is on the caller's side.
    print(
      "Physics2D: a second camera controller tried to register — keeping the first. " +
        "A drag on empty space can only move one view, so disable one of them.",
    );
    return;
  }
  camController = comp;
};

function touchReady() {
  return !!script.touchInput && !!origin && !!world && !!resolveTouchCamera();
}

// Grab tolerance in metres. Authored in scene units (the space the finger is really
// in) and divided by the affine scale, so the same number means the same on-screen
// forgiveness whatever the world scale is.
// Resolved once at init, not per touch: a value clamped inside a per-event function
// would be corrected after the component had already reported, so nobody would ever
// see the message.
var grabTolMetres = 0;
function toleranceMetres() {
  return grabTolMetres;
}

// Normalised screen point [0,1] -> world point on the scene plane. Orthographic
// camera looking down -Z, so XY is independent of the depth we pass; we pass the
// camera->plane distance so Z lands on the plane.
function touchToWorld(touchPos) {
  if (!origin) return null;
  var camZ = touchCam.getSceneObject().getTransform().getWorldPosition().z;
  return touchCam.screenSpaceToWorldSpace(touchPos, Math.abs(camZ - origin.z));
}

function onTouchStart(eventData) {
  if (!touchReady()) return;
  var touchPos = eventData.getTouchPosition();
  lastTouchScreen = touchPos;
  var w = touchToWorld(touchPos);
  if (!w) return;
  var p = worldToPhysics(w);
  touchGrabbing = !!(p && grabAt(p.x, p.y, toleranceMetres()));
  // Nothing under the finger -> offer the gesture to the camera as a viewport pan.
  var cf = camController;
  if (!touchGrabbing && cf && cf.beginCameraDrag)
    touchPanning = !!cf.beginCameraDrag(w);
}

function onTouchMove(eventData) {
  if (!touchGrabbing && !touchPanning) return;
  var touchPos = eventData.getTouchPosition();
  lastTouchScreen = touchPos;
  var w = touchToWorld(touchPos);
  if (!w) return;
  if (touchGrabbing) {
    var p = worldToPhysics(w);
    if (p) moveGrab(p.x, p.y);
  } else {
    var cf = camController;
    if (cf && cf.cameraDragTo) cf.cameraDragTo(w);
  }
}

function onTouchEnd() {
  if (touchGrabbing) {
    releaseGrab();
    touchGrabbing = false;
  }
  if (touchPanning) {
    var cf = camController;
    if (cf && cf.endCameraDrag) cf.endCameraDrag();
    touchPanning = false;
  }
}

// Re-drive a DIRECT (static/kinematic) grab every frame from the last finger position,
// re-projected against the CURRENT camera. While the camera edge-scrolls, the finger's
// world point moves with it, so the body keeps tracking smoothly instead of stepping
// once per touch event. Dynamic grabs are left to TouchMove — unchanged feel.
function updateTouchDirectGrab() {
  if (!touchGrabbing || !lastTouchScreen || !grabDirect) return;
  if (!touchReady()) return;
  var w = touchToWorld(lastTouchScreen);
  if (!w) return;
  var p = worldToPhysics(w);
  if (p) moveGrab(p.x, p.y);
}

// ---- debug draw (optional; Debug Draw toggle) -------------------------------
// Wireframe overlay of the REAL collider geometry, so you can see where the physics
// thinks the edges are rather than where the art suggests they are.
//
// Built ONCE per body, in body-local space, on its own child object; each frame we
// only move and rotate that object. A rigid body's outline never changes shape — only
// its transform does — so there's no per-frame mesh rebuild.
//
// Shape data is read straight off the planck shapes (m_vertices / m_p+m_radius)
// rather than Fixture.getAABB(), which returns the INFLATED broad-phase box and would
// draw something visibly wrong.
var DBG_SEGMENTS = 16; // segments per circle
// The origin cross is sized from the collider it marks, not from a constant: a fixed
// arm length is only ever right at one world scale, and reads as a giant X over a
// small body or vanishes on a big one. As a fraction of the shape's own half-extent
// it looks the same at any camera size, world scale or body size.
var DBG_CROSS_FRAC = 0.18; // arm = this much of the SHORTER half-extent
var DBG_CROSS_MIN_FRAC = 0.02; // ...but never thinner than this much of the LONGER one,
// so a long, flat collider (terrain chain, a floor slab)
// still shows a mark instead of nothing
var DBG_DEPTH = 2.0; // scene units toward the camera, so it draws on top

var dbgContainer = null;
var dbgTracked = null; // Map(body -> { obj, empty })
var dbgMatDyn = null,
  dbgMatStat = null;
var dbgTintWarned = false; // one-shot: line material has no colour input

// Two clones, not one per body: the tint depends only on whether the body moves.
function debugMaterialFor(isDyn) {
  if (!script.debugMaterial) return null;
  if (isDyn && dbgMatDyn) return dbgMatDyn;
  if (!isDyn && dbgMatStat) return dbgMatStat;

  var m = script.debugMaterial.clone();
  var c = isDyn ? script.debugDynamicColor : script.debugStaticColor;
  var pass = m.mainPass;
  var applied = [];

  // Tint baseColor AND emissiveColor: an emissive material self-lights, so emissive
  // is what's actually visible on it, while a flat unlit material only has baseColor.
  // Checked rather than try/caught — a material with neither means the outlines come
  // out whatever colour the material already was, which reads as "debug draw is
  // broken", so it's worth saying out loud once.
  if (pass && c) {
    // Drop any base texture first. Wireframe verts all carry UV (0,0), so a
    // textured material multiplies the tint by whatever single texel sits in that
    // corner — usually killing the colour entirely. Nulling it lets the tint show
    // through, which means almost any material works here instead of only a
    // hand-made untextured one.
    if (pass.baseTex !== undefined && pass.baseTex !== null) {
      try {
        pass.baseTex = null;
      } catch (eTex) {}
    }
    if (pass.baseColor !== undefined) {
      pass.baseColor = c;
      applied.push("baseColor");
    }
    if (pass.emissiveColor !== undefined) {
      pass.emissiveColor = new vec3(c.x, c.y, c.z);
      applied.push("emissiveColor");
    }
  }
  if (!applied.length && !dbgTintWarned) {
    dbgTintWarned = true;
    print(
      "Physics2D: the Debug Draw Line Material has no colour input, so the collider " +
        "outlines can't be tinted and will be hard to see. Use a simple Unlit material.",
    );
  }

  if (isDyn) dbgMatDyn = m;
  else dbgMatStat = m;
  return m;
}

function buildDebugWire(body) {
  var ws = worldScaleVal;
  var verts = [],
    idx = [],
    vc = 0,
    hadFixture = false;

  function edge(x1, y1, x2, y2) {
    verts.push(x1, y1, 0, 0, 0, x2, y2, 0, 0, 0);
    idx.push(vc, vc + 1);
    vc += 2;
  }

  for (var f = body.getFixtureList(); f; f = f.getNext()) {
    hadFixture = true;
    var sh = f.getShape();
    var type = sh.getType ? sh.getType() : sh.m_type;

    if (type === "circle") {
      var cx = (sh.m_p ? sh.m_p.x : 0) * ws;
      var cy = (sh.m_p ? sh.m_p.y : 0) * ws;
      var r = (sh.m_radius || 0) * ws;
      var px = cx + r,
        py = cy;
      for (var k = 1; k <= DBG_SEGMENTS; k++) {
        var a = (k / DBG_SEGMENTS) * Math.PI * 2;
        var nx = cx + Math.cos(a) * r,
          ny = cy + Math.sin(a) * r;
        edge(px, py, nx, ny);
        px = nx;
        py = ny;
      }
      edge(cx, cy, cx + r, cy); // spoke, so rotation is visible at all
    } else if (type === "edge") {
      // EdgeShape keeps its two ends in m_vertex1/m_vertex2 — it has no
      // m_vertices, so it has to be handled separately from polygon/chain.
      var e1 = sh.m_vertex1,
        e2 = sh.m_vertex2;
      if (e1 && e2) edge(e1.x * ws, e1.y * ws, e2.x * ws, e2.y * ws);
    } else {
      var vsrc = sh.m_vertices; // polygon (closed loop) or chain (open run)
      var n = vsrc ? vsrc.length : 0;
      if (n >= 2) {
        var segs = type === "polygon" ? n : n - 1;
        for (var i = 0; i < segs; i++) {
          var a1 = vsrc[i],
            a2 = vsrc[(i + 1) % n];
          edge(a1.x * ws, a1.y * ws, a2.x * ws, a2.y * ws);
        }
      }
    }
  }

  if (!hadFixture) return { obj: null, empty: true }; // e.g. the world anchor

  // Origin cross, sized from the shape just built. `verts` holds ONLY fixture
  // geometry at this point (the cross is appended below), interleaved 5 floats per
  // vertex: position xyz then texture0 uv. Measure from the body origin rather than
  // from the shape's centre — the cross marks the origin, so what matters is how far
  // the outline reaches around it.
  var reachX = 0,
    reachY = 0;
  for (var vi = 0; vi < verts.length; vi += 5) {
    var ax = Math.abs(verts[vi]),
      ay = Math.abs(verts[vi + 1]);
    if (ax > reachX) reachX = ax;
    if (ay > reachY) reachY = ay;
  }
  var shortSide = Math.min(reachX, reachY),
    longSide = Math.max(reachX, reachY);
  var s = Math.max(DBG_CROSS_FRAC * shortSide, DBG_CROSS_MIN_FRAC * longSide);
  if (s > 0) {
    edge(-s, 0, s, 0);
    edge(0, -s, 0, s);
  }

  if (vc === 0) return { obj: null, empty: true };

  var mb = new MeshBuilder([
    { name: "position", components: 3 },
    { name: "texture0", components: 2 },
  ]);
  mb.topology = MeshTopology.Lines;
  mb.indexType = MeshIndexType.UInt16;
  mb.appendVerticesInterleaved(verts);
  mb.appendIndices(idx);
  if (!mb.isValid()) return { obj: null, empty: true };
  mb.updateMesh();

  var obj = global.scene.createSceneObject("Collider");
  obj.setParent(dbgContainer);
  obj.layer = dbgContainer.layer;
  var v = obj.createComponent("Component.RenderMeshVisual");
  v.mesh = mb.getMesh();
  var mat = debugMaterialFor(!!(body.isDynamic && body.isDynamic()));
  if (mat) v.mainMaterial = mat;

  return { obj: obj, empty: false };
}

function ensureDebugContainer() {
  if (dbgContainer) return;
  dbgTracked = new Map();
  dbgContainer = global.scene.createSceneObject("PhysicsDebugDraw");
  dbgContainer.setParent(script.getSceneObject());
  dbgContainer.layer = script.getSceneObject().layer;
  if (!script.debugMaterial) {
    print(
      "Physics2D: Debug Draw is on but no Line Material is set, so the collider " +
        "outlines will be invisible. Assign an Unlit material.",
    );
  }
}

// Reconcile the tracked wireframes against the live body list, then move them onto
// their bodies. Bodies that appear get one built, bodies that leave get reaped, so it
// tracks whatever the game spawns and destroys with no extra wiring.
function debugTick() {
  ensureDebugContainer();

  var seen = new Set(); // Set, not an array: this is checked once per body
  for (var b = world.getBodyList(); b; b = b.getNext()) {
    seen.add(b);
    var isDyn = !!(b.isDynamic && b.isDynamic());
    var want = isDyn ? script.debugDynamic : script.debugStatic;

    var entry = dbgTracked.get(b);
    if (!entry) {
      if (!want) continue; // don't build what's hidden; it'll build if shown later
      entry = buildDebugWire(b);
      dbgTracked.set(b, entry);
    }
    if (entry && !entry.empty && entry.obj) {
      entry.obj.enabled = want;
      if (want) {
        var p = b.getPosition();
        var wp = physicsToWorld(p.x, p.y);
        if (wp) {
          var t = entry.obj.getTransform();
          t.setWorldPosition(new vec3(wp.x, wp.y, wp.z + DBG_DEPTH));
          t.setWorldRotation(quat.angleAxis(b.getAngle(), new vec3(0, 0, 1)));
        }
      }
    }
  }

  var dead = []; // collect first — don't mutate while iterating
  dbgTracked.forEach(function (entry, body) {
    if (!seen.has(body)) dead.push(body);
  });
  for (var d = 0; d < dead.length; d++) {
    var e = dbgTracked.get(dead[d]);
    if (e && e.obj && !e.obj.isDestroyed) e.obj.destroy();
    dbgTracked.delete(dead[d]);
  }
}

// ---- fixed-timestep step loop ----------------------------------------------
function step(dt) {
  if (!world) return;
  accumulator += dt;
  var steps = 0;
  while (accumulator >= stepDt && steps < maxSteps) {
    world.step(stepDt, velIter, posIter);
    accumulator -= stepDt;
    steps++;
  }
  flushContacts(); // outside the step: user code can now touch the world
}

function init() {
  Vec2 = P.Vec2;

  worldScaleVal = guard.num("Metres -> Scene Units", script.worldScale, 0.01, 10000, 50,
                            "it scales the whole world, so it can never be zero");
  // Gravity is deliberately allowed to be 0 or negative: zero-g and upside-down are
  // both games people make. Only the magnitude is bounded.
  var g = guard.num("Gravity", script.gravity, -1000, 1000, 10);
  // Below ~1/240s the solver does more work than it can pay for; above ~1/20s a fast
  // body can pass clean through a wall between two steps.
  stepDt = guard.num("Fixed Step", script.fixedDt, 1 / 240, 1 / 20, 1 / 60);
  velIter = guard.int("Velocity Iters", script.velocityIterations, 1, 50, 8);
  posIter = guard.int("Position Iters", script.positionIterations, 1, 50, 3);
  maxSteps = guard.int("Max Steps / Frame", script.maxStepsPerFrame, 1, 20, 5);
  // Upper bound left open on purpose: "far" is whatever the scene's scale makes it,
  // and a big world legitimately wants a big number here.
  var tol = guard.num("Grab Tolerance", script.grabTolerance, 0, null, 1);
  grabTolMetres = tol > 0 ? tol / worldScaleVal : 0;

  world = new P.World(Vec2(0, -g));
  // Permanent static body at the origin: a stable anchor for the grab MouseJoint
  // and for PhysicsJoint2D's "to world" joints. Kept separate from any authored
  // scenery so it can never be destroyed out from under a live joint.
  worldAnchorBody = world.createBody({ type: "static", position: Vec2(0, 0) });

  world.on("begin-contact", function (contact) {
    queueContact("enter", contact);
  });
  world.on("end-contact", function (contact) {
    queueContact("exit", contact);
  });

  // Where physics (0,0) renders. An explicit World Origin object wins; otherwise
  // THIS object's own transform is the origin — so a Physics2D dropped into an
  // empty scene is immediately usable with nothing wired at all. Either way the
  // affine is fixed up-front and locked, rather than depending on some other
  // component calibrating it at an unpredictable point later.
  var originObj = script.worldOrigin || script.getSceneObject();
  var wp = originObj.getTransform().getWorldPosition();
  origin = new vec3(wp.x, wp.y, wp.z);
  originLocked = true;

  if (script.autoStep) {
    script.createEvent("UpdateEvent").bind(function () {
      step(getDeltaTime());
    });
  }
  // Ease directly-grabbed (static/kinematic) bodies toward the finger every frame,
  // in Update so CameraFollow (LateUpdate) reads the new position. No-op when idle.
  script.createEvent("UpdateEvent").bind(function () {
    updateTouchDirectGrab(); // re-project the finger first, then ease toward it
    updateDirectGrab();
  });

  // Bound unconditionally so setDebugDraw() can switch it on at runtime; it costs a
  // single flag check per frame while off.
  script.createEvent("LateUpdateEvent").bind(function () {
    if (script.debugDraw) debugTick();
    else if (dbgContainer) dbgContainer.enabled = false;
  });

  if (script.touchInput) {
    script.createEvent("TouchStartEvent").bind(onTouchStart);
    script.createEvent("TouchMoveEvent").bind(onTouchMove);
    script.createEvent("TouchEndEvent").bind(onTouchEnd);
    resolveTouchCamera(); // resolve now so any warning appears at startup
  }

  log(
    "Physics2D: world built. scale=" +
      worldScaleVal +
      ", origin from " +
      (script.worldOrigin
        ? "World Origin '" + originObj.name + "'"
        : "own transform") +
      " (" +
      origin.x.toFixed(1) +
      ", " +
      origin.y.toFixed(1) +
      ", " +
      origin.z.toFixed(1) +
      ").",
  );
  guard.report();   // anything that had to be corrected to get here
}

// ---- public API ------------------------------------------------------------
script.getWorld = function () {
  return world;
};
script.step = step;
script.getPlanck = function () {
  return P;
};
script.getWorldAnchor = function () {
  return worldAnchorBody;
}; // static origin body for "to world" joints

// coordinate affine
script.physicsToWorld = physicsToWorld;
script.worldToPhysics = worldToPhysics;
script.calibrate = calibrate;
script.getWorldScale = function () {
  return worldScaleVal;
};
script.getDepthZ = function () {
  return origin ? origin.z : null;
};
script.isReady = function () {
  return !!origin;
};

// debug draw
script.setDebugDraw = function (on) {
  script.debugDraw = !!on;
  if (dbgContainer) dbgContainer.enabled = script.debugDraw;
};
script.isDebugDraw = function () {
  return !!script.debugDraw;
};

// touch input
// isTouchEnabled() is what PhysicsDraggable2D asks, so it can warn when an object is
// marked draggable in a world where nothing can pick it up.
script.isTouchEnabled = function () {
  return !!script.touchInput && !!resolveTouchCamera();
};
// Normalised screen point -> a point on the scene plane, in scene units. The world
// owns the camera and the plane depth, so anything that needs to turn a touch into a
// position (a spawner, a placement tool) asks here instead of resolving a camera of
// its own. Null when there's no camera or the affine isn't ready.
script.touchToWorld = function (touchPos) {
  if (!touchPos || !origin || !resolveTouchCamera()) return null;
  return touchToWorld(touchPos);
};

// grab service
script.grabAt = grabAt;
script.bodyAt = bodyAt; // pick with a miss tolerance, without grabbing
script.moveGrab = moveGrab;
script.releaseGrab = releaseGrab;
script.isGrabbing = function () {
  return !!mouseJoint || grabDirect || !!activeHandler;
};
script.isDirectGrab = function () {
  return grabDirect;
}; // true while dragging a static/kinematic body
script.getLastGrabbed = function () {
  return lastGrabbed;
};
script.registerGrabbable = registerGrabbable;
script.unregisterGrabbable = unregisterGrabbable;
script.registerGrabHandler = registerGrabHandler;
script.unregisterGrabHandler = unregisterGrabHandler;
script.onGrab = onGrab;

// reset registry
script.resetAll = resetAll;
script.registerResettable = registerResettable;
script.unregisterResettable = unregisterResettable;

// collision service
script.registerBody = registerBody;
script.unregisterBody = unregisterBody;
script.registerCollisionHandler = registerCollisionHandler;
script.unregisterCollisionHandler = unregisterCollisionHandler;
script.getComponentForBody = function (body) {
  return bodyOwners.get(body) || null;
};
script.getSceneObjectForBody = function (body) {
  var c = bodyOwners.get(body);
  return c && typeof c.getSceneObject === "function"
    ? c.getSceneObject()
    : null;
};

// ---- instance registry ------------------------------------------------------
// So a component can find a world WITHOUT a wired `physics` reference. Two parts:
//   isPhysics2D  a brand, because getComponents("Component.ScriptComponent") can't
//                tell you which script asset a component is running.
//   resolveFor() nearest branded component at-or-above a SceneObject, else the
//                default instance. Consumers only call this when their input is
//                empty, so an explicit wiring always wins and multiple worlds keep
//                working. Registration happens at AWAKE (top-level), while every
//                consumer resolves lazily in its build poll — so hierarchy order
//                still doesn't matter.
script.isPhysics2D = true;

var REG = globalThis.Physics2DRegistry;
if (!REG) {
  REG = globalThis.Physics2DRegistry = {
    instances: [],
    register: function (sc) {
      if (sc && this.instances.indexOf(sc) === -1) this.instances.push(sc);
    },
    unregister: function (sc) {
      var i = this.instances.indexOf(sc);
      if (i !== -1) this.instances.splice(i, 1);
    },
    getDefault: function () {
      return this.instances.length ? this.instances[0] : null;
    },
    resolveFor: function (so) {
      for (var cur = so; cur; cur = cur.getParent ? cur.getParent() : null) {
        var comps = cur.getComponents("Component.ScriptComponent");
        for (var i = 0; i < comps.length; i++) {
          if (comps[i].isPhysics2D) return comps[i];
        }
      }
      // Nothing above it: fall back to the default world. With more than one in
      // the scene that's a guess, so say so — the fix is to wire the input.
      var d = this.getDefault();
      if (d && this.instances.length > 1 && so) {
        print(
          "Physics2D: '" +
            so.name +
            "' has no Physics2D above it in the hierarchy — " +
            "defaulting to the first of " +
            this.instances.length +
            " worlds. Wire its Physics input to pick one explicitly.",
        );
      }
      return d;
    },
  };
}
REG.register(script);
script.createEvent("OnDestroyEvent").bind(function () {
  REG.unregister(script);
});

// planck is required at the top of this file, so the world can be built as soon as
// the lens starts. Consumers still poll isReady(), so ordering stays irrelevant.
script.createEvent("OnStartEvent").bind(init);
