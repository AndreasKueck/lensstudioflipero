/**
 * PhysicsJoint2D — connect two bodies (or a body to the world) with a joint.
 *
 * Connects two bodies, or a body to a fixed point: hinge, spring, weld, slider,
 * rope, suspension. The object's position is the pivot; its rotation is the axis.
 *
 * Drop it on a SceneObject, point it at two PhysicsBody2D components, and pick a
 * joint type. Empty Body B = anchor to the world. Lengths/translations are SCENE
 * UNITS (converted to metres via the affine); angles are RADIANS; springs are
 * frequencyHz + dampingRatio.
 */

declare class PhysicsJoint2D extends BaseScriptComponent {
    // ---- Inputs: Connects -----------------------------------------------------

    /** The object this joint connects. Point it at a PhysicsBody2D. Required. */
    bodyA: PhysicsBody2D | null;
    /** The other object to connect to. Leave empty to pin Body A to a fixed point in the world instead — for a pendulum, a hinge on a wall, a fixed slider. */
    bodyB: PhysicsBody2D | null;
    /** revolute (hinge), distance (spring/rod), weld (rigid), prismatic (slider), rope (max length), wheel (suspension). */
    jointType: "revolute" | "distance" | "weld" | "prismatic" | "rope" | "wheel";
    /** Normally two joined objects pass through each other. Turn this on to let them bump instead. */
    collideConnected: boolean;

    // ---- Inputs: Revolute (hinge) ---------------------------------------------

    revEnableLimit: boolean;
    revLowerAngle: number;
    revUpperAngle: number;
    revEnableMotor: boolean;
    revMotorSpeed: number;
    revMaxMotorTorque: number;

    // ---- Inputs: Distance (spring / rod) --------------------------------------

    /** How far apart the two objects are held, in scene units. 0 = keep whatever gap they start at. */
    distLength: number;
    /** 0 = a rigid rod. Higher = a looser spring, in Hz. */
    distFrequencyHz: number;
    distDampingRatio: number;

    // ---- Inputs: Weld ---------------------------------------------------------

    /** 0 = welded solid. Higher = the joint gives, in Hz. */
    weldFrequencyHz: number;
    weldDampingRatio: number;

    // ---- Inputs: Prismatic (slider) -------------------------------------------

    priEnableLimit: boolean;
    /** How far it can slide backwards along the axis, in scene units. */
    priLowerTranslation: number;
    /** How far it can slide forwards along the axis, in scene units. */
    priUpperTranslation: number;
    priEnableMotor: boolean;
    /** How fast the motor drives it along the axis, in scene units per second. */
    priMotorSpeed: number;
    priMaxMotorForce: number;

    // ---- Inputs: Rope ---------------------------------------------------------

    /** The furthest the two objects can get apart, in scene units. 0 = keep whatever gap they start at. */
    ropeMaxLength: number;

    // ---- Inputs: Wheel (suspension) -------------------------------------------

    /** How soft the suspension is, in Hz. Lower is softer. Must stay above 0 — a wheel's spring can't be switched off, so use a Revolute joint if you want the wheel held rigid. */
    whFrequencyHz: number;
    whDampingRatio: number;
    whEnableMotor: boolean;
    whMotorSpeed: number;
    whMaxMotorTorque: number;

    // ---- Inputs: Advanced -----------------------------------------------------

    /** Point this joint at a specific physics world. */
    advanced: boolean;
    /** Optional — the physics world to build the joint in. Leave empty to auto-find: nearest Physics2D above this object in the hierarchy, else the scene's first one. */
    physics: Physics2D | null;

    // ---- Public API -----------------------------------------------------------

    getJoint(): any;
    /** Runtime motor control (no-op for jointless / motorless types). A driver usually wants all three: a motor with speed but no torque limit can't move anything. */
    enableMotor(on: boolean): void;
    setMotorSpeed(s: number): void;
    /** Revolute/wheel take a torque, prismatic a force — planck names the setter differently per joint type, so try both and let the one that exists win. */
    setMaxMotorTorque(t: number): void;
    /** Does this joint have a motor to drive at all? Lets a driver say so when it's been pointed at a rope or a weld by mistake. */
    hasMotor(): boolean;
    /** Are the travel limits on? A motor driving a joint with no limit just turns forever, so anything that drives TO a limit (a flipper, a lever, a hatch) needs to know. */
    hasLimit(): boolean;
    /** Destroy the joint (e.g. to break a constraint at runtime). Tolerant of the joint already being gone. */
    destroyJoint(): void;
}
