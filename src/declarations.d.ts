// This file tells TypeScript how to handle imports for .scss files.
// It declares that any import ending in .scss will be a module
// that exports a `CSSResult` object from Lit. This allows the
// `rollup-plugin-lit-css` to process the file and provide it to
// the component as a valid style object.
declare module '*.scss' {
  import { CSSResultGroup } from 'lit';
  const css: CSSResultGroup;
  export default css;
}

declare module '*.css' {
  import { CSSResultGroup } from 'lit';
  const css: CSSResultGroup;
  export default css;
}
