use std::collections::HashMap;

use crate::wav::AudioBuffer;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlayClip {
    pub source: u32,
    pub start: u64,
    pub source_in: u64,
    pub length: u64,
    pub gain: f32,
    pub pan: f32,
    pub fade_in: u64,
    pub fade_out: u64,
    pub fade_shape: u8,
    pub bus: u32,
    /// 1-based track number for per-track metering; 0 means the clip is not metered.
    pub track: u32,
    /// 1-based index of a volume envelope (linear gain applied on top of `gain`); 0 for none.
    pub gain_env: u32,
    /// 1-based index of a pan envelope (replacing `pan`); 0 for none.
    pub pan_env: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bus {
    pub id: u32,
    pub gain: f32,
    pub pan: f32,
}

pub const FADE_LINEAR: u8 = 0;
pub const FADE_EQUAL_POWER: u8 = 1;
pub const FADE_S_CURVE: u8 = 2;
pub const FADE_EXPONENTIAL: u8 = 3;

/// Gain of a fade at position `x` (0 at the silent end, 1 at full level).
/// Shape codes: 0 linear, 1 equal-power (sine), 2 S-curve (raised cosine), 3 exponential (square); unknown codes are linear.
pub fn fade_curve(x: f32, shape: u8) -> f32 {
    let x = x.clamp(0.0, 1.0);
    match shape {
        FADE_EQUAL_POWER => (x * std::f32::consts::FRAC_PI_2).sin(),
        FADE_S_CURVE => 0.5 - 0.5 * (x * std::f32::consts::PI).cos(),
        FADE_EXPONENTIAL => x * x,
        _ => x,
    }
}

/// Automation: points (time in samples, value) in time order, linearly interpolated, the first and last
/// values held before and after them. Volume envelopes hold linear gain (converted from dB once, on load).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Envelope {
    points: Vec<(u64, f32)>,
}

impl Envelope {
    pub fn value_at(&self, t: u64) -> f32 {
        let p = &self.points;
        let Some(&(_, last)) = p.last() else { return 1.0 };
        let i = p.partition_point(|&(time, _)| time <= t);
        if i == 0 {
            return p[0].1;
        }
        if i == p.len() {
            return last;
        }
        let (t0, v0) = p[i - 1];
        let (t1, v1) = p[i];
        if t1 == t0 {
            return v1;
        }
        let x = (t - t0) as f64 / (t1 - t0) as f64;
        (f64::from(v0) + (f64::from(v1) - f64::from(v0)) * x) as f32
    }
}

pub fn pan_gains(pan: f32) -> (f32, f32) {
    let p = pan.clamp(-1.0, 1.0);
    let far = |amount: f32| if amount >= 1.0 { 0.0 } else { (amount * std::f32::consts::FRAC_PI_2).cos() };
    let left = if p > 0.0 { far(p) } else { 1.0 };
    let right = if p < 0.0 { far(-p) } else { 1.0 };
    (left, right)
}

#[derive(Debug, Default)]
pub struct Player {
    sources: HashMap<u32, AudioBuffer>,
    clips: Vec<PlayClip>,
    order: Vec<usize>,
    order_dirty: bool,
    position: u64,
    peak_left: f32,
    peak_right: f32,
    /// The master's sums of left times right, left squared and right squared since the last take_correlation
    /// (AA-02's running phase meter).
    corr: (f64, f64, f64),
    loop_range: Option<(u64, u64)>,
    buses: Vec<Bus>,
    scratch_left: Vec<f32>,
    scratch_right: Vec<f32>,
    track_peaks: Vec<(f32, f32)>,
    meter_left: Vec<f32>,
    meter_right: Vec<f32>,
    loudness: Option<crate::loudness::LiveLoudness>,
    envelopes: Vec<Envelope>,
    master_gain: Option<f32>,
    bus_peaks: Vec<(f32, f32)>,
    /// The session's sample rate, for designing filters (48 kHz when unset).
    rate: f32,
    /// Each clip's track effect chain, parallel to `clips`: one copy advanced by the audio mix, one by the meter
    /// pass, since `meter_tracks` mixes every clip again and a shared state would advance twice a block.
    clip_fx: Vec<Vec<crate::fx::Stage>>,
    meter_fx: Vec<Vec<crate::fx::Stage>>,
    /// Each clip stage's design (kind, frequency, gain dB, Q), parallel to `clip_fx`, for automation to redesign it.
    clip_fx_spec: Vec<Vec<(u8, f32, f32, f32)>>,
    /// Effect parameter automation (PT-19), per clip: (stage, envelope ids for frequency, gain and Q; 0 is none).
    clip_fx_auto: Vec<Vec<(usize, [u32; 3])>>,
    /// The master chain, run on the summed mix before the master gain, meters and loudness.
    master_fx: Vec<crate::fx::Stage>,
    /// Each bus's chain, parallel to `buses`, run on the bus's sum before its gain and pan: a track holding a
    /// nonlinear stage (a compressor) plays through a bus of its own so its whole chain sees the track's sum.
    bus_fx: Vec<Vec<crate::fx::Stage>>,
}

