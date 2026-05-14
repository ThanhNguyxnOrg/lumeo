// Lumeo token guard — reusable stale-callback guard for async pipelines.
// Echoly's pattern: every async callback captures a token in closure and
// checks `guard.isStale(token)` before mutating session state. Bumping the
// token (new session, tier switch, handover) makes pending callbacks no-ops
// without any explicit cancellation wiring.
//
// Use from pipelines/standard.js, pipelines/realtime.js, and (once migrated)
// pipelines/caption.js so every tier handles mid-flight language/voice
// changes consistently.

(() => {
  "use strict";

  if (window.LumeoTokenGuard?.__loaded) return;

  class PageToken {
    constructor() {
      this.value = 0;
    }

    // Start a new session. Returns the token the caller should capture.
    bump() {
      this.value += 1;
      return this.value;
    }

    current() {
      return this.value;
    }

    isStale(captured) {
      return captured !== this.value;
    }

    // Sugar: throw an AbortError-shaped exception so `await` chains can
    // propagate stale state through their natural error path.
    assertFresh(captured, message = "Stale session.") {
      if (this.isStale(captured)) {
        const err = new Error(message);
        err.name = "StaleSessionError";
        throw err;
      }
    }
  }

  window.LumeoTokenGuard = {
    __loaded: true,
    PageToken,
    create: () => new PageToken(),
  };
})();
