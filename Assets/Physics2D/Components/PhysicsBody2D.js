//@component
// =============================================================================
// PhysicsBody2D.js  —  turn any visual SceneObject into a 2D physics body
// -----------------------------------------------------------------------------
// Drop this on any mesh / image (a beachball, a crate, a platform, a sloped wall)
// and at runtime it becomes a planck body in the shared Physics2D world. One
// component covers every body type the sandbox needs:
//
//   bodyType : dynamic  — moved by forces/gravity; its visual is driven each frame
//              static   — never moves; collision-only (platforms, walls, ground).
//                         This replaces the old BlockBodies script.
//              kinematic— moved by velocity, ignores forces (moving platforms).
//   shape    : circle (radius from the visual's width) | box (from width+height) |
//              polygon (outline typed in; concave is fine — see below)
//
// DRAGGING is NOT part of this component — add a PhysicsDraggable2D alongside it.
//   (It used to be a `draggable` checkbox here; it moved out so there's one way to
//   do it, with its own options and callbacks.)
//
// SIZING (authored in the editor — read from the visual's WORLD scale)
//   Circle : radius = (world width = scale.x) / 2
//   Box    : half-extents from the two IN-PLANE local axes (auto-handles an
//            unrotated box [X/Y] and a laid-down plane [X/Z]); tilt = rotation about view-Z
//   Polygon: local verts where +-1 = the visual's edges (origin = centre), scaled by
//            the same in-plane axes — so a square [-1..1] equals the box. A CONCAVE
//            outline is split into convex fixtures whose union is the real shape,
//            rather than collapsing to its hull (see the decomposition block below).
//   Scaled via Physics2D's metres<->scene affine, so editor size == physics size.
//
// ROTATION (dynamic/kinematic): driven with a BIND DELTA so the visual keeps its
//   authored facing and only ADDS the body's spin about view-Z.
//
// WIRING
//   Physics -> the Physics2D ScriptComponent (world + affine + grab + reset).
//     OPTIONAL: left empty it resolves itself — nearest Physics2D at-or-above this
//     object in the hierarchy, else the scene's first one. Wire it only to pick a
//     specific world when there's more than one.
//   Builds lazily once Physics2D's affine is ready (isReady()).
// =============================================================================

// @ui {"widget":"label","label":"<b>Body</b>"}
// @input string bodyType = "dynamic" {"label":"Body Type","widget":"combobox","values":[{"label":"Dynamic","value":"dynamic"},{"label":"Static","value":"static"},{"label":"Kinematic","value":"kinematic"}]}
// @input string shape = "circle" {"label":"Shape","widget":"combobox","values":[{"label":"Circle","value":"circle"},{"label":"Box","value":"box"},{"label":"Polygon","value":"polygon"}]}
// @input string polygonVerts = "[-1,-1],[1,-1],[1,1],[-1,1]" {"label":"Polygon Vertices","hint":"Trace the outline as points, going around the edge in order. Coordinates are local, where -1 to 1 spans the object (0,0 is its centre) — so [-1,-1],[1,-1],[0,1] is a triangle. Concave shapes are fine (L, T, star): they are split into pieces automatically. Needs 3+ points and an outline that doesn't cross itself. Turn on Debug Draw in Physics2D to see the result.","showIf":"shape","showIfValue":"polygon"}
// A clickable link to the polygon editor. The Inspector renders a subset of HTML in a
// label widget, so an <a href> comes out as a real link — which beats making someone
// copy a URL out of a hint tooltip by hand. showIf keeps it with the Polygon Vertices
// field it belongs to.
// @ui {"widget":"label","label":"<a href=\"https://dev.pl.ai/demos/trace/\">Open the polygon editor</a>","showIf":"shape","showIfValue":"polygon"}
// @ui {"widget":"separator"}
// @ui {"widget":"label","label":"<b>Material</b>"}
// @input float density = 0.4 {"widget":"spinbox","min":0.001,"max":1000,"step":0.05,"label":"Density","hint":"Mass = density x area. A beachball is light: ~0.3-0.5. Ragdoll parts use 1.0. (Ignored for static.)"}
// @input float friction = 0.4 {"widget":"spinbox","min":0,"max":5,"step":0.05,"label":"Friction"}
// @input float restitution = 0.6 {"widget":"slider","min":0,"max":1,"step":0.05,"label":"Restitution (bounce)","hint":"0 = dead, 1 = perfectly bouncy. A beachball ~0.6."}
// @input float linearDamping = 0.05 {"widget":"spinbox","min":0,"max":100,"step":0.01,"label":"Linear Damping"}
// @input float angularDamping = 0.05 {"widget":"spinbox","min":0,"max":100,"step":0.01,"label":"Angular Damping"}
// @ui {"widget":"separator"}
// @input bool advanced = false {"label":"Advanced Settings","hint":"Change how the visual follows the body, or point at a specific physics world."}
// @input bool driveRotation = true {"label":"Drive Rotation","hint":"Spin the visual with the body (dynamic/kinematic). Off = position only.","showIf":"advanced"}
// @input Component.ScriptComponent physics {"label":"Physics (Physics2D)","hint":"Optional — the shared world (world, affine, grab service, reset registry). Leave empty to auto-find: nearest Physics2D above this object in the hierarchy, else the scene's first one.","showIf":"advanced"}

