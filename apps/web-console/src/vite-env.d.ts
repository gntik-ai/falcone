/// <reference types="vite/client" />

// Vite virtual `?worker` imports for the lazily-loaded Monaco surface. `vite/client` already
// declares the `*?worker` module shape; these explicit declarations cover the deep Monaco /
// monaco-yaml worker entry points so the app tsconfig (which does not pull in vite/client
// globally) resolves them.
declare module '*?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}

declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}

declare module 'monaco-yaml/yaml.worker?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}
