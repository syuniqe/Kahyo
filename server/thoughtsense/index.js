// ThoughtSense Engine: Kāhyo's shared maths layer.
// It turns thoughts and words into vectors and calculates signals from them.
// It never decides what a signal means: each NSMM (server/models/) does that.
// Server only: runs inside the Cloudflare Worker (and Node for tests), never in the browser.
// See README.md in this folder.

export * from './vectors.js';
export * from './words.js';
export * from './signals.js';
export * from './thread.js';
export * from './local.js';
export * from './sounds.js';
export * from './facts.js';
export * from './links.js';
