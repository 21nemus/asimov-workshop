// Inline line icons, drawn for this project (24 px grid, 1.6 stroke, currentColor).
const wrap = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  build: wrap('<path d="M14.5 6.5l3-3 3 3-3 3"/><path d="M17.5 3.5v0"/><path d="M15.8 8.2L6 18a2 2 0 1 1-2.8-2.8l9.8-9.8"/><path d="M4 21h7"/>'),
  understand: wrap('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/><path d="M10.5 7.5v6M7.5 10.5h6"/>'),
  test: wrap('<path d="M4 20h16"/><path d="M7 20V9l5-5 5 5v11"/><path d="M10 14h4"/><path d="M12 12v4"/>'),
  watch: wrap('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/>'),
  sources: wrap('<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/><path d="M8 12h8M8 15.5h8M8 8.5h4"/>'),
  close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  undo: wrap('<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0 -6)"/>'),
  replay: wrap('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>'),
  play: wrap('<path d="M7 5v14l11-7z" fill="currentColor"/>'),
  pause: wrap('<path d="M8 5v14M16 5v14" stroke-width="2.6"/>'),
  stop: wrap('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>'),
  reset: wrap('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/>'),
  freeze: wrap('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>'),
  push: wrap('<path d="M3 12h11"/><path d="M10 7l5 5-5 5"/><path d="M19 5v14"/>'),
  camera: wrap('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  next: wrap('<path d="M9 5l7 7-7 7"/>'),
  prev: wrap('<path d="M15 5l-7 7 7 7"/>'),
  skip: wrap('<path d="M5 5l7 7-7 7M13 5l7 7-7 7"/>'),
  info: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  link: wrap('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  layers: wrap('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  scissors: wrap('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/>'),
  explode: wrap('<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3"/>'),
  axis: wrap('<path d="M4 20L20 4"/><path d="M15 4h5v5"/><circle cx="8" cy="16" r="2"/>'),
  ankle: wrap('<path d="M8 3v10l-4 5h14l2-3"/><path d="M12 3v8"/><circle cx="12" cy="13" r="1.5"/>'),
  heart: wrap('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  menu: wrap('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  check: wrap('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  lock: wrap('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  // The X (Twitter) mark, filled, as on the Vibe A1 page.
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.2-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/></svg>',
  share: wrap('<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>'),
  hardware: wrap('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  sim: wrap('<circle cx="12" cy="6" r="2.2"/><path d="M12 8.2v5.3"/><circle cx="12" cy="15.5" r="2"/><path d="M12 17.5V21M9 21h6"/><path d="M5 11h3M16 11h3"/>'),
} as const;

export type IconName = keyof typeof ICONS;
