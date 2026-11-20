import functools
import subprocess
import sys

NO_WINDOW = 0x08000000
OWN_CONSOLE = 0x00000008 | 0x00000010
FLAGS_AT = 13
MARK = "_formwav_no_window"


def flags(given: int) -> int:
    if given & OWN_CONSOLE:
        return given
    return given | NO_WINDOW


def install(platform: str = sys.platform) -> bool:
    if platform != "win32":
        return False
    original = subprocess.Popen.__init__
    if getattr(original, MARK, False):
        return True

    @functools.wraps(original)
    def start(self, *args, **kwargs):
        if len(args) > FLAGS_AT:
            args = (*args[:FLAGS_AT], flags(args[FLAGS_AT] or 0), *args[FLAGS_AT + 1 :])
        else:
            kwargs["creationflags"] = flags(kwargs.get("creationflags") or 0)
        return original(self, *args, **kwargs)

    setattr(start, MARK, True)
    subprocess.Popen.__init__ = start
    return True
