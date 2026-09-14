/**
 * Physics2D — the planck (Box2D) world owner.
 *
 * Owns the world, the fixed timestep, touch input, collisions and reset. One per
 * scene. In its default state it's two checkboxes — drop it in and it works.
 *
 * A component whose `physics` input is empty finds a world itself: the nearest
 * Physics2D at-or-above it in the hierarchy, else the default (first-registered)
 * instance. A wired input always wins.
 *
 * Built on Planck.js.
 */

/**
 * Per-body drag options for {@link Physics2D.registerGrabbable}. Physics2D stays
 * generic: it doesn't know what a draggable component is, only that a body may
 * carry drag options.
 */
interface Physics2DGrabOptions {
    /** Confine the drag to one axis through the grab point. */
    lockAxis?: "x" | "y" | null;
    /** MouseJoint feel for dynamic bodies. */
    frequencyHz?: number;
    /** MouseJoint feel for dynamic bodies. */
    dampingRatio?: number;
    /** MouseJoint feel for dynamic bodies. */
    maxForce?: number;
    /** Fired for THIS body only. */
    onGrab?: () => void;
    /** Fired for THIS body only. */
    onRelease?: () => void;
}

/**
 * A handler that takes a body's drag over completely (see
 * {@link Physics2D.registerGrabHandler}): when that body is grabbed, the gesture
 * routes here — onGrab / onMove / onRelease, all in physics metres — instead of
 * the default MouseJoint. The body is pickable for as long as the handler is
 * registered.
 */
interface Physics2DGrabHandler {
    onGrab?: (wx: number, wy: number) => void;
    onMove?: (wx: number, wy: number) => void;
    onRelease?: () => void;
}

/**
 * A per-body contact handler for {@link Physics2D.registerCollisionHandler}.
 * Contacts fire inside `world.step()`, where planck forbids creating/destroying
 * bodies, so they are queued and flushed after the step — by the time a handler
 * runs it can safely change the world. `otherBody` is the raw planck body.
 */
interface Physics2DCollisionHandler {
    onEnter?: (otherBody: any) => void;
    onExit?: (otherBody: any) => void;
}

/** An object exposing `respawn()`, restored by {@link Physics2D.resetAll}. */
interface Physics2DResettable {
    respawn: () => void;
}

/**
 * A duck-typed viewport-pan controller (see
 * {@link Physics2D.registerCameraController}). A touch that hits nothing is
 * offered to it as a drag; the package itself references no camera controller.
 * Coordinates are the scene-space point of the touch.
 */
interface Physics2DCameraController {
    beginCameraDrag: (worldPoint: vec3) => boolean;
    cameraDragTo: (worldPoint: vec3) => void;
    endCameraDrag: () => void;
}

declare class Physics2D extends BaseScriptComponent {
    // ---- Inputs: Input --------------------------------------------------------

    /** Let the player touch the screen to drag objects around. Turn this off if your game drives the physics some other way, or you want to write your own input. */
    touchInput: boolean;
    /** The camera the player looks through — needed to turn a touch into a point in the world. Leave empty and it uses the scene's lowest render order camera, which is normally the main one. */
    touchCamera: Camera;
    /** Put the camera into the setup this framework expects: orthographic, viewing 100 scene units, near 1 / far 1000. */
    cameraDefaults: boolean;
    /** How far off an object a touch can land and still pick it up, in scene units. 0 = must touch exactly. */
    grabTolerance: number;

    // ---- Inputs: Debug --------------------------------------------------------

    /** Print a line as each body, joint and component is built. Off by default so the Logger stays readable. Problems are reported either way — this only silences the running commentary. */
    statusLogging: boolean;
    /** Outline every collider on top of the scene, so you can see the shapes the physics is actually using — which is often not the shape of the artwork. A development aid: turn it off before publishing. */
    debugDraw: boolean;
    /** An Unlit material for the outlines. */
    debugMaterial: Material;
    /** Outline bodies that move — the balls, crates and other pieces. */
    debugDynamic: boolean;
    /** Outline bodies that don't move — floors, walls, terrain. */
    debugStatic: boolean;
    debugDynamicColor: vec4;
    debugStaticColor: vec4;

    // ---- Inputs: Advanced -----------------------------------------------------

