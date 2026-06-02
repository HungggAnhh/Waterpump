import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />

        {/*
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native.
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {/* Using raw CSS styles as an escape-hatch to ensure the background color never flickers in dark-mode. */}
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        {/* Add any additional <head> elements that you want globally available on web... */}
        <link rel="manifest" href="/manifest.json" />
        <script dangerouslySetInnerHTML={{ __html: blockZoomScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const blockZoomScript = `
  // Block pinch zoom (multi-touch gesture)
  document.addEventListener('touchstart', function (event) {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });

  // Block double-tap to zoom (fallback, touch-action: manipulation handles this)
  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, false);

  // Block Ctrl + mouse wheel zoom
  document.addEventListener('wheel', function (event) {
    if (event.ctrlKey) {
      event.preventDefault();
    }
  }, { passive: false });

  // Block Ctrl/Cmd + key zoom (+, -, 0)
  document.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && (
      event.key === '=' || 
      event.key === '-' || 
      event.key === '+' || 
      event.key === '0'
    )) {
      event.preventDefault();
    }
  });
`;

const responsiveBackground = `
html, body {
  background-color: #fff;
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: pan-x pan-y;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  -webkit-user-select: none;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #000;
  }
}`;
