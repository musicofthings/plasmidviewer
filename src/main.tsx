import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// @ts-expect-error - @fontsource packages ship no type declarations (noUncheckedSideEffectImports)
import '@fontsource/inter';
// @ts-expect-error - @fontsource packages ship no type declarations (noUncheckedSideEffectImports)
import '@fontsource/roboto-mono';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
