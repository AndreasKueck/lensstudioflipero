# Physics2D — 2D Physics for Lens Studio

Box2D-quality 2D physics, driven from the Inspector. Drop one component into your
scene and everything after that is authored the way you already work: a visual
becomes a physics body, its transform sets the size, and the parts you want the
player to touch are checkboxes.

Created by PLAI 
(https://pl.ai)
(https://www.linkedin.com/company/plai-london/)

Built on [Planck.js](https://piqnt.com/planck.js), a JavaScript port of Box2D.

Huge love to the team behind Planck and Erin Catto.

---

## Building with an AI agent?

This package ships an agent-facing internals guide, **`AGENTS.md`**, alongside this
file — the physics model, every component's API and services, and the conventions
for extending the framework. Get it into your agent's context: it can read it
straight from the installed package with
`unzip -p Packages/Physics2D.lsc '*AGENTS.md'`, or find the copy Lens Studio
extracts into the project with `find Cache -name "AGENTS*"`.

---

## Sixty seconds to a falling box

1. Add an empty SceneObject and put **Physics2D** on it. That's the world — one per
   scene. Move this object to move the whole physics world.
2. Add **PhysicsBody2D** to any mesh or image. Set **Body Type** to `Dynamic`.
3. Add **PhysicsBody2D** to a second object, set it `Static`, and put it underneath.

Press play: the first object falls onto the second. Nothing else needs wiring —
components find the world themselves.

To pick things up, add **PhysicsDraggable2D** next to a body. Touch input is already
on.

---

## Two things worth knowing

**Physics is in metres; your scene is in scene units.** One number bridges them —
`Metres -> Scene Units` on Physics2D, default 50. It only matters when you type a
distance in metres (ragdoll height); everything else is read from the transforms
you authored.

**There is no built-in ground.** A fresh world is empty space. A floor is just a
static PhysicsBody2D, which means you can shape it however you like — flat, sloped,
or a traced polygon.

**Keep long drags inside the Lens.** A long drag is also Snapchat's change-Lens
gesture. A tiny script that sets `global.touchSystem.touchBlocking = true` keeps
the player in your game mid-throw.

---

## Components

### The world

| | |
|---|---|
| **Physics2D** | Owns the world, the fixed timestep, touch input, collisions and reset. One per scene. In its default state it's two checkboxes — drop it in and it works. |

### Making things physical

| | |
|---|---|
| **PhysicsBody2D** | Turns any visual into a body. Circle, box, or a polygon you trace yourself — concave outlines are split into convex pieces automatically. Size comes from the visual's world scale. |
| **PhysicsJoint2D** | Connects two bodies, or a body to a fixed point: hinge, spring, weld, slider, rope, suspension. The object's position is the pivot; its rotation is the axis. |

### Behaviours — add next to a PhysicsBody2D on the same object

| | |
|---|---|
| **PhysicsDraggable2D** | Makes the object pickable. Dynamic bodies are pulled on a spring, so they have weight and keep the speed you flick them with. Confine a drag to one axis for sliders and levers. |
| **PhysicsCollision2D** | Calls one of your functions when this body starts or stops touching something. Fire once for a collectable, or every time. An Object Filter narrows what counts as a hit. |

### The showpiece

| | |
|---|---|
| **PhysicsRagdoll2D** | An eleven-part jointed body that drives a Bitmoji rig. Grab a limb and it goes floppy. |

`InputGuard` is an internal helper the components share. You never add it to anything.

Looking for more? The **Physics2D template project** this package comes from has
ready-made game pieces built on it — a drivable vehicle, pinball flippers, a
tap-to-spawn toy, a camera follower and more — worth exploring as working examples
of what these components can be composed into.

---

## Seeing what the physics is actually doing

Turn on **Debug Draw** on Physics2D and assign an Unlit material to **Line Material**.
Every collider is outlined in its real shape, which is frequently not the shape of the
artwork — it's the fastest way to understand why something isn't behaving.

Turn it off before you publish.

**Status Logging** (next to it) controls the running commentary — the "world built",
"body created", "joint created" lines. It's off by default so the Logger stays quiet.
Problems always report regardless of this setting.

---

## When something doesn't work

The components talk to you. A misconfigured one prints a single clear line naming the
object and the fix, so check the Logger first — most problems say exactly what they
are:

- a body with no PhysicsBody2D next to the behaviour that needs one
- a joint pointed at something that isn't a body
- a value outside the range it can survive, and what it was changed to instead

---

## Requirements

- **Lens Studio 5.x.**
- **PhysicsRagdoll2D needs Snap's Bitmoji 3D package** to have anything to drive.
  Every other component is self-contained. Leave its Bitmoji Root empty for a
  physics-only ragdoll with no art.

## Credits

Physics by **[Planck.js](https://piqnt.com/planck.js)** v1.5.0 — a JavaScript
rewrite of Box2D by Erin Catto. Used under the MIT licence and redistributed with
this package unmodified.
