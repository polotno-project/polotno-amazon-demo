import React from 'react';
import { Button } from 'polotno/primitives';

import { renderDesign, saveDesign } from './api.js';

// Replaces the toolbar's default action area. Polotno recommends keeping this
// small, because the toolbar itself needs the width.
//
// One button covers both backend features: it uploads the design JSON to S3,
// then renders it in the batch Lambda and links to the PNG. The same Lambda is
// what `npm run render` triggers from the command line.
export default function ActionControls({ store }) {
  const [state, setState] = React.useState('idle');
  const [url, setUrl] = React.useState('');
  const [error, setError] = React.useState('');

  const onRender = async () => {
    setError('');
    setUrl('');
    try {
      setState('saving');
      const key = await saveDesign(JSON.stringify(store.toJSON()));
      setState('rendering');
      setUrl(await renderDesign(key));
    } catch (e) {
      setError(e.message);
    } finally {
      setState('idle');
    }
  };

  const label = { saving: 'Saving…', rendering: 'Rendering…' }[state] ?? 'Save & render';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          Open PNG
        </a>
      )}
      {error && <span className="error">{error}</span>}
      <Button size="sm" disabled={state !== 'idle'} onClick={onRender}>
        {label}
      </Button>
    </div>
  );
}