    /** Show the world's tuning parameters. Every one has a sensible default — you only need these to change gravity/scale, retune the solver, or set an explicit world origin. */
    advanced: boolean;
    /** Step the world off UpdateEvent. Turn OFF only if a GameManager calls step() explicitly. */
    autoStep: boolean;
    /** Magnitude; applied as (0, -gravity). 10 ~ Earth-ish for this rig scale. */
    gravity: number;
    /** Scene units per physics metre — the whole world <-> scene mapping. 50 matches the sample rig. */
    worldScale: number;
    /** Optional. Physics (0,0) maps to this object's world position (its Z = render depth). Leave empty to use THIS object's own transform as the origin — so move the Physics2D object to move the whole physics world. */
    worldOrigin: SceneObject;
    velocityIterations: number;
    positionIterations: number;
    /** 1/60. Don't go below 1/120 without raising iterations. */
    fixedDt: number;
    /** Catch-up cap after a hitch; avoids the spiral of death. */
    maxStepsPerFrame: number;

    // ---- World ----------------------------------------------------------------

    getWorld(): any;
    step(dt: number): void;
    getPlanck(): any;
    /** The static origin body for "to world" joints. */
    getWorldAnchor(): any;

    // ---- Coordinate affine (metres <-> scene units) ---------------------------

    /** physicsToWorld() / worldToPhysics() are the only place physics metres and scene units meet. */
    physicsToWorld(x: number, y: number): vec3 | null;
    worldToPhysics(worldVec: vec3): { x: number; y: number } | null;
    /** Calibrate the origin — the scene point where physics (0,0) renders. Ignored while the origin is locked. */
    calibrate(originVec3: vec3): void;
    getWorldScale(): number;
    getDepthZ(): number | null;
    /** The affine is always known by the end of init, so this is true from the first frame. */
    isReady(): boolean;

    // ---- Debug draw -----------------------------------------------------------

    setDebugDraw(on: boolean): void;
    isDebugDraw(): boolean;

    // ---- Touch input ----------------------------------------------------------

    /** What PhysicsDraggable2D asks, so it can warn when an object is marked draggable in a world where nothing can pick it up. */
    isTouchEnabled(): boolean;
    /** Normalised screen point -> a point on the scene plane, in scene units. Null when there's no camera or the affine isn't ready. */
    touchToWorld(touchPos: vec2): vec3 | null;

    // ---- Grab service ---------------------------------------------------------

    /** `radius` (metres, optional) is the caller's miss tolerance — how far off a body the point can land and still pick it. Omit / 0 = exact hit only. */
    grabAt(wx: number, wy: number, radius?: number): boolean;
    /** Pick the grabbable at (wx, wy) with a miss tolerance, without grabbing. */
    bodyAt(wx: number, wy: number, radius?: number): any;
    /** Move the grab target to an absolute world point (metres), keeping the grab offset so the body doesn't snap its centre to the finger. */
    moveGrab(wx: number, wy: number): void;
    releaseGrab(): void;
    isGrabbing(): boolean;
    /** True while dragging a static/kinematic body. */
    isDirectGrab(): boolean;
    getLastGrabbed(): any;
    /** Pickable bodies are those registered here; `options` carries per-body drag settings. */
    registerGrabbable(body: any, options?: Physics2DGrabOptions): void;
    unregisterGrabbable(body: any): void;
    /** A grab handler takes a body's drag over completely; the body is pickable for as long as the handler is registered. */
    registerGrabHandler(body: any, handler: Physics2DGrabHandler): void;
    unregisterGrabHandler(body: any): void;
    /** Lets a consumer react when one of its bodies is grabbed (e.g. go floppy). */
    onGrab(cb: (body: any) => void): void;

    // ---- Reset registry -------------------------------------------------------

    /** Reset EVERYTHING to its start state (every registered object) and return the camera follow to its default target (clear last-dragged). */
    resetAll(): void;
    /** Register an object (exposing respawn()) to be restored by resetAll(). */
    registerResettable(obj: Physics2DResettable): void;
    unregisterResettable(obj: Physics2DResettable): void;

    // ---- Collision service ----------------------------------------------------

    /** Registers body -> component, so a collision can be reported as the SceneObject you authored rather than a raw planck body nobody can identify. */
    registerBody(body: any, component: BaseScriptComponent): void;
    unregisterBody(body: any): void;
    /** Subscribe to one body's contacts. Keyed by body so a contact only wakes the handlers that asked for it. */
    registerCollisionHandler(body: any, handler: Physics2DCollisionHandler): void;
    unregisterCollisionHandler(body: any, handler: Physics2DCollisionHandler): void;
    getComponentForBody(body: any): BaseScriptComponent | null;
    getSceneObjectForBody(body: any): SceneObject | null;

    // ---- Camera controller registry -------------------------------------------

    /** A touch that hits nothing is offered as a viewport pan to whatever registers here (duck-typed beginCameraDrag / cameraDragTo / endCameraDrag). The first one wins. */
    registerCameraController(comp: Physics2DCameraController): void;

    // ---- Discovery brand ------------------------------------------------------

    /** Brand: lets a component find this world when its `physics` input is empty. */
    readonly isPhysics2D: true;
}