var P = require("../Core/planck.min.js"); // planck (Box2D) module
var Guard = require("../Core/InputGuard.js");
var guard = Guard.make("PhysicsBody2D", script);
// Routine status line, silenced by Physics2D's Status Logging. print() is called
// here rather than inside the helper so the Logger still points at this file.
function log(msg){ if (Guard.loggingOn()) print(msg); }
var Vec2 = P.Vec2;
var world = null; // shared planck world (from Physics2D)

var body = null;
var built = false;
var isStatic = false;
var tf = null;

var bindRot = null; // object world rotation at build (quat)
var bindAngle = 0; // body angle at build (radians)
var spawnPos = null; // {x,y} physics-world spawn (for respawn)
var spawnAngle = 0;
var followBody = false; // keep writing the transform even when static (something drags it)

var Z_AXIS = new vec3(0, 0, 1);

// The shared world, resolved once. A wired Physics input wins; otherwise ask the
// registry and cache the answer back onto the input, so every script.physics call
// site below stays as-is. Runs inside ready(), i.e. lazily — Physics2D registers at
// awake, so by the first poll it's always there whatever the hierarchy order.
function resolvePhysics() {
  if (!script.physics && globalThis.Physics2DRegistry)
    script.physics = globalThis.Physics2DRegistry.resolveFor(
      script.getSceneObject(),
    );
  return script.physics;
}

function ready() {
  if (!resolvePhysics()) return false;
  if (typeof script.physics.getWorld !== "function") return false;
  if (typeof script.physics.worldToPhysics !== "function") return false;
  if (!script.physics.isReady || !script.physics.isReady()) return false; // affine ready
  world = script.physics.getWorld();
  return !!world && !!P;
}

// metres-per-scene-unit, sampled from the (isotropic) world<->physics affine.
function sampleScale(center) {
  var w2p = script.physics.worldToPhysics;
  var pc = w2p(center);
  var L = 100;
  var off = w2p(new vec3(center.x + L, center.y, center.z));
  var dxp = off.x - pc.x,
    dyp = off.y - pc.y;
  return { mpu: Math.sqrt(dxp * dxp + dyp * dyp) / L, pc: pc };
}

// Parse a vertex string like "[0,0],[1,0],[0,1]" (or "0,0, 1,0, 0,1") into
// [[x,y],...]. Forgiving: pulls out every number and pairs them in order. Returns
// null if it can't make whole pairs.
function parsePolyVerts(str) {
  if (!str) return null;
  var nums = String(str).match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!nums || nums.length < 2 || nums.length % 2 !== 0) return null;
  var out = [];
  for (var i = 0; i < nums.length; i += 2) {
    var x = parseFloat(nums[i]),
      y = parseFloat(nums[i + 1]);
    if (!isFinite(x) || !isFinite(y)) return null;
    out.push([x, y]);
  }
  return out;
}

