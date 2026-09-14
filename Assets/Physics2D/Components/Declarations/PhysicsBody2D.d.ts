/**
 * PhysicsBody2D — turn any visual SceneObject into a 2D physics body.
 *
 * Turns any visual into a body. Circle, box, or a polygon you trace yourself —
 * concave outlines are split into convex pieces automatically. Size comes from
 * the visual's world scale.
 *
 * Drop this on any mesh / image and at runtime it becomes a planck body in the
 * shared Physics2D world. Dragging is NOT part of this component — add a
 * PhysicsDraggable2D alongside it.
 */

declare class PhysicsBody2D extends BaseScriptComponent {
    // ---- Inputs: Body ---------------------------------------------------------

    /** dynamic — moved by forces/gravity; static — never moves, collision-only (platforms, walls, ground); kinematic — moved by velocity, ignores forces (moving platforms). */
    bodyType: "dynamic" | "static" | "kinematic";
    /** circle (radius from the visual's width) | box (from width+height) | polygon (outline typed in; concave is fine). */
    shape: "circle" | "box" | "polygon";
    /** Trace the outline as points, going around the edge in order. Coordinates are local, where -1 to 1 spans the object (0,0 is its centre). Concave shapes are fine. Needs 3+ points and an outline that doesn't cross itself. */
    polygonVerts: string;

    // ---- Inputs: Material -----------------------------------------------------

    /** Mass = density x area. A beachball is light: ~0.3-0.5. Ragdoll parts use 1.0. (Ignored for static.) */
    density: number;
    friction: number;
    /** 0 = dead, 1 = perfectly bouncy. A beachball ~0.6. */
    restitution: number;
    linearDamping: number;
    angularDamping: number;

    // ---- Inputs: Advanced -----------------------------------------------------

    /** Change how the visual follows the body, or point at a specific physics world. */
    advanced: boolean;
    /** Spin the visual with the body (dynamic/kinematic). Off = position only. */
    driveRotation: boolean;
    /** Optional — the shared world. Leave empty to auto-find: nearest Physics2D above this object in the hierarchy, else the scene's first one. */
    physics: Physics2D | null;

    // ---- Public API -----------------------------------------------------------

    /** Teleport back to spawn at rest (Reset). Works for any type — a dragged static body returns to where it was authored; velocity is only zeroed for movable types. */
    respawn(): void;
    getBody(): any;
    /** Tell this body its transform must track the physics body every frame even though it's static — i.e. something external moves it. PhysicsDraggable2D calls this so a dragged platform actually follows the finger. */
    setVisualFollowsBody(on: boolean): void;

    // ---- Camera "default follow target" protocol ------------------------------

    /** This body's position (physics metres). */
    getCentroid(): { x: number; y: number } | null;
    /** "is this me?" so a grab on this body keeps the camera on it. */
    ownsBody(b: any): boolean;

    // ---- Discovery brand ------------------------------------------------------

    /** Brand: how sibling components (PhysicsCollision2D, PhysicsDraggable2D) identify the body on their object. */
    readonly isPhysicsBody2D: true;
}
