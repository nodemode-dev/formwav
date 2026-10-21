use crate::layout::{Layout, MAX_CH};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Place {
    pub x: f32,
    pub y: f32,
    pub div: f32,
    pub centre: f32,
    pub el: f32,
    pub lfe_db: f32,
}

impl Place {
    pub fn from_record(r: &[f32]) -> Place {
        let at = |i: usize, d: f32| r.get(i).copied().filter(|v| v.is_finite()).unwrap_or(d);
        Place {
            x: at(0, 0.0).clamp(-1.0, 1.0),
            y: at(1, 1.0).clamp(-1.0, 1.0),
            div: at(2, 0.0).clamp(0.0, 1.0),
            centre: at(3, 100.0).clamp(0.0, 100.0),
            el: at(4, 0.0).clamp(-90.0, 90.0),
            lfe_db: at(5, -120.0),
        }
    }
}

fn ring_gains(l: &Layout, idx: &[usize], a: f32, s: f32, out: &mut [f32; MAX_CH]) {
    let m = idx.len();
    if m == 0 {
        return;
    }
    let mut point = [0.0f32; MAX_CH];
    if m == 1 {
        point[idx[0]] = 1.0;
    } else if let Some(&on) = idx.iter().find(|&&i| {
        let d = (l.speakers[i].az - a).rem_euclid(360.0);
        d < 1e-4 || d > 360.0 - 1e-4
    }) {
        point[on] = 1.0;
    } else {
        let mut order: [usize; MAX_CH] = [0; MAX_CH];
        order[..m].copy_from_slice(idx);
        order[..m].sort_by(|&p, &q| l.speakers[p].az.partial_cmp(&l.speakers[q].az).unwrap_or(std::cmp::Ordering::Equal));
        let first = l.speakers[order[0]].az;
        let last = l.speakers[order[m - 1]].az;
        let mut a = a;
        while a < first {
            a += 360.0;
        }
        while a >= first + 360.0 {
            a -= 360.0;
        }
        let mut placed = false;
        for w in 0..m {
            let (p, q) = (order[w], order[(w + 1) % m]);
            let a1 = l.speakers[p].az;
            let a2 = if w + 1 == m { first + 360.0 } else { l.speakers[q].az };
            if a1 <= a && a <= a2 {
                if a2 - a1 > 180.0 {
                    let near = if a - a1 <= a2 - a { p } else { q };
                    point[near] = 1.0;
                } else {
                    let t = if a2 > a1 { (a - a1) / (a2 - a1) } else { 0.0 };
                    point[p] += (t * std::f32::consts::FRAC_PI_2).cos();
                    point[q] += (t * std::f32::consts::FRAC_PI_2).sin();
                }
                placed = true;
                break;
            }
        }
        if !placed {
            let near = if (a - last).abs() <= (a - first).abs() { order[m - 1] } else { order[0] };
            point[near] = 1.0;
        }
    }
    let even = 1.0 / (m as f32).sqrt();
    let mut power = 0.0f32;
    for &i in idx {
        let g = (1.0 - s) * point[i] + s * even;
        out[i] = g;
        power += g * g;
    }
    let norm = power.sqrt();
    if norm > 0.0 {
        for &i in idx {
            out[i] /= norm;
        }
    }
}

/// A source's gains on each channel of the layout (file order): pairwise constant power between the speakers either
/// side of its direction on the ring at ear height, spread toward all of them as it nears the middle or as its
/// divergence rises, part of the centre speaker's share moved to a phantom centre, raised onto the height ring by its
/// elevation, and its LFE send. First-order ambisonics takes its W Y Z X gains instead.
pub fn place_gains(l: &Layout, p: &Place, out: &mut [f32; MAX_CH]) {
    *out = [0.0; MAX_CH];
    let r = p.x.hypot(p.y).min(1.0);
    if l.ambisonic {
        let az = (-p.x).atan2(p.y);
        let e = p.el.clamp(-90.0, 90.0).to_radians();
        out[0] = 1.0;
        out[1] = r * az.sin() * e.cos();
        out[2] = e.sin();
        out[3] = r * az.cos() * e.cos();
        return;
    }
    let a = if r > 1e-9 { p.x.atan2(p.y).to_degrees() } else { 0.0 };
    let s = 1.0 - (1.0 - p.div.clamp(0.0, 1.0)) * r;
    let mut bed = [0usize; MAX_CH];
    let mut top = [0usize; MAX_CH];
    let (mut nb, mut nt) = (0, 0);
    for (i, sp) in l.speakers.iter().enumerate() {
        if sp.lfe {
            continue;
        }
        if sp.el > 0.0 {
            top[nt] = i;
            nt += 1;
        } else {
            bed[nb] = i;
            nb += 1;
        }
    }
    ring_gains(l, &bed[..nb], a, s, out);
    let centre = l.speakers.iter().position(|sp| !sp.lfe && sp.el == 0.0 && sp.az == 0.0);
    if let Some(c) = centre {
        let t = (p.centre / 100.0).clamp(0.0, 1.0);
        if t < 1.0 && out[c] != 0.0 {
            let moved = (1.0 - t) * out[c] * out[c] / 2.0;
            let side = |sign: f32| bed[..nb].iter().copied().filter(|&i| i != c && l.speakers[i].az * sign > 0.0).min_by(|&p, &q| l.speakers[p].az.abs().partial_cmp(&l.speakers[q].az.abs()).unwrap_or(std::cmp::Ordering::Equal));
            if let (Some(lft), Some(rgt)) = (side(-1.0), side(1.0)) {
                out[c] *= t.sqrt();
                out[lft] = (out[lft] * out[lft] + moved).sqrt();
                out[rgt] = (out[rgt] * out[rgt] + moved).sqrt();
            }
        }
    }
    if nt > 0 {
        let h = p.el.clamp(0.0, 90.0) / 90.0;
        let (vb, vt) = ((h * std::f32::consts::FRAC_PI_2).cos(), (h * std::f32::consts::FRAC_PI_2).sin());
        if vt > 0.0 {
            let mut up = [0.0f32; MAX_CH];
            ring_gains(l, &top[..nt], a, s, &mut up);
            for &i in &top[..nt] {
                out[i] = vt * up[i];
            }
        }
        for &i in &bed[..nb] {
            out[i] *= vb;
        }
    }
    if p.lfe_db > -80.0 {
        if let Some(i) = l.speakers.iter().position(|sp| sp.lfe) {
            out[i] = 10f32.powf(p.lfe_db / 20.0);
        }
    }
}
