import React from 'react';
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno';
import { createStore } from 'polotno/model/store';
import { SidePanel, DEFAULT_SECTIONS } from 'polotno/side-panel';
import { Workspace } from 'polotno/canvas/workspace';
import { Toolbar } from 'polotno/toolbar/toolbar';
import { ZoomButtons } from 'polotno/toolbar/zoom-buttons';
import { Button } from 'polotno/primitives';

import { AiSection } from './AiPanel.jsx';
import { saveDesign } from './api.js';

// A Polotno key is meant to be visible in the browser, so it is not a secret.
// Without VITE_POLOTNO_KEY this falls back to Polotno's public demo key.
const store = createStore({
  key: import.meta.env.VITE_POLOTNO_KEY || 'nFA5H9elEytDyPyvKL7T',
  showCredit: true,
});

// A starting design that exercises the render Lambda: one Google Font, and one
// font that exists only on a desktop. Lambda has no system fonts, so the second
// line is where font bundling either works or does not.
const page = store.addPage();
page.addElement({
  type: 'text',
  text: 'Bedrock + Polotno',
  x: 60,
  y: 80,
  width: 500,
  fontSize: 64,
  fontFamily: 'Roboto',
  fontWeight: 'bold',
});
page.addElement({
  type: 'text',
  text: 'This line uses Arial, which Lambda does not have.',
  x: 60,
  y: 170,
  width: 500,
  fontSize: 24,
  fontFamily: 'Arial',
});

const sections = [AiSection, ...DEFAULT_SECTIONS];

export default function App() {
  const [status, setStatus] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  const onSave = async () => {
    setStatus(null);
    setSaving(true);
    try {
      const key = await saveDesign(JSON.stringify(store.toJSON()));
      setStatus({ ok: true, text: `Saved. Render it: npm run render -- ${key}` });
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <strong>Polotno + Amazon Bedrock</strong>
        <Button size="sm" variant="secondary" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save design'}
        </Button>
        {status && (
          <span className={status.ok ? 'muted' : 'error'}>{status.text}</span>
        )}
      </div>

      <PolotnoContainer style={{ width: '100vw', height: 'calc(100vh - 45px)' }}>
        <SidePanelWrap>
          <SidePanel store={store} sections={sections} defaultSection="ai" />
        </SidePanelWrap>
        <WorkspaceWrap>
          <Toolbar store={store} />
          <Workspace store={store} />
          <ZoomButtons store={store} />
        </WorkspaceWrap>
      </PolotnoContainer>
    </>
  );
}