// Signed area (shoelace) of a polygon — used to reject degenerate/collinear input,
// which planck would otherwise silently turn into a default 2x2 box.
function polyArea(verts) {
  var a = 0;
  for (var i = 0; i < verts.length; i++) {
    var p = verts[i],
      q = verts[(i + 1) % verts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// ── concave -> convex decomposition ─────────────────────────────────────────
// planck polygons must be CONVEX, and one fixture can only hold so many vertices.
// Handing it a concave outline silently collapses it to the convex hull (notches
// fill in), and handing it too many points silently DROPS the surplus before
// hulling — so a 20-point character comes back as a rectangle.
//
// Instead: ear-clip the outline into triangles, then greedily merge neighbours whose
// union is still convex (Hertel–Mehlhorn), and attach one fixture per piece. Their
// union is the real outline, and no piece is near the vertex limit. Fewer, larger
// pieces stack and grip better than raw triangles, which is why the merge pass earns
// its keep.
//
// All coordinates are [x,y] arrays in the body's LOCAL metres. Best-effort by design:
// a rejected merge just leaves two triangles separate (still correct), and an outline
// that can't be triangulated returns null so build() can fall back to the hull.
var POLY_EPS = 1e-7;
// Read the cap from planck rather than hardcoding it — Box2D-derived ports differ
// (classic Box2D allows 8, this build allows 12) and a wrong constant here silently
// costs geometry.
var MAX_POLY_VERTS = (P.Settings && P.Settings.maxPolygonVertices) || 8;

function area2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function ptEq(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

// Point p inside triangle a,b,c (any winding), edges inclusive.
function pointInTri(p, a, b, c) {
  var d1 = area2(a, b, p),
    d2 = area2(b, c, p),
    d3 = area2(c, a, p);
  var neg = d1 < -POLY_EPS || d2 < -POLY_EPS || d3 < -POLY_EPS;
  var pos = d1 > POLY_EPS || d2 > POLY_EPS || d3 > POLY_EPS;
  return !(neg && pos);
}

function isConvexCCW(poly) {
  var n = poly.length;
  if (n < 3) return false;
  for (var i = 0; i < n; i++) {
    if (area2(poly[i], poly[(i + 1) % n], poly[(i + 2) % n]) < -POLY_EPS)
      return false; // reflex
  }
  return true;
}

// Drop duplicate and collinear vertices.
function cleanPoly(poly) {
  var n = poly.length,
    out = [];
  for (var i = 0; i < n; i++) {
    var prev = poly[(i - 1 + n) % n],
      cur = poly[i],
      next = poly[(i + 1) % n];
    if (ptEq(prev, cur)) continue;
    if (Math.abs(area2(prev, cur, next)) < POLY_EPS) continue; // collinear
    out.push(cur);
  }
  return out;
}

// Ear-clip a simple polygon into CCW triangles. Returns null if the input isn't a
// valid simple polygon (self-intersecting or degenerate).
function triangulate(poly) {
  var n = poly.length;
  if (n < 3) return null;
  var V = new Array(n);
  if (polyArea(poly) > 0) {
    for (var i = 0; i < n; i++) V[i] = i;
  } // already CCW
  else {
    for (var i2 = 0; i2 < n; i2++) V[i2] = n - 1 - i2;
  } // flip to CCW
  var tris = [],
    nv = n,
    guard = 2 * nv,
    v = nv - 1;
  while (nv > 2) {
    if (guard-- <= 0) return null; // no ear found -> bad polygon
    var u = v >= nv ? 0 : v;
    v = u + 1 >= nv ? 0 : u + 1;
    var w = v + 1 >= nv ? 0 : v + 1;
    var A = poly[V[u]],
      B = poly[V[v]],
      C = poly[V[w]];
    if (area2(A, B, C) > POLY_EPS) {
      // convex corner at B
      var ear = true;
      for (var p = 0; p < nv; p++) {
        if (p === u || p === v || p === w) continue;
        if (pointInTri(poly[V[p]], A, B, C)) {
          ear = false;
          break;
        }
      }
      if (ear) {
        tris.push([A.slice(), B.slice(), C.slice()]);
        for (var s = v; s + 1 < nv; s++) V[s] = V[s + 1]; // snip vertex v
        nv--;
        guard = 2 * nv;
      }
    }
  }
  return tris;
}

// If p1 and p2 share an edge (A->B in p1, B->A in p2), return them merged with that
// edge removed. The caller checks the result is still convex before accepting it.
function tryMerge(p1, p2) {
  var n1 = p1.length,
    n2 = p2.length;
  for (var i = 0; i < n1; i++) {
    var A = p1[i],
      B = p1[(i + 1) % n1];
    for (var j = 0; j < n2; j++) {
      if (ptEq(p2[j], B) && ptEq(p2[(j + 1) % n2], A)) {
        var merged = [];
        for (var k = (i + 1) % n1; ; k = (k + 1) % n1) {
          // p1 the long way: B..A
          merged.push(p1[k]);
          if (k === i) break;
        }
        for (
          var m = (j + 2) % n2;
          m !== j;
          m = (m + 1) % n2 // p2 strictly between A..B
        )
          merged.push(p2[m]);
        return merged;
      }
    }
  }
  return null;
}

// Outline (local metres) -> array of convex CCW pieces, or null if it can't be done.
function decomposeConvex(verts) {
  var tris = triangulate(verts);
  if (!tris || !tris.length) return null;
  var pieces = tris;
  var didMerge = true;
  while (didMerge) {
    didMerge = false;
    for (var a = 0; a < pieces.length && !didMerge; a++) {
      for (var b = a + 1; b < pieces.length && !didMerge; b++) {
        var m = tryMerge(pieces[a], pieces[b]);
        if (!m) continue;
        m = cleanPoly(m);
        if (m.length >= 3 && m.length <= MAX_POLY_VERTS && isConvexCCW(m)) {
          pieces.splice(b, 1);
          pieces.splice(a, 1); // b > a, so remove b first
          pieces.push(m);
          didMerge = true;
        }
      }
    }
  }
  return pieces;
}

function build() {
  tf = script.getSceneObject().getTransform();
  var center = tf.getWorldPosition();
  var wscale = tf.getWorldScale();

  var s = sampleScale(center);
  var mpu = s.mpu,
    pc = s.pc;
  if (!(mpu > 0)) {
    print(
      "PhysicsBody2D: '" +
        script.getSceneObject().name +
        "' — bad world<->physics scale.",
    );
    return;
  }

  var isBox = script.shape === "box";
  var isPolygon = script.shape === "polygon";
  var shapes = [],
    angle = 0;
  if (isBox || isPolygon) {
    // Box and polygon both live in the camera's XY plane, but WHICH local axes are
    // in-plane depends on how the object is oriented: an unrotated object uses
    // local X/Y, while a plane laid down with a 90 deg X-rotation (the platform/
    // ground convention) uses local X/Z. Pick the two object axes that lie in the
    // plane (smallest world-Z component) and size from those, so it authors
    // correctly at any orientation. hx/hy = the half-extent (in metres) at local
    // coordinate 1 along each in-plane axis.
    var axes = [
      { v: tf.right, s: Math.abs(wscale.x) }, // local X
      { v: tf.up, s: Math.abs(wscale.y) }, // local Y
      { v: tf.back, s: Math.abs(wscale.z) }, // local Z
    ];
    axes.sort(function (a, b) {
      return Math.abs(a.v.z) - Math.abs(b.v.z);
    });
    var e1 = axes[0],
      e2 = axes[1]; // the two in-plane edges
    var hx = e1.s * 0.5 * mpu;
    var hy = e2.s * 0.5 * mpu;
    // Planck wraps every polygon in a thin collision skin (Settings.polygonRadius)
    // and rests contacts at the skin's surface, not the vertices' — so two boxes
    // authored flush sit visibly apart, a gap people notice the moment they stack
    // things. Pull the fixture in by the skin so the resting surface lands on the
    // visual's edge (Box2D's own advice for flush stacking). Skipped when the shape
    // is so small the correction would eat a meaningful part of it.
    var skin = (P.Settings && P.Settings.polygonRadius) || 0;
    if (hx > skin * 4) hx -= skin;
    if (hy > skin * 4) hy -= skin;
    angle = Math.atan2(e1.v.y, e1.v.x); // orient local X along the first edge

    if (isBox) {
      if (hx <= 0 || hy <= 0) {
        print("PhysicsBody2D: zero-size box footprint.");
        return;
      }
      shapes.push(P.Box(hx, hy));
    } else {
      // Polygon: vertices are LOCAL coords where +-1 = the visual's edges (LS
      // anchor convention), origin = visual centre — so a square [-1..1] equals
      // the box. Scale each to metres along the in-plane axes; the body angle
      // carries the orientation.
      var verts = parsePolyVerts(script.polygonVerts);
      if (!verts) {
        print(
          "PhysicsBody2D: '" +
            script.getSceneObject().name +
            "' — could not parse Polygon Vertices.",
        );
        return;
      }
      if (verts.length < 3) {
        print("PhysicsBody2D: polygon needs at least 3 vertices.");
        return;
      }
      if (Math.abs(polyArea(verts)) < 1e-9) {
        print(
          "PhysicsBody2D: polygon vertices are degenerate/collinear (zero area).",
        );
        return;
      }
      var scaled = [];
      for (var vi = 0; vi < verts.length; vi++)
        scaled.push([verts[vi][0] * hx, verts[vi][1] * hy]);

      // Split into convex pieces. This is what makes a concave outline work, and
      // it also keeps every piece well under the vertex cap, so nothing is
      // silently discarded however many points you type.
      var pieces = decomposeConvex(scaled);
      if (pieces && pieces.length) {
        for (var pi = 0; pi < pieces.length; pi++) {
          var poly = pieces[pi],
            pp = [];
          for (var q = 0; q < poly.length; q++)
            pp.push(Vec2(poly[q][0], poly[q][1]));
          try {
            shapes.push(P.Polygon(pp));
          } catch (e) {
            print("PhysicsBody2D: skipped a convex piece (" + e + ").");
          }
        }
      }
      if (!shapes.length) {
        // Couldn't decompose — the outline crosses itself or is otherwise not a
        // simple polygon. Fall back to the convex hull so the body still builds,
        // and say that the concave detail was lost rather than hiding it.
        print(
          "PhysicsBody2D: '" +
            script.getSceneObject().name +
            "' — could not split " +
            "that outline into convex pieces (does it cross itself?); using the convex " +
            "hull instead, so any notches are filled in.",
        );
        var hull = [];
        for (var h = 0; h < scaled.length; h++)
          hull.push(Vec2(scaled[h][0], scaled[h][1]));
        try {
          shapes.push(P.Polygon(hull));
        } catch (e2) {
          print("PhysicsBody2D: invalid polygon (" + e2 + ").");
          return;
        }
      }
    }
  } else {
    var radius = Math.abs(wscale.x) * 0.5 * mpu;
    if (radius <= 0) {
      print("PhysicsBody2D: zero-size circle footprint.");
      return;
    }
    shapes.push(P.Circle(radius));
  }

  var type =
    script.bodyType === "static" || script.bodyType === "kinematic"
      ? script.bodyType
      : "dynamic";
  isStatic = type === "static";

  body = world.createBody({
    type: type,
    position: Vec2(pc.x, pc.y),
    angle: angle,
    linearDamping: guard.num("Linear Damping", script.linearDamping, 0, 100, 0.05),
    angularDamping: guard.num("Angular Damping", script.angularDamping, 0, 100, 0.05),
  });
  // One fixture per convex piece. A concave polygon contributes several whose union
  // is the authored outline; they all share the same material. No filter group, so
  // default collision applies — it collides with everything else.
  for (var si = 0; si < shapes.length; si++) {
    body.createFixture({
      shape: shapes[si],
      // Density can't be 0: mass is density x area, and a dynamic body with no mass
      // behaves like nothing else in the world.
      density: guard.num("Density", script.density, 0.001, 1000, 0.4),
      friction: guard.num("Friction", script.friction, 0, 5, 0.4),
      // Above 1 a bounce returns MORE energy than it received, so the object climbs
      // higher on every hit until the simulation gives up.
      restitution: guard.num("Restitution", script.restitution, 0, 1, 0.6),
    });
  }

  bindRot = tf.getWorldRotation();
  bindAngle = angle;
  spawnPos = { x: pc.x, y: pc.y };
  spawnAngle = angle;
  built = true;

  // Claim this body so collisions can be reported as this SceneObject rather than
  // an anonymous planck body (see Physics2D's collision service).
  if (script.physics.registerBody) script.physics.registerBody(body, script);

  // Anything that can move at runtime takes part in the scene-wide Reset. A static
  // body only moves if something drags it, which PhysicsDraggable2D declares by
  // calling setVisualFollowsBody().
  if ((!isStatic || followBody) && script.physics.registerResettable)
    script.physics.registerResettable(script);

  var shapeName = isBox ? "box" : isPolygon ? "polygon" : "circle";
  log(
    "PhysicsBody2D: '" +
      script.getSceneObject().name +
      "' -> " +
      type +
      " " +
      shapeName +
      (isPolygon
        ? " (" +
          shapes.length +
          " convex piece" +
          (shapes.length === 1 ? "" : "s") +
          ")"
        : "") +
      "  pos=(" +
      pc.x.toFixed(2) +
      ", " +
      pc.y.toFixed(2) +
      ")m" +
      (isStatic ? "" : "  mass=" + body.getMass().toFixed(3)),
  );
  guard.report();

  // Snap the visual onto the scene plane once (its Z = origin.z). Movable bodies do
  // this every frame in drive(); static bodies otherwise keep their authored Z,
  // which can sit off the render plane and look invisible — so snap them here too.
  drive();
}

// Write the SceneObject transform from the body (dynamic/kinematic only). Runs in
// LateUpdate, after Physics2D has stepped the world in UpdateEvent.
function drive() {
  var pos = body.getPosition();
  var p = script.physics.physicsToWorld(pos.x, pos.y);
  if (!p) return;
  tf.setWorldPosition(p);
  if (script.driveRotation) {
    var delta = quat.angleAxis(body.getAngle() - bindAngle, Z_AXIS);
    tf.setWorldRotation(delta.multiply(bindRot));
  }
}

// Single Late handler: build once when ready, then drive the visual from the body.
// Movable bodies (dynamic/kinematic) drive every frame; a STATIC body is snapped to
// the plane once at build and then left alone, since it can't move on its own —
// unless something (PhysicsDraggable2D) says it will move it.
script.createEvent("LateUpdateEvent").bind(function () {
  if (!built) {
    if (ready()) build();
    return;
  }
  if (!isStatic || followBody) drive();
});

// --- public API --------------------------------------------------------------
// Teleport back to spawn at rest (Reset). Works for any type — a dragged static
// body returns to where it was authored; velocity is only zeroed for movable types.
script.respawn = function () {
  if (!body) return;
  if (!isStatic) {
    body.setLinearVelocity(Vec2(0, 0));
    body.setAngularVelocity(0);
  }
  body.setTransform(Vec2(spawnPos.x, spawnPos.y), spawnAngle);
  body.setAwake(true);
};
// Brand: how sibling components (PhysicsCollision2D, PhysicsDraggable2D) identify the
// body on their object. Duck-typing on getBody() isn't enough — PhysicsDraggable2D
// exposes that too, so a search could bind to the wrong component.
script.isPhysicsBody2D = true;
script.getBody = function () {
  return body;
};
// Tell this body its transform must track the physics body every frame even though
// it's static — i.e. something external moves it. PhysicsDraggable2D calls this so a
// dragged platform actually follows the finger.
script.setVisualFollowsBody = function (on) {
  followBody = !!on;
  if (
    followBody &&
    built &&
    script.physics &&
    script.physics.registerResettable
  )
    script.physics.registerResettable(script);
};

// --- camera "default follow target" protocol (same shape as Ragdoll) ----------
// Lets CameraFollow point at any single body as its default target without
// knowing it's a ragdoll. getCentroid() = this body's position (physics metres);
// ownsBody(b) = "is this me?" so a grab on this body keeps the camera on it.
script.getCentroid = function () {
  if (!body) return null;
  var p = body.getPosition();
  return { x: p.x, y: p.y };
};
script.ownsBody = function (b) {
  return !!body && b === body;
};

// --- teardown ----------------------------------------------------------------
// Destroying the SceneObject must also destroy the body. Otherwise the visual goes
// away but the fixture stays in the world as an INVISIBLE COLLIDER that things still
// bounce off, and the grab / body-owner / reset registries keep dead entries.
script.createEvent("OnDestroyEvent").bind(function () {
  if (!body) return;
  var phys = script.physics;
  if (phys) {
    if (phys.unregisterGrabbable) phys.unregisterGrabbable(body); // also drops any grab handler
    if (phys.unregisterBody) phys.unregisterBody(body);
    if (phys.unregisterResettable) phys.unregisterResettable(script);
  }
  if (world) {
    // Safe here: teardown never runs inside world.step().
    try {
      world.destroyBody(body);
    } catch (e) {}
  }
  body = null;
  built = false;
});
