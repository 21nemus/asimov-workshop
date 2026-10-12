import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/main.css';
import './styles/ui.css';
import { startApp } from './app/app.ts';

startApp().catch((err: unknown) => {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) {
    boot.classList.add('boot--error');
    const state = boot.querySelector('.boot__state');
    if (state) state.textContent = `The workshop could not open: ${err instanceof Error ? err.message : String(err)}`;
  }
});
