/// <reference types="react-scripts" />

// Plain (non-module) CSS side-effect imports, e.g. `import './LedgerView.css';`.
// `react-scripts` only ships declarations for `*.module.css`, so we add our own
// here to allow importing stylesheets purely for their side effects.
declare module '*.css';