impl Player {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load_source(&mut self, id: u32, buf: AudioBuffer) {
        self.sources.insert(id, buf);
    }

    /// A source of `frames` silent frames, filled later by `write_source` while it can already play.
    pub fn alloc_source(&mut self, id: u32, sample_rate: u32, channels: usize, frames: usize) {
        self.sources.insert(id, AudioBuffer { sample_rate, channels: vec![vec![0.0; frames]; channels.max(1)] });
    }

    /// Interleaved frames written into a source from `offset`, clipped to its length; returns the frames written.
    pub fn write_source(&mut self, id: u32, offset: usize, interleaved: &[f32]) -> usize {
        let Some(buf) = self.sources.get_mut(&id) else { return 0 };
        let channels = buf.channels.len();
        let frames = buf.frames();
        if channels == 0 || offset >= frames {
            return 0;
        }
        let n = (interleaved.len() / channels).min(frames - offset);
        for (c, channel) in buf.channels.iter_mut().enumerate() {
            for i in 0..n {
                channel[offset + i] = interleaved[i * channels + c];
            }
        }
        n
    }

    pub fn clear_clips(&mut self) {
        self.clips.clear();
        self.clip_fx.clear();
        self.meter_fx.clear();
        self.clip_fx_spec.clear();
        self.clip_fx_auto.clear();
        self.order_dirty = true;
    }

    pub fn add_clip(&mut self, clip: PlayClip) {
        self.clips.push(clip);
        self.clip_fx.push(Vec::new());
        self.meter_fx.push(Vec::new());
        self.clip_fx_spec.push(Vec::new());
        self.clip_fx_auto.push(Vec::new());
        self.order_dirty = true;
    }

    /// Automates one parameter (0 frequency, 1 gain dB, 2 Q) of stage `stage` of the most recently added clip with
    /// envelope `envelope` (add_envelope's id, natural units); false with no such clip, stage, parameter or envelope.
    pub fn add_clip_fx_auto(&mut self, stage: usize, param: u8, envelope: u32) -> bool {
        let (Some(specs), Some(autos)) = (self.clip_fx_spec.last(), self.clip_fx_auto.last_mut()) else {
            return false;
        };
        if stage >= specs.len() || param > 2 || envelope == 0 || envelope as usize > self.envelopes.len() {
            return false;
        }
        match autos.iter_mut().find(|(s, _)| *s == stage) {
            Some((_, envs)) => envs[param as usize] = envelope,
            None => {
                let mut envs = [0u32; 3];
                envs[param as usize] = envelope;
                autos.push((stage, envs));
            }
        }
        true
    }

    fn ensure_order(&mut self) {
        if !self.order_dirty {
            return;
        }
        self.order.clear();
        self.order.extend(0..self.clips.len());
        let clips = &self.clips;
        self.order.sort_by_key(|&i| (clips[i].track, clips[i].start));
        self.order_dirty = false;
    }

    pub fn set_rate(&mut self, rate: f32) {
        self.rate = rate;
    }

    /// Appends a filter stage to the most recently added clip's chain; false when there is no clip or the filter is
    /// refused (an unknown kind).
    pub fn add_clip_fx(&mut self, kind: u8, freq: f32, gain_db: f32, q: f32) -> bool {
        let rate = if self.rate > 0.0 { self.rate } else { 48000.0 };
        let (Some(chain), Some(meter), Some(f)) = (self.clip_fx.last_mut(), self.meter_fx.last_mut(), crate::fx::Biquad::design(kind, freq, gain_db, q, rate)) else {
            return false;
        };
        chain.push(crate::fx::Stage::Filter(f));
        meter.push(crate::fx::Stage::Filter(f));
        if let Some(specs) = self.clip_fx_spec.last_mut() {
            specs.push((kind, freq, gain_db, q));
        }
        true
    }

