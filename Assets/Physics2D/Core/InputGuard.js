//@module
// =============================================================================
// InputGuard.js  —  keep Inspector numbers inside the range each one survives
// -----------------------------------------------------------------------------
// A shared helper, require()d by the components. It exists because a number typed
// into the Inspector goes straight into a physics solver, and the solver does not
// fail where the mistake was made: a Wheel joint with Springiness 0 builds happily
// and then kills the lens several frames later, from inside planck's collision
// code, with an error naming neither the joint nor the field.
//
// TWO KINDS OF BAD VALUE, both handled the same way:
//   - the ones that BREAK — a zero scale factor, a spring stiffer than the timestep
//     can resolve, a restitution above 1 that adds energy on every bounce.
//   - the ones that are merely NONSENSE — negative mass, negative friction — which
//     produce results nobody wants but which no error ever mentions.
//
// CORRECTIONS ARE ANNOUNCED, NEVER SILENT. A value that quietly becomes something
//   else is harder to debug than one that was refused out loud, and the designer
//   reading the Logger has no source to check against. Each component collects its
//   corrections and prints them as ONE line naming every field it had to change.
//
// IT ALSO CARRIES THE LOG SWITCH, as loggingOn(). Components keep their own one-line
//   log() helper and call print() themselves rather than handing the string here —
//   otherwise every routine line in the project would be attributed to THIS file in
//   the Logger instead of the component it came from. Anything reporting a PROBLEM
//   calls print() unconditionally and is never silenced.
//
// USAGE
//   var Guard = require("../Core/InputGuard.js");
//   var guard = Guard.make("PhysicsBody2D", script);
//   var d = guard.num("Density", script.density, 0.001, 1000, 0.4);
//   guard.report();          // one line, or nothing if everything was in range
// =============================================================================

// Round for display so a clamp message doesn't print 0.30000000000000004.
function show(v){
    if (typeof v !== "number" || !isFinite(v)) return String(v);
    return (Math.round(v * 1000) / 1000).toString();
}

// Status logging is a global switch, published by Physics2D from its Status Logging
// input. It lives on globalThis rather than being read off the world so that a
// component which never resolves a world — or which logs before it has — still
// respects it. Absent means ON, so a scene with no Physics2D yet still talks.
function loggingOn(){
    return globalThis.Physics2DLogging !== false;
}

function make(componentName, script){
    var notes = [];

    // A clamp that runs every frame must not grow this list every frame. Recording
    // each distinct message once makes repeated clamping harmless, and is also what
    // keeps the printed line readable.
    function note(msg){
        for (var i = 0; i < notes.length; i++) if (notes[i] === msg) return;
        notes.push(msg);
    }

    // Clamp `v` into [min, max]. Pass null for either bound to leave that side open.
    // `fallback` is used only when the value isn't a usable number at all.
    function num(label, v, min, max, fallback, why){
        var tail = why ? " (" + why + ")" : "";
        if (typeof v !== "number" || !isFinite(v)){
            note(label + " isn't a usable number, so " + show(fallback) + " was used" + tail);
            return fallback;
        }
        if (min !== null && min !== undefined && v < min){
            note(label + " was " + show(v) + ", raised to " + show(min) + tail);
            return min;
        }
        if (max !== null && max !== undefined && v > max){
            note(label + " was " + show(v) + ", lowered to " + show(max) + tail);
            return max;
        }
        return v;
    }

    // Same, rounded to a whole number — for counts and iteration limits.
    function int(label, v, min, max, fallback, why){
        var n = num(label, v, min, max, fallback, why);
        return Math.round(n);
    }

    // A value that only means anything as +1 or -1 (a mirror flip). Anything else
    // scales what it multiplies, which is never what was intended.
    function sign(label, v, fallback){
        if (typeof v !== "number" || !isFinite(v) || v === 0){
            note(label + " must be 1 or -1, so " + show(fallback) + " was used");
            return fallback;
        }
        if (v !== 1 && v !== -1){
            var s = v > 0 ? 1 : -1;
            note(label + " was " + show(v) + ", snapped to " + s + " (it only means 1 or -1)");
            return s;
        }
        return v;
    }

    // Put a min/max pair back in order. Solvers generally give no useful complaint
    // when a range is inside out; they just behave strangely.
    function range(label, lo, hi){
        lo = num(label + " lower", lo, null, null, 0);
        hi = num(label + " upper", hi, null, null, 0);
        if (lo > hi){
            note(label + " had its minimum above its maximum, so the two were swapped");
            var t = lo; lo = hi; hi = t;
        }
        return { lo: lo, hi: hi };
    }

    function report(){
        if (!notes.length) return false;
        var where = script && script.getSceneObject ? " '" + script.getSceneObject().name + "'" : "";
        print(componentName + ":" + where + " — " + notes.join("; ") + ".");
        notes = [];
        return true;
    }

    return { num: num, int: int, sign: sign, range: range, report: report };
}

module.exports = { make: make, loggingOn: loggingOn };
