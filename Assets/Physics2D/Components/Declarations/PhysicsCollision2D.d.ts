/**
 * PhysicsCollision2D — run something when a body starts / stops touching.
 *
 * Calls one of your functions when this body starts or stops touching something.
 * Fire once for a collectable, or every time. An Object Filter narrows what
 * counts as a hit.
 *
 * Drop this next to a PhysicsBody2D. Your handler receives
 * `(otherObject, otherBody)` — otherObject is the SceneObject that was hit (null
 * for scenery with no component of its own); otherBody is the raw planck body.
 * Both are optional. Multiple instances on one object are supported.
 */

/** A collision callback. Both arguments are optional to declare. */
type PhysicsCollision2DCallback = (otherObject: SceneObject | null, otherBody: any) => void;

declare class PhysicsCollision2D extends BaseScriptComponent {
    // ---- Inputs: Call A Function ----------------------------------------------

    /** The script holding the functions named below. Leave empty if you only subscribe from code with onEnter()/onExit(). */
    callTarget: ScriptComponent | null;
    /** Name of the function to call when this body STARTS touching something, e.g. onHit. It receives (otherObject, otherBody) — both optional. Leave blank to ignore contacts starting. */
    enterFunction: string;
    /** Name of the function to call when this body STOPS touching something. Same arguments as On Enter. Leave blank to ignore contacts ending. */
    exitFunction: string;
    /** ON: each of On Enter and On Exit fires a single time, then stops — a coin can't be collected twice. Re-arms on Reset. OFF: fires on every contact, forever. */
    fireOnce: boolean;

    // ---- Inputs: Advanced -----------------------------------------------------

    /** Narrow which objects count as a hit, or point at a specific physics world. */
    advanced: boolean;
    /** Which objects are allowed to trigger your function. This does NOT change the physics — everything still bounces off everything. It only decides whose contacts you hear about. */
    respondTo: "any" | "only" | "except";
    /** The list the Object Filter works from. Listing a PARENT counts everything inside it. Ignored when Object Filter is None (Allow All). */
    filterObjects: SceneObject[];
    /** Optional — the shared world. Leave empty to auto-find: nearest Physics2D above this object in the hierarchy, else the scene's first one. */
    physics: Physics2D | null;

    // ---- Public API -----------------------------------------------------------

    /** Subscribe from script; same arguments as the Inspector function. */
    onEnter(cb: PhysicsCollision2DCallback): void;
    /** Subscribe from script; same arguments as the Inspector function. */
    onExit(cb: PhysicsCollision2DCallback): void;
    /** Re-arm after Fire Once. Also the scene-wide Reset hook. */
    rearm(): void;
    /** Reset hook — re-arms this component. */
    respawn(): void;
    hasFired(): boolean;
}
