//! WAV in and out for offline processing: reads 16-bit PCM or 32-bit float (formwav's media), writes 32-bit float so
//! nothing a plugin produces above full scale is clipped on the way back.

use std::io::Read;

pub struct Audio {
    pub rate: u32,
    pub channels: Vec<Vec<f32>>,
}

pub fn read(path: &str) -> Result<Audio, String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path).and_then(|mut f| f.read_to_end(&mut bytes)).map_err(|e| format!("could not read {path}: {e}"))?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(format!("{path} is not a WAV file"));
    }
    let (mut format, mut channels, mut rate, mut bits, mut data) = (0u16, 0usize, 0u32, 0u16, None);
    let mut pos = 12;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body = &bytes[pos + 8..(pos + 8 + size).min(bytes.len())];
        if id == b"fmt " && body.len() >= 16 {
            format = u16::from_le_bytes([body[0], body[1]]);
            channels = u16::from_le_bytes([body[2], body[3]]) as usize;
            rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
            bits = u16::from_le_bytes([body[14], body[15]]);
            if format == 0xFFFE && body.len() >= 26 {
                format = u16::from_le_bytes([body[24], body[25]]);
            }
        } else if id == b"data" {
            data = Some(body);
        }
        pos += 8 + size + (size & 1);
    }
    let data = data.ok_or("the WAV has no data chunk")?;
    if channels == 0 {
        return Err("the WAV has no fmt chunk".into());
    }
    let samples: Vec<f32> = match (format, bits) {
        (3, 32) => data.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect(),
        (1, 16) => data.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect(),
        _ => return Err(format!("unsupported WAV encoding (format {format}, {bits} bits)")),
    };
    let frames = samples.len() / channels;
    let planar = (0..channels).map(|c| (0..frames).map(|i| samples[i * channels + c]).collect()).collect();
    Ok(Audio { rate, channels: planar })
}

pub fn write(path: &str, audio: &Audio) -> Result<(), String> {
    let channels = audio.channels.len();
    let frames = audio.channels.first().map_or(0, |c| c.len());
    let data_len = (frames * channels * 4) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes());
    out.extend_from_slice(&(channels as u16).to_le_bytes());
    out.extend_from_slice(&audio.rate.to_le_bytes());
    out.extend_from_slice(&(audio.rate * channels as u32 * 4).to_le_bytes());
    out.extend_from_slice(&(channels as u16 * 4).to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..frames {
        for channel in &audio.channels {
            out.extend_from_slice(&channel[i].to_le_bytes());
        }
    }
    std::fs::write(path, out).map_err(|e| format!("could not write {path}: {e}"))
}
