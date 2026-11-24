import {mountWorkspace,unmountWorkspace} from './app.js';

// A same-origin external module keeps the bridge compatible with a restrictive
// script policy. No credentials, records or HTML are embedded in this bridge.
window.__NAM_WORKSPACE__=Object.freeze({mount:mountWorkspace,unmount:unmountWorkspace});
