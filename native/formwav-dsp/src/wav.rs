use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleFormat {
    Pcm8,
    Pcm16,
    Pcm24,
    Pcm32,
    Float32,
    Float64,
}

impl SampleFormat {
    pub fn name(self) -> &'static str {
        match self {
            SampleFormat::Pcm8 => "pcm8",
            SampleFormat::Pcm16 => "pcm16",
            SampleFormat::Pcm24 => "pcm24",
            SampleFormat::Pcm32 => "pcm32",
            SampleFormat::Float32 => "float32",
            SampleFormat::Float64 => "float64",
        }
    }

    fn bytes(self) -> usize {
        match self {
            SampleFormat::Pcm8 => 1,
            SampleFormat::Pcm16 => 2,
            SampleFormat::Pcm24 => 3,
            SampleFormat::Pcm32 | SampleFormat::Float32 => 4,
            SampleFormat::Float64 => 8,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WavInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub frames: u64,
    pub format: SampleFormat,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AudioBuffer {
    pub sample_rate: u32,
    pub channels: Vec<Vec<f32>>,
}

impl AudioBuffer {
    pub fn frames(&self) -> usize {
        self.channels.first().map_or(0, Vec::len)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WavError {
    NotRiff,
    NotWave,
    MissingFormat,
    MissingData,
    Unsupported { tag: u16, bits: u16 },
    BadFormat,
    Truncated,
}

impl fmt::Display for WavError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WavError::NotRiff => write!(f, "not a RIFF file"),
            WavError::NotWave => write!(f, "a RIFF file but not WAVE"),
            WavError::MissingFormat => write!(f, "no fmt chunk"),
            WavError::MissingData => write!(f, "no data chunk"),
            WavError::Unsupported { tag, bits } => write!(f, "unsupported encoding: format tag {tag}, {bits} bits"),
            WavError::BadFormat => write!(f, "the fmt chunk is inconsistent"),
            WavError::Truncated => write!(f, "the file ends inside a chunk header"),
        }
    }
}

impl std::error::Error for WavError {}

struct Layout {
    info: WavInfo,
    data_start: usize,
    data_len: usize,
}

fn u16le(b: &[u8], at: usize) -> Result<u16, WavError> {
    b.get(at..at + 2).map(|s| u16::from_le_bytes([s[0], s[1]])).ok_or(WavError::Truncated)
}

fn u32le(b: &[u8], at: usize) -> Result<u32, WavError> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]])).ok_or(WavError::Truncated)
}

fn layout(bytes: &[u8]) -> Result<Layout, WavError> {
    if bytes.get(0..4) != Some(b"RIFF".as_slice()) {
        return Err(WavError::NotRiff);
    }
    if bytes.get(8..12) != Some(b"WAVE".as_slice()) {
        return Err(WavError::NotWave);
    }
    let mut at = 12usize;
    let mut fmt_chunk: Option<(u16, u16, u32, u16, u16)> = None;
    let mut data: Option<(usize, usize)> = None;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32le(bytes, at + 4)? as usize;
        let body = at + 8;
        let available = bytes.len() - body;
        if id == b"fmt " {
            if size < 16 {
                return Err(WavError::BadFormat);
            }
            let mut tag = u16le(bytes, body)?;
            let channels = u16le(bytes, body + 2)?;
            let rate = u32le(bytes, body + 4)?;
            let block_align = u16le(bytes, body + 12)?;
            let bits = u16le(bytes, body + 14)?;
            if tag == 0xFFFE {
                if size < 40 {
                    return Err(WavError::BadFormat);
                }
                tag = u16le(bytes, body + 24)?;
            }
            fmt_chunk = Some((tag, channels, rate, block_align, bits));
        } else if id == b"data" {
            let len = if size == 0 || size > available { available } else { size };
            data = Some((body, len));
            if fmt_chunk.is_some() || len == available {
                break;
            }
        }
        if size > available {
            break;
        }
        at = body + size + (size & 1);
    }
    let (tag, channels, sample_rate, block_align, bits) = fmt_chunk.ok_or(WavError::MissingFormat)?;
    let (data_start, raw_len) = data.ok_or(WavError::MissingData)?;
    let format = match (tag, bits) {
        (1, 8) => SampleFormat::Pcm8,
        (1, 16) => SampleFormat::Pcm16,
        (1, 24) => SampleFormat::Pcm24,
        (1, 32) => SampleFormat::Pcm32,
        (3, 32) => SampleFormat::Float32,
        (3, 64) => SampleFormat::Float64,
        _ => return Err(WavError::Unsupported { tag, bits }),
    };
    if channels == 0 || sample_rate == 0 {
        return Err(WavError::BadFormat);
    }
    let frame_bytes = format.bytes() * channels as usize;
    if block_align as usize != frame_bytes {
        return Err(WavError::BadFormat);
    }
    let frames = raw_len / frame_bytes;
    Ok(Layout {
        info: WavInfo { sample_rate, channels, frames: frames as u64, format },
        data_start,
        data_len: frames * frame_bytes,
    })
}

pub fn probe_wav(bytes: &[u8]) -> Result<WavInfo, WavError> {
    layout(bytes).map(|l| l.info)
}

pub fn decode_wav(bytes: &[u8]) -> Result<AudioBuffer, WavError> {
    let l = layout(bytes)?;
    let ch = l.info.channels as usize;
    let frames = l.info.frames as usize;
    let size = l.info.format.bytes();
    let data = &bytes[l.data_start..l.data_start + l.data_len];
    let mut channels = vec![Vec::with_capacity(frames); ch];
    for (i, sample) in data.chunks_exact(size).enumerate() {
        channels[i % ch].push(to_f32(l.info.format, sample));
    }
    Ok(AudioBuffer { sample_rate: l.info.sample_rate, channels })
}

fn to_f32(format: SampleFormat, s: &[u8]) -> f32 {
    match format {
        SampleFormat::Pcm8 => (f32::from(s[0]) - 128.0) / 128.0,
        SampleFormat::Pcm16 => f32::from(i16::from_le_bytes([s[0], s[1]])) / 32_768.0,
        SampleFormat::Pcm24 => (i32::from_le_bytes([0, s[0], s[1], s[2]]) >> 8) as f32 / 8_388_608.0,
        SampleFormat::Pcm32 => i32::from_le_bytes([s[0], s[1], s[2], s[3]]) as f32 / 2_147_483_648.0,
        SampleFormat::Float32 => f32::from_le_bytes([s[0], s[1], s[2], s[3]]),
        SampleFormat::Float64 => f64::from_le_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]]) as f32,
    }
}
