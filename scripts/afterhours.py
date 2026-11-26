"""Start only the Afterhours music engine. Reuse an existing healthy instance."""
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'unreal'
LOCAL_ENGINE_CONFIG = PROJECT / 'Saved' / 'Afterhours' / 'engine-checkout'
VDJ = Path('/Applications/VirtualDJ.app')
OPENER = build_opener(ProxyHandler({}))


def ensure_music():
    port = int(os.environ.get('DOT_AFTERHOURS_PORT', '8765'))
    configured = LOCAL_ENGINE_CONFIG.read_text().strip() if LOCAL_ENGINE_CONFIG.is_file() else ''
    engine = os.environ.get('DOT_AFTERHOURS_ENGINE') or configured
    runtime = PROJECT / 'Saved' / 'Afterhours'
    runtime.mkdir(parents=True, exist_ok=True)
    data_root = Path(os.environ.get('DOT_AFTERHOURS_DATA_ROOT',str(runtime))).expanduser().resolve()
    report_config = runtime / 'analysis-bridge-reports'
    report_default = report_config.read_text().strip() if report_config.is_file() else ''
    reports = Path(os.environ.get('AFTERHOURS_ANALYSIS_REPORTS_DIR',
                                  report_default or str(data_root/'.runtime'/'audio-analysis'))).expanduser()

    def status():
        try:
            with OPENER.open(f'http://127.0.0.1:{port}/api/config',timeout=.6) as response:
                payload = json.loads(response.read(8192))
                return payload.get('service') == 'afterhours-music'
        except (OSError,ValueError):
            return False

    if status():
        return 'Afterhours engine already running'
    try:
        with socket.create_connection(('127.0.0.1', port),timeout=.3):
            return f'Afterhours could not start because port {port} is occupied'
    except ConnectionRefusedError:
        pass
    if not engine:
        return 'Set DOT_AFTERHOURS_ENGINE to an Afterhours checkout with its Python environment.'
    root = Path(engine).expanduser().resolve()
    python = root / '.venv' / 'bin' / 'python'
    if not (root / 'src' / 'afterhours' / 'server.py').is_file() or not python.is_file():
        return 'Set DOT_AFTERHOURS_ENGINE to the Afterhours checkout with its Python environment.'
    env = dict(os.environ, AFTERHOURS_DATA_ROOT=str(data_root),PYTHONDONTWRITEBYTECODE='1',
               AFTERHOURS_ANALYSIS_REPORTS_DIR=str(reports.resolve()),
               PYTHONPATH=str(root/'src'))
    with (runtime/'engine.log').open('ab') as log:
        process = subprocess.Popen([str(python),'-u','-m','afterhours.server','--port',str(port)],
            cwd=root,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    (runtime/'engine.pid').write_text(str(process.pid))
    for _ in range(65):
        if status():
            return 'Afterhours engine started'
        if process.poll() is not None:
            break
        time.sleep(.1)
    return f'Afterhours engine unavailable. See {runtime / "engine.log"}'


def ensure_native_audio(state):
    if not VDJ.is_dir():
        return 'VirtualDJ is unavailable on this Mac.'
    subprocess.run(['/usr/bin/open','-g','-a',str(VDJ)],check=True)
    tool = ROOT/'scripts'/'virtualdj-audio'
    helper = state/'Dot Afterhours VirtualDJ Audio.app'
    binary = helper/'Contents'/'MacOS'/'VirtualDJAudio'
    if not binary.is_file() or any((tool/name).stat().st_mtime > binary.stat().st_mtime
        for name in ('virtualdj-audio.swift','info.plist','build.sh')):
        subprocess.run([str(tool/'build.sh')],check=True)
    # Launch Services reuses a running helper and translates the per-app audio permission prompt.
    subprocess.run(['/usr/bin/open','-g','--stdout',str(state/'vdj-audio.log'),
                    '--stderr',str(state/'vdj-audio-error.log'),str(helper)],check=True)
    return 'VirtualDJ master routing requested'


if __name__ == '__main__':
    print(ensure_music(),flush=True)
