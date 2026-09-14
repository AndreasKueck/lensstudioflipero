//@component
// =============================================================================
// PhysicsFlipper2D.js  —  one button, one flipper
// -----------------------------------------------------------------------------
// ONE FLIPPER PER COMPONENT. A pinball table has two, so you add this twice: once
// set to the left button driving the left flipper, once to the right. Keeping them
// separate is what lets each one have its own strength, its own travel and its own
// button, instead of a single component guessing which half of a pair it's looking at.
//
// PRESS AND HOLD. The flipper snaps up while the button is held and falls back when
//   it's released, the way a real one does. Holding it up to trap the ball is a
//   normal thing to do, so it stays up until you let go — a quick tap is just a
//   short hold.
//
// HOW IT DRIVES. The joint's motor is run at full speed into the joint's own travel
//   limit, rather than an impulse being applied to the flipper body. That's what
//   makes it stop cleanly at the top instead of overshooting, and it means the swing
//   is whatever you authored the joint's Lower/Upper Angle to be. The joint MUST have
//   Enable Limit on, or the flipper would simply spin; this says so if it doesn't.
//
//   Flip Strength is the force behind the swing (motor torque). It has to beat the
//   flipper's own weight before anything moves at all: for a flipper of mass m and
//   length L pivoted at one end, that floor is roughly m x 9.8 x L/2. Below it the
//   flipper just sags. Above it, more strength = a harder hit on the ball.
//   Flip Speed is how fast it travels — a real flipper snaps over in well under a
//   tenth of a second, so this wants to be high (20+ rad/s), not gentle.
//
// FLIP DIRECTION is per flipper, and the two on a table always want opposite settings
//   because they're mirrored. WHICH one is which depends on how the art was drawn and
//   which end the pivot sits at, so there's no default that's right for both — treat it
//   as "press it, and if the flipper swings DOWN instead of up, pick the other option".
//
// CONTROLLED BY either half of the screen (nothing to wire — good for a phone) or by
//   your own UI button calling press() and release(). Button Only turns the screen
//   halves off so the flipper answers to nothing but your button.
//
// WIRING
//   Flipper Joint -> the PhysicsJoint2D on this flipper's pivot. It must be a joint
//     type with a motor (Revolute is the one you want) and have Enable Limit on.
//   Physics -> optional, resolves itself like every other component here.
// =============================================================================

// @typename PhysicsJoint2D
// @ui {"widget":"label","label":"Tap Left and Right for flippers"}
// @ui {"widget":"separator"}
// @input PhysicsJoint2D flipperJoint {"label":"Flipper Joint","hint":"The PhysicsJoint2D at this flipper's pivot. Use a Revolute joint with Enable Limit on — its Lower and Upper Angle are the flipper's resting and raised positions."}
// @input string control = "left" {"label":"Button","widget":"combobox","values":[{"label":"Left Side Of Screen","value":"left"},{"label":"Right Side Of Screen","value":"right"},{"label":"Button Only (Script)","value":"button"}],"hint":"What raises this flipper. The two screen options need no UI at all — touching that half of the screen holds it up. Button Only ignores the screen so your own UI button can call press() and release()."}
// @input string flipDirection = "ccw" {"label":"Flip Direction","widget":"combobox","values":[{"label":"Anti-Clockwise","value":"ccw"},{"label":"Clockwise","value":"cw"}],"hint":"Which way this flipper swings when the button is held. The two flippers on a table are mirrored, so they want opposite settings. Which one is which depends on how the art was drawn, so if a flipper swings DOWN when you press it, pick the other option."}
// @ui {"widget":"separator"}
// @ui {"widget":"label","label":"<b>Strength</b>"}
// @input float flipStrength = 2.0 {"widget":"spinbox","min":0.001,"step":0.5,"label":"Flip Strength","hint":"The force behind the swing. Must be enough to lift the flipper's own weight before anything moves — for a flipper of mass m and length L, that's about m x 9.8 x L/2. Raise it for a harder hit on the ball."}
// @input float flipSpeed = 25.0 {"widget":"spinbox","min":0.1,"max":500,"step":1,"label":"Flip Speed","hint":"How fast it snaps up, in radians per second. Real flippers move very fast — 20 to 40 suits most tables. Too low and the ball rolls past before the flipper arrives."}

// @ui {"widget":"separator"}
// @input bool advanced = false {"label":"Advanced Settings","hint":"Tune the return stroke, or point at a specific physics world."}
// @input float returnSpeed = 10.0 {"widget":"spinbox","min":0.1,"max":500,"step":1,"label":"Return Speed","hint":"How fast the flipper drops back when you let go, in radians per second. Slower than the flip looks more natural — it's falling, not firing.","showIf":"advanced"}
// @input float returnStrength = 0.0 {"widget":"spinbox","min":0,"step":0.5,"label":"Return Strength","hint":"Force holding the flipper down at rest. 0 uses Flip Strength. Lower it and a heavy ball can push the flipper open, which is how a real table lets a trapped ball slip through.","showIf":"advanced"}
// @input Component.ScriptComponent physics {"label":"Physics (Physics2D)","hint":"Optional — only used to notice when the player is dragging an object, so flipping doesn't fight the drag. Leave empty to auto-find: nearest Physics2D above this object in the hierarchy, else the scene's first one.","showIf":"advanced"}

// Routine status line, silenced by Physics2D's Status Logging — a globalThis
// switch so it works even before a world resolves; absent means ON.
function log(msg){ if (globalThis.Physics2DLogging !== false) print(msg); }

