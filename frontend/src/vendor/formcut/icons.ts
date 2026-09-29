import { LUCIDE } from "./icons-lucide";

const wrap = (inner: string, vb = "0 0 16 16") =>
  `<svg viewBox="${vb}" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const icons: Record<string, string> = {
  // The supplied formcut mark, used for the titlebar home button and the
  // start screen. Drawn with currentColor so it takes the accent.
  logo: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19.741 1.01L4.249 1.01C2.454 1.01 1 2.463 1 4.259L1 19.741C1 21.537 2.454 23 4.259 23L19.741 23C21.537 23 23 21.546 23 19.741L23 4.259C23 2.463 21.546 1 19.741 1ZM2.824 4.639C2.824 3.654 3.468 2.863 4.259 2.863L14.493 2.863C15.283 2.863 15.927 3.654 15.927 4.639L15.927 6.405C15.927 7.38 15.283 8.171 14.493 8.171L4.249 8.171C3.459 8.171 2.815 7.38 2.815 6.405L2.815 4.639ZM6.005 19.576C6.005 20.473 5.38 21.185 4.61 21.185L4.18 21.185C3.42 21.185 2.785 20.463 2.785 19.576L2.785 17.585C2.785 16.688 3.41 15.976 4.18 15.976L4.61 15.976C5.371 15.976 6.005 16.698 6.005 17.585L6.005 19.576ZM10.083 12.941C10.083 13.898 9.449 14.678 8.649 14.678L4.259 14.678C3.468 14.678 2.824 13.907 2.824 12.941L2.824 11.195C2.824 10.239 3.459 9.459 4.259 9.459L8.649 9.459C9.439 9.459 10.083 10.229 10.083 11.195L10.083 12.941ZM10.805 13.049L10.805 11.059C10.805 10.161 11.429 9.449 12.2 9.449L13.117 9.449C13.878 9.449 14.512 10.171 14.512 11.059L14.512 13.049C14.512 13.946 13.888 14.659 13.117 14.659L12.2 14.659C11.439 14.659 10.805 13.937 10.805 13.049ZM21.127 19.4C21.127 20.385 20.502 21.185 19.712 21.185L14.024 21.185C13.254 21.185 12.61 20.385 12.61 19.4L12.61 17.761C12.61 16.776 13.234 15.976 14.024 15.976L19.712 15.976C20.483 15.976 21.127 16.776 21.127 17.761L21.127 19.4ZM21.166 6.541C21.166 7.449 20.541 8.171 19.751 8.171L18.054 8.171C17.283 8.171 16.639 7.449 16.639 6.541L16.639 4.532C16.639 3.624 17.263 2.902 18.054 2.902L19.751 2.902C20.522 2.902 21.166 3.624 21.166 4.532L21.166 6.541Z"/></svg>`,
  play: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z"/></svg>`,
  pause: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="3" width="3" height="10" rx="1"/><rect x="9.5" y="3" width="3" height="10" rx="1"/></svg>`,
  stepBack: wrap('<path d="M10.5 3.5 6 8l4.5 4.5"/><path d="M5 3.5v9"/>'),
  stepFwd: wrap('<path d="M5.5 3.5 10 8l-4.5 4.5"/><path d="M11 3.5v9"/>'),
  toStart: wrap('<path d="M11 3.5 6.5 8 11 12.5"/><path d="M4.5 3.5v9"/>'),
  toEnd: wrap('<path d="M5 3.5 9.5 8 5 12.5"/><path d="M11.5 3.5v9"/>'),
  export: wrap('<path d="M8 10V2.8M5.2 5.4 8 2.6l2.8 2.8"/><path d="M3 9.5v3A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-3"/>'),
  search: wrap('<circle cx="7" cy="7" r="4.2"/><path d="m13.5 13.5-3.4-3.4"/>'),
  chevD: wrap('<path d="m4 6.2 4 4 4-4"/>'),
  chevL: wrap('<path d="M9.8 4 6 8l3.8 4"/>'),
  chevR: wrap('<path d="M6.2 4 10 8l-3.8 4"/>'),
  diamond: wrap('<rect x="4.9" y="4.9" width="6.2" height="6.2" rx="1" transform="rotate(45 8 8)"/>'),
  phone: wrap('<rect x="4.6" y="1.8" width="6.8" height="12.4" rx="1.6"/><path d="M7 12.2h2"/>'),
  pointer: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3.5 2.2 12.8 8l-4 .9-1.6 4.4z"/></svg>`,
  blade: wrap('<path d="M3 12.5 12.6 2.9"/><circle cx="4.6" cy="10.9" r="1.7"/><circle cx="8.2" cy="12.6" r="1.7"/><path d="m8.6 7 4 5.6"/>'),
  split: wrap('<rect x="2" y="4" width="4.6" height="8" rx="1"/><rect x="9.4" y="4" width="4.6" height="8" rx="1"/><path d="M8 2.5v11"/>'),
  hook: wrap('<path d="M8 2.5v6a3 3 0 1 0 6 0V7"/>'),
  trash: wrap('<path d="M3 4.5h10M6.4 4.5V3h3.2v1.5M4.4 4.5l.6 8.5h6l.6-8.5"/>'),
  magnet: wrap('<path d="M5 2.5v6a3 3 0 0 0 6 0v-6"/><path d="M5 2.5h2.4v3H5zM8.6 2.5H11v3H8.6z" fill="currentColor" stroke="none"/><path d="M8 11.5v2"/>'),
  captions: wrap('<rect x="2" y="3.5" width="12" height="9" rx="1.6"/><path d="M4.5 8h4M4.5 10.2h7"/>'),
  speak: wrap('<path d="M3 6.5v3h2.4L9 12.5v-9L5.4 6.5z"/><path d="M11 6a3 3 0 0 1 0 4"/>'),
  detach: wrap('<path d="M2.5 8h2m2 0h1.6m2 0H12m2 0h-.4"/><path d="M4.5 5.4v5.2M8 3.6v8.8M11.5 5.8v4.4"/>'),
  plus: wrap('<path d="M8 3.5v9M3.5 8h9"/>'),
  minus: wrap('<path d="M3.5 8h9"/>'),
  fullscreen: wrap('<path d="M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10"/>'),
  layout: wrap('<rect x="2" y="2.5" width="12" height="11" rx="1.6"/><path d="M2 7h12M7.5 7v6.5"/>'),
  sliders: wrap('<path d="M3 5h10M3 11h10"/><circle cx="6" cy="5" r="1.6" fill="var(--pane)"/><circle cx="10" cy="11" r="1.6" fill="var(--pane)"/>'),
  pip: wrap('<rect x="2" y="3" width="12" height="10" rx="1.6"/><rect x="8" y="7.5" width="4.5" height="3.5" rx="0.8" fill="currentColor" stroke="none"/>'),
  menuLines: wrap('<path d="M3.5 5h9M3.5 8h9M3.5 11h9"/>'),
  lock: wrap('<rect x="4" y="7" width="8" height="6.5" rx="1.4"/><path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.8 0V7"/>'),
  eye: wrap('<path d="M1.8 8s2.4-4 6.2-4 6.2 4 6.2 4-2.4 4-6.2 4S1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.8"/>'),
  speaker: wrap('<path d="M2.8 6.4v3.2h2.1L8 12.2V3.8L4.9 6.4z"/><path d="M10 6.2a2.6 2.6 0 0 1 0 3.6M11.8 4.6a5 5 0 0 1 0 6.8"/>'),
  grid: wrap('<rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1"/><rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1"/><rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1"/><rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1"/>'),
  reset: `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.6 8.5a4.5 4.5 0 1 0 1.2-3.6"/><path d="M3.2 2.6v2.9h2.9"/></svg>`,
  help: wrap('<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2A1.8 1.8 0 1 1 8 9v1"/><circle cx="8" cy="11.6" r="0.5" fill="currentColor" stroke="none"/>'),
  text: wrap('<path d="M3.5 4.5V3h9v1.5M8 3v10M6.3 13h3.4"/>'),
  terminal: wrap('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M4.8 6.3 7 8.2l-2.2 1.9M8.2 10.4h3"/>'),
  tone: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/></svg>`,
  close: wrap('<path d="M4 4l8 8M12 4l-8 8"/>'),
};

export function icon(name: string): string {
  const body = LUCIDE[name];
  if (body) return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${body}</svg>`;
  return icons[name] ?? "";
}
