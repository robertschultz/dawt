#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser

from afterhours import ensure_music, ensure_native_audio

project = Path(__file__).resolve().parent.parent
state = project / 'Saved' / 'DotSession'
state.mkdir(parents=True, exist_ok=True)
player_port, engine_port = 8170, 8172
url = f'http://127.0.0.1:{player_port}/'
default_engine = '/Users/Shared/Epic Games/UE_5.8/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor'

parser = argparse.ArgumentParser(description='Launch or stop the local Dot Unreal browser demo.')
parser.add_argument('--no-browser', action='store_true')
parser.add_argument('--stop', action='store_true')
parser.add_argument('--dj', action='store_true', help='Open the Dot Afterhours booth.')
args = parser.parse_args()

def managed_pid(name, marker):
    file = state / f'{name}.pid'
    try:
        pid = int(file.read_text())
        args = subprocess.check_output(
            ['/bin/ps', '-ww', '-p', str(pid), '-o', 'command='], text=True, stderr=subprocess.DEVNULL
        ).strip()
        return pid if marker in args and str(project) in args else None
    except (FileNotFoundError, ValueError, subprocess.CalledProcessError):
        return None

def start(name, command):
    with (state / f'{name}-console.log').open('w') as log:
        p = subprocess.Popen(command, cwd=project, stdout=log, stderr=subprocess.STDOUT,
                             start_new_session=True, stdin=subprocess.DEVNULL)
    (state / f'{name}.pid').write_text(str(p.pid))
    return p

if args.stop:
    for name, pattern in [('engine','DotPerformance.uproject'), ('signal','Signal.cjs'),
                          ('vdj-audio','VirtualDJ Audio.app')]:
        pid = managed_pid(name, pattern)
        if pid:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    sys.exit()

engine = Path(os.environ.get('DOT_UNREAL_EDITOR', default_engine))
if not engine.is_file():
    sys.exit('Install Unreal Engine 5.8 or set DOT_UNREAL_EDITOR to its executable.')
node = shutil.which('node')
if not node:
    candidates = sorted((Path.home() / '.nvm' / 'versions' / 'node').glob('*/bin/node'), reverse=True)
    node = str(candidates[0]) if candidates else None
if not node:
    sys.exit('Node.js is required to launch the local Pixel Streaming service.')

def serving():
    try:
        with urllib.request.urlopen(url + 'health', timeout=.8) as response:
            return json.load(response).get('demo') == 'dot-unreal'
    except (OSError, ValueError):
        return False

if not serving():
    server = start('signal', [node, str(project / 'Web' / 'Signal.cjs'), str(player_port), str(engine_port)])
    for _ in range(50):
        if serving() or server.poll() is not None:
            break
        time.sleep(.12)
    if not serving():
        if server.poll() is None:
            server.terminate()
        sys.exit(f'Local browser service failed. See {state / "signal-console.log"}')

if not managed_pid('engine','DotPerformance.uproject'):
    start('engine', [str(engine), str(project / 'DotPerformance.uproject'), '/Game/Dot/DotStage',
        '-game', '-RenderOffscreen', '-ForceRes', '-ResX=1440', '-ResY=900',
        '-nosplash', '-NoSourceControl', '-AudioMixer', '-NoTrace',
        f'-PixelStreamingConnectionURL=ws://127.0.0.1:{engine_port}',
        '-PixelStreamingAutoStartStream', '-PixelStreamingEncoderTargetBitrate=15000000',
        '-PixelStreamingWebRTCFps=30', '-ExecCmds=t.MaxFPS 30,r.ScreenPercentage 100',
        *(['-DotClearanceAudit'] if os.environ.get('DOT_CLEARANCE_AUDIT')=='1' else []),
        f'-abslog={state / "Unreal.log"}'])

if args.dj:
    try:
        print(ensure_music(),flush=True)
        print(ensure_native_audio(state),flush=True)
    except (OSError,ValueError,subprocess.SubprocessError) as exc:
        print(f'Native Afterhours startup: {exc}',file=sys.stderr,flush=True)

destination = url + 'dj' if args.dj else url
print(f'Dot Unreal browser demo: {destination}', flush=True)
if not args.no_browser:
    webbrowser.open(destination)
