import React from 'react';
import { observer } from 'mobx-react-lite';
import { SectionTab } from 'polotno/side-panel';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Textarea,
} from 'polotno/primitives';

import { generateImage, removeBackground } from './api.js';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:5'];

function addToPage(store, { url, width, height }) {
  const scale = Math.min(store.width / width, store.height / height, 1);
  store.activePage.addElement({
    type: 'image',
    src: url,
    width: width * scale,
    height: height * scale,
    x: (store.width - width * scale) / 2,
    y: (store.height - height * scale) / 2,
  });
}

const AiPanel = observer(({ store }) => {
  const [prompt, setPrompt] = React.useState(
    'a red vintage bicycle against a plain white wall, product photo',
  );
  const [aspectRatio, setAspectRatio] = React.useState('1:1');
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');

  const run = async (name, action) => {
    setError('');
    setBusy(name);
    try {
      await action();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const selected = store.selectedElements[0];
  const canRemoveBackground = selected?.type === 'image' && Boolean(selected.src);

  return (
    <div className="ai-panel">
      <Textarea
        rows={4}
        value={prompt}
        placeholder="Describe the image you want"
        onChange={(e) => setPrompt(e.target.value)}
      />

      <Select value={aspectRatio} onValueChange={(v) => v && setAspectRatio(v)}>
        <SelectTrigger style={{ width: '100%' }}>
          <SelectValue>{aspectRatio}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ASPECT_RATIOS.map((ratio) => (
            <SelectItem key={ratio} value={ratio}>
              {ratio}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        disabled={Boolean(busy) || !prompt.trim()}
        onClick={() =>
          run('generate', async () =>
            addToPage(store, await generateImage(prompt, aspectRatio)),
          )
        }
      >
        {busy === 'generate' ? 'Generating…' : 'Generate image'}
      </Button>

      <p className="muted">
        Amazon Bedrock, Stability Stable Image Core. The image is written to S3
        and only its URL comes back to the browser.
      </p>

      <Separator />

      <Button
        variant="secondary"
        disabled={Boolean(busy) || !canRemoveBackground}
        onClick={() =>
          run('remove', async () => {
            const element = store.selectedElements[0];
            const image = await removeBackground(element.src);
            // Replacing src keeps position, size and every other attribute.
            element.set({ src: image.url });
          })
        }
      >
        {busy === 'remove' ? 'Removing…' : 'Remove background'}
      </Button>

      <p className="muted">
        {canRemoveBackground
          ? 'Replaces the selected image with a transparent PNG.'
          : 'Select an image on the canvas to enable this.'}
      </p>

      {error && <p className="error">{error}</p>}
    </div>
  );
});

const SparkleIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
    <path d="M18.5 14.5l1 2.6 2.5 1-2.5 1-1 2.6-1-2.6-2.5-1 2.5-1z" />
  </svg>
);

// A side panel section is a plain object: a tab button and a panel body.
export const AiSection = {
  name: 'ai',
  Tab: (props) => (
    <SectionTab name="AI" {...props}>
      <SparkleIcon />
    </SectionTab>
  ),
  Panel: AiPanel,
};
