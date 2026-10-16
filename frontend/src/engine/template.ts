import type { SessionDoc, Track } from "./document";

/** PLAN_v13 S13: a session as a template: its tracks, buses, VCAs, groups, routing, sends, effects, automation, tempo
 *  and meter, markers and regions kept; its clips, other playlists, launcher slots, media and loop left out, and a
 *  sampler that played one of its files taken off its track. Marked as a template, so opening one starts a new session
 *  rather than editing the template. */
export function templateOf(doc: SessionDoc): SessionDoc {
  const tracks: Track[] = doc.tracks.map((t) => {
    const { playlists: _p, playlist: _n, ...rest } = t;
    const keep: Track = { ...rest, clips: [] };
    if (keep.instrument?.kind === "sampler") delete keep.instrument;
    return keep;
  });
  const { loop: _l, launcher: _q, ...rest } = doc;
  return { ...rest, media: {}, tracks, template: true };
}
