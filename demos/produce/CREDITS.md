# Credits for the produce demo media

The produce demo, "Cold Open, 32 bars at 130 BPM", is built from two CC0 Internet Archive items, a public-domain piano recording and two NASA sound files. Each file below ships as a JavaScript data pack in `demos/produce/assets/media/` (base64 of an mp3 or a 16-bit WAV), so the page decodes it from `file://` with no fetch. Licences are as stated on each source page, read before download.

| Files in the demo | Title | Author or source | Source page | Licence as stated there | What was changed |
| --- | --- | --- | --- | --- | --- |
| `assets/media/drums-a.js`, `drums-b.js`, `drums-c.js` | "stem drums" of "This Party (free techno samples 130bpm)", bars 25, 57 and 73 (eight bars each) | Uploaded to the Internet Archive by "stellar art wars 15" | https://archive.org/details/StemBass_20160922 | "CC0 1.0 Universal", http://creativecommons.org/publicdomain/zero/1.0/ | Cut at bar lines at 130 BPM (eight bars of 1.846 s each, so 14.77 s), 4 ms fades at both ends, re-encoded from the item's Ogg Vorbis to 160 kbps stereo mp3 |
| `assets/media/bass-b.js`, `bass-c.js` | "stem bass" of the same item, bars 57 and 73 | same | same | same | same cut and encode |
| `assets/media/keys-a.js`, `keys-brk.js`, `keys-b.js`, `keys-c.js` | "stem keys" of the same item, bars 25, 41, 57 and 73 | same | same | same | same cut and encode |
| `assets/media/loop-kit-a.js`, `loop-kit-b.js`, `loop-low.js` | One bar of 130Drumkit01-001, 130Drumkit01-002 and 130Drumkit01-003 from "beat loops vol 01" | "sounds of pure destruction" (Internet Archive item BeatLoopsVol01) | https://archive.org/details/BeatLoopsVol01 | "CC0 1.0 Universal", http://creativecommons.org/publicdomain/zero/1.0/ | First bar (1.846 s) of each WAV, 32-sample fades, peak-limited to -0.9 dBFS, stored as 16-bit stereo WAV |
| `assets/media/shot-kick.js` | One-shot cut from 130Drumkit01-005 (0.69 s, 0.23 s long) | same item | same | same | Sliced, 12 ms fade out, normalised to -0.9 dBFS, 16-bit stereo WAV |
| `assets/media/shot-subkick.js` | One-shot cut from 090Drumkit01-005 (1.00 s, 0.33 s long) | same | same | same | same slicing |
| `assets/media/shot-snare.js` | One-shot cut from 090Drumkit01-001 (0.50 s, 0.17 s long) | same | same | same | same slicing |
| `assets/media/shot-clap.js` (shown as "Noise snare") | One-shot cut from 140Drumkit02-006 (1.50 s, 0.30 s long) | same | same | same | same slicing |
| `assets/media/shot-rim.js` | One-shot cut from 125Xe8001 (0.48 s, 0.20 s long) | same | same | same | same slicing |
| `assets/media/shot-hat.js` | One-shot cut from 140Drumkit02-004 (0.86 s, 0.12 s long) | same | same | same | same slicing |
| `assets/media/shot-openhat.js` | One-shot cut from 110Drumloop01-2012-002 (0.55 s, 0.50 s long) | same | same | same | same slicing |
| `assets/media/shot-tom.js` | One-shot cut from 110Drumloop01-2012-008 (1.36 s, 0.27 s long) | same | same | same | same slicing |
| `assets/media/piano.js` | Gymnopedies, 1. Lent et douloureux (Erik Satie, 1888), first 29.5 s (16 bars) | Performed by Robin Alciatore, from Musopen | https://commons.wikimedia.org/wiki/File:Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg | Commons API for the file: LicenseShortName "Public domain", UsageTerms "Public domain", AttributionRequired false, template PD-author; the description quotes Musopen: "The music on this site is given a public domain license". Musopen asks, as a courtesy, for credit, which this line gives | The first demo's trimmed pack, cut to 16 bars at 130 BPM with a 3 s fade out, re-encoded as a 160 kbps mp3 |
| `assets/media/saturn.js` | Saturn Radio Emissions #2 (Cassini) | NASA | https://www.nasa.gov/historical-sounds/ (file 584795main_saturn_radio_waves.mp3) | NASA media usage guidelines (https://www.nasa.gov/multimedia/guidelines/index.html): audio "generally not subject to copyright in the United States" | The first demo's pack, unchanged (13 s, 8 kHz mono, 64 kbps mp3) |
| `assets/media/launch-roar.js` | Sound of Launch (STS-131) | NASA | https://www.nasa.gov/historical-sounds/ (file 590189main_ringtone_131_launchNats.mp3) | Same NASA statement | The first demo's pack, unchanged (19 s, 128 kbps mp3) |

Notes

- Source checks: the two Internet Archive item pages and the NASA sounds page were fetched and read before use; the Commons file page for the Satie recording refuses the shell and was read through the Commons API (`action=query`, `prop=imageinfo`, `iiprop=extmetadata`). The BeatLoopsVol01 page lists 150 loops in four formats under CC0, among them the 130Drumkit01, 090Drumkit01, 140Drumkit02, 125Xe8 and 110Drumloop01-2012 groups used here. The StemBass_20160922 page lists stem bass, drums, keys and pella; the pella (vocal) stem is not used. The NASA sounds page lists the STS-135 commentary, the Saturn radio emissions and the STS-131 launch sound, and points to the NASA media guidelines; the NASA insignia is not part of any clip.
- The stems are lossy on arrival (Ogg Vorbis at 96 kbps and above) and are encoded once more, so they are demo audio, not masters.
- The step sequencer's patterns are mixed in the browser from the one-shots above; the pattern audio carries no third-party material beyond them.
- Media size in this folder: the 23 packs total 6.7 MB.
