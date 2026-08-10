import React from 'react';
import { createRoot } from 'react-dom/client';
import { Amplify } from 'aws-amplify';

// Polotno 4 ships its own design system. This one stylesheet covers the editor
// and everything imported from polotno/primitives.
import 'polotno/ui.css';
import './index.css';

// Written by `npm run sandbox` or by the Amplify Hosting build. It is
// gitignored, so a fresh clone must run the sandbox once before `npm run dev`.
import outputs from '../amplify_outputs.json';

import App from './App.jsx';

Amplify.configure(outputs);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
