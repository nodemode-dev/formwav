// SPDX-License-Identifier: Apache-2.0 · the agent, chat and terminal icons of formlit v0.45.3 (frontend/src/ui/icons-lit.ts and icons.ts), byte for byte; see NOTICE

const S = (body: string, w = 1.75): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const AGENT_ICONS = {
  agent: S('<rect x="4" y="7.5" width="16" height="12" rx="4"/><path d="M12 7.5V4.5"/><circle cx="12" cy="3.6" r="1.1"/><circle cx="9.3" cy="13.3" r="1.35" fill="currentColor" stroke="none"/><circle cx="14.7" cy="13.3" r="1.35" fill="currentColor" stroke="none"/><path d="M2 12.2v2.8M22 12.2v2.8"/>'),
  agentChat: S('<path d="M6 4.5h12a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-3.5 3.5h-6.5L7 21v-3.5H6A3.5 3.5 0 0 1 2.5 14V8A3.5 3.5 0 0 1 6 4.5z"/><circle cx="9.2" cy="11" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.8" cy="11" r="1.3" fill="currentColor" stroke="none"/>'),
  terminal: S('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>'),
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
} as const;

export type AgentIconName = keyof typeof AGENT_ICONS;

export function agentIcon(name: AgentIconName, size: number): string {
  return `<span class="icon" aria-hidden="true" style="inline-size:${size}px;block-size:${size}px">${AGENT_ICONS[name]}</span>`;
}
