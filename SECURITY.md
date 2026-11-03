# Security policy

## Supported versions

Security fixes go into the newest release. Please update before reporting, and
check whether the problem is still there.

| Version | Supported |
| --- | --- |
| 2.21.x (latest release) | Yes |
| Anything older | No |

## Reporting a vulnerability

**Do not open a public issue for a security problem.** Use GitHub's private
reporting instead: on the repository's **Security** tab, choose **Report a
vulnerability**. Include what you found, the steps to reproduce it, the version and
platform, and what an attacker could do with it.

You can expect an acknowledgement within a week. We will keep you informed while it
is fixed and credit you in the release notes, unless you would rather not be named.

## What counts

FormWav runs on your own machine, so the things that matter most are the ways
something outside it could get in:

- **The engine** binds to loopback (127.0.0.1, port 8060), and so does the MCP server's
  HTTP mode (port 8061). Anything that makes either reachable from another machine
  without the person turning that on, or lets another web origin drive them.
- **The network listener** for phones and other computers (off by default, port
  8978): getting past the pairing code, reusing or forging a device token, or reaching
  anything it should not expose.
- **The guest link** (off by default, port 8979): reaching anything beyond pairing and
  the recording room.
- **The desktop window**: the page calling any desktop command beyond the few it is
  allowed.
- **Provider keys and cloud sign-ins** kept by the engine: anything that leaks them or
  sends them to the page.
- **Files and downloads**: importing, downloading or extracting media, models or
  sessions in a way that writes outside where it should, or loading a plug-in the scan
  did not find.

Bugs that need someone to already control your machine, or to run a modified build
of FormWav, are ordinary bugs: please open an issue for those.