    /// PT-33: appends a compressor stage to the most recently added clip's chain (a clip's own dynamics, ahead of its
    /// track's inserts); false when there is no clip or the design is refused. Its spec slot holds kind 6 so automation's
    /// stage numbers stay parallel to the chain (automation redesigns only filters).
    pub fn add_clip_comp(&mut self, threshold_db: f32, ratio: f32, attack_ms: f32, release_ms: f32, makeup_db: f32) -> bool {
        let rate = if self.rate > 0.0 { self.rate } else { 48000.0 };
        let (Some(chain), Some(meter), Some(c)) = (self.clip_fx.last_mut(), self.meter_fx.last_mut(), crate::fx::Compressor::design(threshold_db, ratio, attack_ms, release_ms, makeup_db, rate)) else {
            return false;
        };
        chain.push(crate::fx::Stage::Comp(c));
        meter.push(crate::fx::Stage::Comp(c));
        if let Some(specs) = self.clip_fx_spec.last_mut() {
            specs.push((crate::fx::COMPRESSOR, threshold_db, ratio, attack_ms));
        }
        true
    }

    pub fn clear_master_fx(&mut self) {
        self.master_fx.clear();
    }

    /// Appends a filter stage to the master chain; false when the filter is refused (an unknown kind).
    pub fn add_master_fx(&mut self, kind: u8, freq: f32, gain_db: f32, q: f32) -> bool {
        self.add_master_stage(kind, freq, gain_db, q, 0.0, 0.0)
    }

    /// Appends a stage of any kind (fx.rs Stage::design) to the master chain.
    pub fn add_master_stage(&mut self, kind: u8, a: f32, b: f32, c: f32, d: f32, e: f32) -> bool {
        let rate = if self.rate > 0.0 { self.rate } else { 48000.0 };
        match crate::fx::Stage::design(kind, a, b, c, d, e, rate) {
            Some(s) => {
                self.master_fx.push(s);
                true
            }
            None => false,
        }
    }

    /// Appends a stage of any kind to the most recently added bus's chain; false with no bus or a refused stage.
    pub fn add_bus_stage(&mut self, kind: u8, a: f32, b: f32, c: f32, d: f32, e: f32) -> bool {
        let rate = if self.rate > 0.0 { self.rate } else { 48000.0 };
        let (Some(chain), Some(s)) = (self.bus_fx.last_mut(), crate::fx::Stage::design(kind, a, b, c, d, e, rate)) else {
            return false;
        };
        chain.push(s);
        true
    }

    fn reset_fx(&mut self) {
        for f in self.clip_fx.iter_mut().chain(self.meter_fx.iter_mut()).flatten() {
            f.reset();
        }
        for s in self.master_fx.iter_mut().chain(self.bus_fx.iter_mut().flatten()) {
            s.reset();
        }
    }

    pub fn clear_envelopes(&mut self) {
        self.envelopes.clear();
    }

    /// Master fader in dB, applied to the finished mix before the peak and loudness meters. 0 dB turns the
    /// stage off entirely, so a session at 0 dB renders exactly as it did without a master stage.
    pub fn set_master_db(&mut self, db: f64) {
        self.master_gain = if db == 0.0 { None } else { Some(10f64.powf(db / 20.0) as f32) };
    }

    /// Adds an envelope from (time, value) points and returns its 1-based index. With `db`, values are dB
    /// and are converted to linear gain here, once, so every caller gets the same gains.
    pub fn add_envelope(&mut self, points: &[(u64, f64)], db: bool) -> u32 {
        let mut points: Vec<(u64, f32)> = points
            .iter()
            .map(|&(t, v)| (t, if db { 10f64.powf(v / 20.0) as f32 } else { v as f32 }))
            .collect();
        points.sort_by_key(|&(t, _)| t);
        self.envelopes.push(Envelope { points });
        self.envelopes.len() as u32
    }

    fn envelope(&self, id: u32) -> Option<&Envelope> {
        if id == 0 {
            None
        } else {
            self.envelopes.get(id as usize - 1)
        }
    }