var joint = null; // the PhysicsJoint2D component we drive
var built = false;
var reported = false; // one-shot: nothing usable to drive
var touches = {}; // ids of touches holding our side of the screen
var pressed = false; // current button state
var applied = null; // last state pushed to the motor, so we only push on change

function resolvePhysics() {
  if (!script.physics && globalThis.Physics2DRegistry)
    script.physics = globalThis.Physics2DRegistry.resolveFor(
      script.getSceneObject(),
    );
  return script.physics;
}

// Up is the joint's UPPER limit for an anti-clockwise flipper and its LOWER limit for a
// clockwise one, so the sign of the motor speed is the whole of the mirroring.
function upSign() {
  return script.flipDirection === "cw" ? -1 : 1;
}

// Drive the motor toward one end of its travel and leave it there. Holding the motor
// on at rest is deliberate: it's what keeps the flipper pinned down against the ball
// instead of flopping, and Return Strength is how you soften that.
function setFlip(up) {
  if (applied === up) return;
  applied = up;

  // Return Strength 0 is meaningful — it means "use Flip Strength" — so it is the
  // only one of these allowed to be zero.
  var strength = up
    ? script.flipStrength
    : script.returnStrength > 0 ? script.returnStrength : script.flipStrength;
  var speed =
    (up ? script.flipSpeed : script.returnSpeed) *
    upSign() *
    (up ? 1 : -1);

  joint.enableMotor(true);
  joint.setMaxMotorTorque(Math.abs(strength));
  joint.setMotorSpeed(speed);
}

// Say once, clearly, what's wrong — the designer has no source to read.
function reportUnusable(why) {
  if (reported) return;
  reported = true;
  var name = script.getSceneObject().name;
  print("PhysicsFlipper2D: '" + name + "' " + why);
}

function ready() {
  var j = script.flipperJoint;
  if (!j || typeof j.getJoint !== "function") {
    reportUnusable(
      "has no Flipper Joint, so there's nothing to flip. Point it at the " +
        "PhysicsJoint2D on this flipper's pivot.",
    );
    return false;
  }
  if (!j.getJoint()) return false; // still building — wait, don't complain

  if (typeof j.hasMotor === "function" && !j.hasMotor()) {
    reportUnusable(
      "is pointed at a joint with no motor, so it can't be driven. A " +
        "flipper wants a Revolute joint — a Rope, Weld or Distance joint " +
        "has nothing to turn.",
    );
    return false;
  }
  joint = j;
  return true;
}

function build() {
  built = true;
  resolvePhysics();

  // No limit means the motor turns the flipper forever instead of stopping at the top
  // of its swing. It still "works", so this warns rather than refusing to run.
  if (typeof joint.hasLimit === "function" && !joint.hasLimit()) {
    print(
      "PhysicsFlipper2D: '" +
        script.getSceneObject().name +
        "' — the Flipper Joint " +
        "has Enable Limit off, so the flipper will spin right round instead of " +
        "stopping at the top of its swing. Turn on Enable Limit and set Lower/Upper " +
        "Angle to the flipper's down and up positions.",
    );
  }

  setFlip(false); // start resting at the bottom
  log(
    "PhysicsFlipper2D: '" +
      script.getSceneObject().name +
      "' ready (" +
      script.control +
      ", " +
      script.flipDirection +
      ").",
  );
}

// Which half of the screen a touch landed on, or null when this flipper is
// button-driven and shouldn't answer the screen at all.
function isOurSide(touchPos) {
  if (script.control === "button") return false;
  var left = touchPos.x < 0.5; // screen x: 0 = left edge, 1 = right
  return script.control === "left" ? left : !left;
}

script.createEvent("TouchStartEvent").bind(function (eventData) {
  if (!built) return;
  if (isOurSide(eventData.getTouchPosition()))
    touches[eventData.getTouchId()] = true;
});

// Clearing on end AND cancel matters: a touch that slides off the surface would
// otherwise leave the flipper stuck up with no way to drop it.
script.createEvent("TouchEndEvent").bind(function (eventData) {
  delete touches[eventData.getTouchId()];
});

function anyTouchHeld() {
  for (var id in touches) {
    if (Object.prototype.hasOwnProperty.call(touches, id)) return true;
  }
  return false;
}

script.createEvent("UpdateEvent").bind(function () {
  if (!built) {
    if (!reported && ready()) build();
    return;
  }

  // Dragging an object takes priority, so picking the ball up to reposition it can't
  // also fire the flippers. Checked per frame rather than at touch time, so it can't
  // depend on which script's touch handler happened to run first.
  var phys = script.physics;
  if (phys && phys.isGrabbing && phys.isGrabbing()) {
    touches = {};
    pressed = false;
  } else if (script.control !== "button") {
    pressed = anyTouchHeld();
  }

  setFlip(pressed);
});

// ---- public API -------------------------------------------------------------
// For a UI button: press on down, release on up. Works in any Button mode, so a UI
// button and the screen half can both drive the same flipper if you want.
script.press = function () {
  pressed = true;
};
script.release = function () {
  pressed = false;
};
// One-shot flick for a button that only reports a tap, with no separate release.
script.flick = function () {
  pressed = true;
  var delay = script.createEvent("DelayedCallbackEvent");
  delay.bind(function () {
    pressed = false;
  });
  delay.reset(0.12);
};
script.isFlipping = function () {
  return pressed;
};

// --- teardown ----------------------------------------------------------------
// Leave the motor off rather than running: the joint outlives this component, and a
// destroyed flipper that left its motor driving would hold the flipper up forever.
script.createEvent("OnDestroyEvent").bind(function () {
  if (built && joint && joint.enableMotor) joint.enableMotor(false);
  joint = null;
  built = false;
});