    pub fn seek(&mut self, position: u64) {
        self.position = position;
        self.reset_fx();
    }

    pub fn position(&self) -> u64 {
        self.position
    }

    pub fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        left[..n].fill(0.0);
        right[..n].fill(0.0);
        let mut done = 0;
        while done < n {
            let from = self.position;
            let mut span = (n - done) as u64;
            if let Some((_, end)) = self.loop_range {
                if from < end {
                    span = span.min(end - from);
                }
            }
            let len = span as usize;
            let mut fx = std::mem::take(&mut self.clip_fx);
            self.mix(&mut fx, &mut left[done..done + len], &mut right[done..done + len], from, |c| c.bus == 0);
            self.mix_buses(&mut fx, &mut left[done..done + len], &mut right[done..done + len], from);
            self.clip_fx = fx;
            if !self.master_fx.is_empty() {
                for i in done..done + len {
                    let (mut l, mut r) = (left[i], right[i]);
                    for s in self.master_fx.iter_mut() {
                        (l, r) = s.process(l, r);
                    }
                    left[i] = l;
                    right[i] = r;
                }
            }
            self.meter_tracks(from, len);
            done += len;
            self.position = from + span;
            if let Some((start, end)) = self.loop_range {
                if self.position == end {
                    self.position = start;
                    self.reset_fx();
                }
            }
        }
        if let Some(g) = self.master_gain {
            for i in 0..n {
                left[i] *= g;
                right[i] *= g;
            }
        }
        for i in 0..n {
            self.peak_left = self.peak_left.max(left[i].abs());
            self.peak_right = self.peak_right.max(right[i].abs());
            let (l, r) = (f64::from(left[i]), f64::from(right[i]));
            self.corr.0 += l * r;
            self.corr.1 += l * l;
            self.corr.2 += r * r;
        }
        if let Some(meter) = self.loudness.as_mut() {
            meter.process(&left[..n], &right[..n]);
        }
    }

    pub fn set_loop(&mut self, start: u64, end: u64) {
        self.loop_range = if end > start { Some((start, end)) } else { None };
    }

    pub fn clear_buses(&mut self) {
        self.buses.clear();
        self.bus_fx.clear();
    }

    pub fn add_bus(&mut self, bus: Bus) {
        self.buses.push(bus);
        self.bus_fx.push(Vec::new());
    }

    fn mix_buses(&mut self, fx: &mut [Vec<crate::fx::Stage>], left: &mut [f32], right: &mut [f32], from: u64) {
        if self.buses.is_empty() {
            return;
        }
        let n = left.len().min(right.len());
        let mut scratch_left = std::mem::take(&mut self.scratch_left);
        let mut scratch_right = std::mem::take(&mut self.scratch_right);
        if scratch_left.len() < n {
            scratch_left.resize(n, 0.0);
            scratch_right.resize(n, 0.0);
        }
        let mut bus_peaks = std::mem::take(&mut self.bus_peaks);
        if bus_peaks.len() != self.buses.len() {
            bus_peaks.resize(self.buses.len(), (0.0, 0.0));
        }
        let mut bus_fx = std::mem::take(&mut self.bus_fx);
        for (k, bus) in self.buses.iter().enumerate() {
            scratch_left[..n].fill(0.0);
            scratch_right[..n].fill(0.0);
            let id = bus.id;
            self.mix(fx, &mut scratch_left[..n], &mut scratch_right[..n], from, |c| c.bus == id);
            if let Some(chain) = bus_fx.get_mut(k).filter(|c| !c.is_empty()) {
                for i in 0..n {
                    let (mut l, mut r) = (scratch_left[i], scratch_right[i]);
                    for s in chain.iter_mut() {
                        (l, r) = s.process(l, r);
                    }
                    scratch_left[i] = l;
                    scratch_right[i] = r;
                }
            }
            let (pan_left, pan_right) = pan_gains(bus.pan);
            let gain_left = bus.gain * pan_left;
            let gain_right = bus.gain * pan_right;
            let peak = &mut bus_peaks[k];
            for i in 0..n {
                let l = scratch_left[i] * gain_left;
                let r = scratch_right[i] * gain_right;
                left[i] += l;
                right[i] += r;
                peak.0 = peak.0.max(l.abs());
                peak.1 = peak.1.max(r.abs());
            }
        }
        self.bus_fx = bus_fx;
        self.bus_peaks = bus_peaks;
        self.scratch_left = scratch_left;
        self.scratch_right = scratch_right;
    }

    fn mix(&self, fx: &mut [Vec<crate::fx::Stage>], left: &mut [f32], right: &mut [f32], from: u64, select: impl Fn(&PlayClip) -> bool) {
        let n = left.len().min(right.len());
        let to = from + n as u64;
        for (index, clip) in self.clips.iter().enumerate() {
            if !select(clip) {
                continue;
            }
            self.mix_one(fx, left, right, from, to, index);
        }
    }

    fn mix_one(&self, fx: &mut [Vec<crate::fx::Stage>], left: &mut [f32], right: &mut [f32], from: u64, to: u64, index: usize) {
        let clip = &self.clips[index];
        if clip.start >= to || clip.start + clip.length <= from {
            return;
        }
        {
            let Some(src) = self.sources.get(&clip.source) else { return };
            let Some(l) = src.channels.first() else { return };
            let r = src.channels.get(1).unwrap_or(l);
            let mut chain = fx.get_mut(index).filter(|c| !c.is_empty());
            let a = from.max(clip.start);
            let b = to.min(clip.start + clip.length);
            let (pan_left, pan_right) = pan_gains(clip.pan);
            let gain_left = clip.gain * pan_left;
            let gain_right = clip.gain * pan_right;
            let fade_in = clip.fade_in.min(clip.length);
            let fade_out = clip.fade_out.min(clip.length - fade_in);
            let autos = self.clip_fx_auto.get(index).map_or(&[][..], |v| &v[..]);
            let specs = self.clip_fx_spec.get(index).map_or(&[][..], |v| &v[..]);
            let rate = if self.rate > 0.0 { self.rate } else { 48000.0 };
            for t in a..b {
                let k = t - clip.start;
                let s = (clip.source_in + k) as usize;
                if s >= l.len() {
                    break;
                }
                let mut fade = 1.0f32;
                if k < fade_in {
                    fade *= fade_curve(k as f32 / fade_in as f32, clip.fade_shape);
                }
                if k >= clip.length - fade_out {
                    fade *= fade_curve((clip.length - k) as f32 / fade_out as f32, clip.fade_shape);
                }
                let i = (t - from) as usize;
                if !autos.is_empty() && (t - a) % 32 == 0 {
                    // effect parameter automation (PT-19): redesigned every 32 samples, the filter's state kept
                    if let Some(stages) = chain.as_deref_mut() {
                        for &(stage, envs) in autos {
                            let Some(&(kind, f0, g0, q0)) = specs.get(stage) else { continue };
                            let value = |id: u32, base: f32| self.envelope(id).map_or(base, |e| e.value_at(t));
                            if let (Some(crate::fx::Stage::Filter(f)), Some(next)) = (stages.get_mut(stage), crate::fx::Biquad::design(kind, value(envs[0], f0), value(envs[1], g0), value(envs[2], q0), rate)) {
                                f.retune(&next);
                            }
                        }
                    }
                }
                let (mut xl, mut xr) = (l[s], r[s]);
                if let Some(stages) = chain.as_deref_mut() {
                    for f in stages.iter_mut() {
                        (xl, xr) = f.process(xl, xr);
                    }
                }
                if clip.gain_env == 0 && clip.pan_env == 0 {
                    left[i] += xl * gain_left * fade;
                    right[i] += xr * gain_right * fade;
                } else {
                    let gain = clip.gain * self.envelope(clip.gain_env).map_or(1.0, |e| e.value_at(t));
                    let (pl, pr) = self.envelope(clip.pan_env).map_or((pan_left, pan_right), |e| pan_gains(e.value_at(t)));
                    left[i] += xl * (gain * pl) * fade;
                    right[i] += xr * (gain * pr) * fade;
                }
            }
        }
    }

    pub fn take_peaks(&mut self) -> (f32, f32) {
        let peaks = (self.peak_left, self.peak_right);
        self.peak_left = 0.0;
        self.peak_right = 0.0;
        peaks
    }

    /// The master's phase correlation since the last call (AA-02's running meter): the sum of left times right over
    /// the root of the product of their energies, +1 identical, 0 unrelated, -1 opposed; NaN with nothing playing.
    pub fn take_correlation(&mut self) -> f32 {
        let (lr, ll, rr) = std::mem::take(&mut self.corr);
        let d = (ll * rr).sqrt();
        if d > 1e-12 {
            (lr / d).clamp(-1.0, 1.0) as f32
        } else {
            f32::NAN
        }
    }

    /// Per-track peak metering. Each track's clips are summed into a meter scratch, so overlapping clips
    /// are measured together as the track plays them (post track gain and pan, before any bus). The pass
    /// never writes to the output, so the rendered audio is unchanged by metering.
    fn meter_tracks(&mut self, from: u64, n: usize) {
        let count = self.clips.iter().map(|c| c.track).max().unwrap_or(0) as usize;
        if count == 0 || n == 0 {
            return;
        }
        if self.track_peaks.len() <= count {
            self.track_peaks.resize(count + 1, (0.0, 0.0));
        }
        self.ensure_order();
        let to = from + n as u64;
        let mut meter_left = std::mem::take(&mut self.meter_left);
        let mut meter_right = std::mem::take(&mut self.meter_right);
        if meter_left.len() < n {
            meter_left.resize(n, 0.0);
            meter_right.resize(n, 0.0);
        }
        let mut meter_fx = std::mem::take(&mut self.meter_fx);
        let order = std::mem::take(&mut self.order);
        let mut i = 0;
        while i < order.len() {
            let track = self.clips[order[i]].track;
            let mut j = i;
            while j < order.len() && self.clips[order[j]].track == track {
                j += 1;
            }
            let run = &order[i..j];
            if run.iter().any(|&k| {
                let c = &self.clips[k];
                c.start < to && c.start + c.length > from
            }) {
                meter_left[..n].fill(0.0);
                meter_right[..n].fill(0.0);
                for &k in run {
                    self.mix_one(&mut meter_fx, &mut meter_left[..n], &mut meter_right[..n], from, to, k);
                }
                let peak = &mut self.track_peaks[track as usize];
                for s in 0..n {
                    peak.0 = peak.0.max(meter_left[s].abs());
                    peak.1 = peak.1.max(meter_right[s].abs());
                }
            }
            i = j;
        }
        self.order = order;
        self.meter_fx = meter_fx;
        self.meter_left = meter_left;
        self.meter_right = meter_right;
    }

    /// Writes (left, right) peaks for tracks 1..=count into `out` as pairs, resets them, and returns
    /// how many tracks were written (at most `out.len() / 2`).
    pub fn take_track_peaks(&mut self, out: &mut [f32]) -> usize {
        let count = self.track_peaks.len().saturating_sub(1).min(out.len() / 2);
        for t in 0..count {
            let peak = &mut self.track_peaks[t + 1];
            out[2 * t] = peak.0;
            out[2 * t + 1] = peak.1;
            *peak = (0.0, 0.0);
        }
        count
    }

    /// Writes (left, right) peaks for each bus, in the order the buses were added, into `out` as pairs,
    /// resets them, and returns how many buses were written (at most `out.len() / 2`).
    pub fn take_bus_peaks(&mut self, out: &mut [f32]) -> usize {
        let count = self.bus_peaks.len().min(out.len() / 2);
        for b in 0..count {
            out[2 * b] = self.bus_peaks[b].0;
            out[2 * b + 1] = self.bus_peaks[b].1;
            self.bus_peaks[b] = (0.0, 0.0);
        }
        count
    }

    /// Starts a fresh live loudness measurement of the master output at `rate`.
    pub fn reset_loudness(&mut self, rate: u32) {
        self.loudness = Some(crate::loudness::LiveLoudness::new(rate));
    }

    /// Momentary, short-term and integrated loudness of the master output since the last reset.
    pub fn loudness(&self) -> (Option<f64>, Option<f64>, Option<f64>) {
        match &self.loudness {
            Some(m) => (m.momentary(), m.short_term(), m.integrated()),
            None => (None, None, None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_streamed_source_plays_what_was_written_and_silence_elsewhere() {
        let mut p = Player::new();
        p.alloc_source(1, 48000, 2, 1000);
        // frames 100..300 written as left = 0.5, right = -0.25; a write past the end is clipped
        let chunk: Vec<f32> = (0..200).flat_map(|_| [0.5f32, -0.25]).collect();
        assert_eq!(p.write_source(1, 100, &chunk), 200);
        assert_eq!(p.write_source(1, 950, &chunk), 50);
        assert_eq!(p.write_source(1, 1000, &chunk), 0);
        assert_eq!(p.write_source(9, 0, &chunk), 0);
        let buf = &p.sources[&1];
        assert_eq!(buf.frames(), 1000);
        assert_eq!((buf.channels[0][99], buf.channels[0][100], buf.channels[0][299], buf.channels[0][300]), (0.0, 0.5, 0.5, 0.0));
        assert_eq!((buf.channels[1][100], buf.channels[1][999]), (-0.25, -0.25));
    }

    #[test]
    fn the_running_correlation_reads_identical_inverted_unrelated_and_silent_channels() {
        let render_pair = |left: Vec<f32>, right: Vec<f32>| {
            let mut p = Player::new();
            p.set_rate(48000.0);
            p.alloc_source(1, 48000, 2, left.len());
            let inter: Vec<f32> = left.iter().zip(&right).flat_map(|(&l, &r)| [l, r]).collect();
            p.write_source(1, 0, &inter);
            p.add_clip(PlayClip { source: 1, start: 0, source_in: 0, length: left.len() as u64, gain: 1.0, pan: 0.0, fade_in: 0, fade_out: 0, fade_shape: 0, bus: 0, track: 1, gain_env: 0, pan_env: 0 });
            let (mut l, mut r) = (vec![0f32; left.len()], vec![0f32; left.len()]);
            p.render(&mut l, &mut r);
            let first = p.take_correlation();
            (first, p.take_correlation())
        };
        let tone: Vec<f32> = (0..4800).map(|i| 0.5 * (i as f32 * 0.05).sin()).collect();
        let inverted: Vec<f32> = tone.iter().map(|v| -v).collect();
        let (same, again) = render_pair(tone.clone(), tone.clone());
        assert!((same - 1.0).abs() < 1e-4, "identical {same}");
        assert!(again.is_nan(), "the sums reset after a read: {again}");
        let (opposed, _) = render_pair(tone.clone(), inverted);
        assert!((opposed + 1.0).abs() < 1e-4, "inverted {opposed}");
        let mut seed = 12345u32;
        let mut noise = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5
        };
        let a: Vec<f32> = (0..48000).map(|_| noise()).collect();
        let b: Vec<f32> = (0..48000).map(|_| noise()).collect();
        let (unrelated, _) = render_pair(a, b);
        assert!(unrelated.abs() < 0.05, "independent noise {unrelated}");
        let (silent, _) = render_pair(vec![0.0; 480], vec![0.0; 480]);
        assert!(silent.is_nan(), "silence {silent}");
    }

    fn tone_through_lowpass(automate: bool) -> (f32, f32) {
        tone_through(automate, 200.0)
    }

    fn tone_through(automate: bool, cutoff: f32) -> (f32, f32) {
        let mut p = Player::new();
        p.set_rate(48000.0);
        p.alloc_source(1, 48000, 1, 48000);
        let tone: Vec<f32> = (0..48000).map(|i| 0.5 * (2.0 * std::f32::consts::PI * 4000.0 * i as f32 / 48000.0).sin()).collect();
        p.write_source(1, 0, &tone);
        let env = p.add_envelope(&[(0, 200.0), (48000, 12000.0)], false);
        p.add_clip(PlayClip { source: 1, start: 0, source_in: 0, length: 48000, gain: 1.0, pan: 0.0, fade_in: 0, fade_out: 0, fade_shape: 0, bus: 0, track: 1, gain_env: 0, pan_env: 0 });
        assert!(p.add_clip_fx(crate::fx::LOWPASS, cutoff, 0.0, 0.707));
        if automate {
            assert!(p.add_clip_fx_auto(0, 0, env));
        }
        let (mut l, mut r) = (vec![0f32; 48000], vec![0f32; 48000]);
        p.render(&mut l, &mut r);
        let rms = |s: &[f32]| (s.iter().map(|v| v * v).sum::<f32>() / s.len() as f32).sqrt();
        (rms(&l[2400..7200]), rms(&l[40800..45600]))
    }

    #[test]
    fn an_automated_cutoff_opens_the_filter_over_time() {
        let (early, late) = tone_through_lowpass(true);
        let (still_early, still_late) = tone_through_lowpass(false);
        // the cutoff passes 200 Hz to 12 kHz in a second: the 4 kHz tone is cut early and passes late
        // late in the sweep the cutoff is near 12 kHz: the 4 kHz tone passes almost whole (unfiltered RMS 0.354)
        assert!(late > 0.33, "automated late level {late}");
        // early (0.05 to 0.15 s) the cutoff runs about 790 to 1970 Hz: the level matches a fixed filter at the
        // envelope's mean there, 1385 Hz, so the filter follows the envelope rather than merely changing
        let (fixed_at_mean, _) = tone_through(false, 1385.0);
        assert!(early > 0.6 * fixed_at_mean && early < 1.6 * fixed_at_mean, "automated early {early}, fixed at 1385 Hz {fixed_at_mean}");
        assert!(late > 5.0 * early, "automated: early {early}, late {late}");
        // the same filter without automation stays at 200 Hz and keeps the tone cut throughout
        assert!(still_late < 0.02 && still_early < 0.02, "fixed: {still_early} {still_late}");
    }

    /// PT-33: a clip's own compressor stage, after a filter in the same chain, brings a loud clip down by about what
    /// its threshold and ratio predict, and a 4 kHz lowpass ahead of it still cuts a 10 kHz tone.
    fn clip_level(freq: f32, filter: bool, comp: bool) -> f32 {
        let mut p = Player::new();
        p.set_rate(48000.0);
        p.alloc_source(1, 48000, 1, 48000);
        let tone: Vec<f32> = (0..48000).map(|i| 0.5 * (2.0 * std::f32::consts::PI * freq * i as f32 / 48000.0).sin()).collect();
        p.write_source(1, 0, &tone);
        p.add_clip(PlayClip { source: 1, start: 0, source_in: 0, length: 48000, gain: 1.0, pan: 0.0, fade_in: 0, fade_out: 0, fade_shape: 0, bus: 0, track: 1, gain_env: 0, pan_env: 0 });
        if filter {
            assert!(p.add_clip_fx(crate::fx::LOWPASS, 4000.0, 0.0, 0.707));
        }
        if comp {
            assert!(p.add_clip_comp(-20.0, 4.0, 5.0, 100.0, 0.0));
        }
        let (mut l, mut r) = (vec![0f32; 48000], vec![0f32; 48000]);
        p.render(&mut l, &mut r);
        let s = &l[24000..48000];
        (s.iter().map(|v| v * v).sum::<f32>() / s.len() as f32).sqrt()
    }

    #[test]
    fn a_clip_compressor_brings_a_loud_clip_down_after_its_filters() {
        let drop = 20.0 * (clip_level(440.0, true, false) / clip_level(440.0, true, true)).log10();
        // a -9 dBFS RMS tone over a -20 dB threshold at 4:1 comes down by several dB (8.25 for an RMS detector)
        assert!(drop > 4.0 && drop < 12.0, "the clip compressor took {drop} dB");
        // the lowpass comes first: it cuts a 10 kHz tone below the threshold, so the compressor after it changes nothing
        // (run first, the compressor would have taken the full-level tone down too)
        let (filtered, both, open) = (clip_level(10000.0, true, false), clip_level(10000.0, true, true), clip_level(10000.0, false, false));
        assert!(filtered < 0.25 * open, "the lowpass did not cut: {filtered} against {open}");
        assert!((20.0 * (both / filtered).log10()).abs() < 0.5, "the compressor acted on the filtered tone: {both} against {filtered}");
        // an automation for a stage or parameter that does not exist is refused
        let mut p = Player::new();
        let env = p.add_envelope(&[(0, 1.0)], false);
        p.add_clip(PlayClip { source: 1, start: 0, source_in: 0, length: 10, gain: 1.0, pan: 0.0, fade_in: 0, fade_out: 0, fade_shape: 0, bus: 0, track: 1, gain_env: 0, pan_env: 0 });
        assert!(!p.add_clip_fx_auto(0, 0, env));
        assert!(p.add_clip_fx(crate::fx::PEAK, 1000.0, 6.0, 1.0));
        assert!(!p.add_clip_fx_auto(0, 3, env) && !p.add_clip_fx_auto(0, 1, 7) && p.add_clip_fx_auto(0, 1, env));
    }
}
