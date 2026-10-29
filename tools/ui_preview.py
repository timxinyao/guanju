#!/usr/bin/env python3
"""Local-only ESPHome UI fixture; no hardware or external network access."""
import argparse
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / 'output/ui-preview-state.json'
LOG = ROOT / 'output/ui-preview.log'
SCRIPT = Path(__file__).resolve()
DEFAULT_SETTINGS = {'distance_cm': 150, 'near_ms': 3000, 'radar_timeout_s': 1, 'clear_ms': 1000, 'sensitivity': 'standard'}


def identity(pid):
    try:
        return subprocess.check_output(['ps', '-p', str(pid), '-o', 'lstart='], text=True).strip()
    except subprocess.CalledProcessError:
        return ''


def matching(record):
    pid = record.get('pid')
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True).strip()
    except subprocess.CalledProcessError:
        return False
    return (bool(record.get('created')) and identity(pid) == record['created']
            and str(SCRIPT) in command and 'serve --managed' in command
            and record.get('root') == str(ROOT) and record.get('mode') == 'fixture')


def read_record():
    try:
        return json.loads(STATE.read_text())
    except FileNotFoundError:
        return None


def record_status():
    record = read_record()
    if record is None:
        return 'stopped', None
    return ('running' if matching(record) else 'unverified'), record


class Fixture:
    def __init__(self):
        self.lock = threading.RLock()
        self.clients = set()
        self.started = time.monotonic()
        self.epoch = 0
        self.offline = False
        self.expired = False
        self.recovery_pending = False
        self.settings_revision = 0
        self.settings_status = 'ready'
        self.settings_phase = 'ready'
        self.settings = DEFAULT_SETTINGS.copy()
        self.settings_pending = None
        self.settings_error = None
        self.settings_fail_next = False
        self.settings_conflict_next = False
        self.states = {
            'switch/TV Trial': False,
            'binary_sensor/Trial Monitoring': False,
            'binary_sensor/Radar Data Fresh': True,
            'binary_sensor/Radar Measurement Known': True,
            'binary_sensor/TV Connected': True,
            'binary_sensor/Trial Owns Picture Off': False,
            'binary_sensor/Moving Target': False,
            'binary_sensor/Still Target': False,
            'text_sensor/Near Zone': 'Clear',
            'text_sensor/Scene Presence': 'Absent',
            'text_sensor/Trial Status': 'Trial OFF',
            'text_sensor/Near Zone Range': 'Nominal 1.5 m (gate 2), 0.75 m steps; radar delay 1 s',
            'text_sensor/TV Status': 'Active / picture visible',
            'text_sensor/Radar Firmware Version': 'Fixture',
            'text_sensor/IP Address': '127.0.0.1',
            'sensor/Moving Distance': 0,
            'sensor/Still Distance': 0,
            'sensor/Detection Distance': 0,
            'sensor/WiFi Signal': -45,
            'sensor/Uptime': 0,
        }

    def entity(self, key, detail=False):
        domain, name = key.split('/', 1)
        value = self.states[key]
        if key == 'sensor/Uptime':
            value = int(time.monotonic() - self.started)
        state = ('ON' if value else 'OFF') if isinstance(value, bool) else str(value)
        result = {'id': key, 'value': value, 'state': state}
        if detail:
            result.update(domain=domain, name=name, entity_category=0)
        return result

    def publish(self, key):
        if not self.offline and not self.expired:
            item = ('state', self.entity(key))
            for client in self.clients:
                client.put(item)

    def update(self, values):
        for key, value in values.items():
            self.states[key] = value
            self.publish(key)

    def health_status(self):
        """Mirror the controller's reported intent and effective health states."""
        if not self.states['switch/TV Trial']:
            return False, 'OFF; picture recovery pending' if self.recovery_pending else 'Trial OFF'
        if self.settings_status == 'applying':
            return False, 'ON; paused: settings applying'
        if self.recovery_pending:
            return False, 'ON; paused: picture recovery pending'
        if not self.states['binary_sensor/Radar Data Fresh']:
            return False, 'ON; paused: radar unavailable'
        if not self.states['binary_sensor/Radar Measurement Known']:
            return False, 'ON; paused: radar measurement unknown'
        if not self.states['binary_sensor/TV Connected']:
            return False, 'ON; paused: TV status expired'
        if self.states['text_sensor/TV Status'] == 'Standby (will not wake)':
            return False, 'ON; paused: TV standby (will not wake)'
        return True, ('ON; picture OFF by this trial' if self.states['binary_sensor/Trial Owns Picture Off']
                      else 'ON; monitoring near zone')

    def report_health(self):
        monitoring, status = self.health_status()
        self.update({'binary_sensor/Trial Monitoring': monitoring, 'text_sensor/Trial Status': status})

    def settings_snapshot(self):
        return {'revision': self.settings_revision, 'status': self.settings_status,
                'phase': self.settings_phase, 'settings': self.settings.copy(),
                'pending': self.settings_pending.copy() if self.settings_pending is not None else None,
                'error': self.settings_error}

    @staticmethod
    def valid_settings(settings):
        if not isinstance(settings, dict) or set(settings) != set(DEFAULT_SETTINGS):
            return False
        d, n, t, c = (settings[k] for k in ('distance_cm', 'near_ms', 'radar_timeout_s', 'clear_ms'))
        return (all(type(v) is int for v in (d, n, t, c)) and 50 <= d <= 300 and d % 10 == 0
                and 1000 <= n <= 5000 and n % 1000 == 0 and t in (1, 2)
                and c in (1000, 2000) and settings['sensitivity'] in ('low', 'standard', 'high'))

    def apply_settings(self, request):
        with self.lock:
            if not isinstance(request, dict) or type(request.get('expected_revision')) is not int or not 0 <= request['expected_revision'] <= 0xffffffff:
                return 400, {'error': 'invalid'}
            if set(request) == {'expected_revision', 'action'} and request['action'] == 'defaults':
                proposed = DEFAULT_SETTINGS.copy()
            elif set(request) == {'expected_revision', 'settings'} and self.valid_settings(request['settings']):
                proposed = request['settings'].copy()
            else:
                return 400, {'error': 'invalid'}
            if self.settings_status == 'applying':
                return 409, {'error': 'busy'}
            if self.settings_conflict_next:
                self.settings_conflict_next = False
                self.settings_revision = (self.settings_revision + 1) & 0xffffffff
                self.settings['distance_cm'] = 160 if self.settings['distance_cm'] != 160 else 150
            if request['expected_revision'] != self.settings_revision:
                return 409, {'error': 'revision_conflict'}
            self.settings_status = 'applying'
            self.settings_phase = 'queued'
            self.settings_pending = proposed
            self.settings_error = None
            fail = self.settings_fail_next
            self.settings_fail_next = False
            self.report_health()
            def run():
                # Each phase is observable; preserve committed settings until final save.
                time.sleep(.75)
                with self.lock:
                    if self.states['binary_sensor/Trial Owns Picture Off']:
                        if not self.states['text_sensor/TV Status'].startswith('Active / ') or not self.states['binary_sensor/TV Connected']:
                            self.settings_status = 'error'
                            self.settings_phase = 'queued'
                            self.settings_error = 'picture_restore_failed'
                            self.settings_pending = None
                            self.report_health()
                            return
                        self.recovery_pending = False
                        self.update({'binary_sensor/Trial Owns Picture Off': False,
                                     'text_sensor/TV Status': 'Active / picture visible'})
                    self.settings_phase = 'read_radar'
                time.sleep(.75)
                with self.lock:
                    self.settings_phase = 'verify_all'
                time.sleep(.75)
                with self.lock:
                    if fail:
                        self.settings_status = 'error'
                        self.settings_error = 'verify_failed'
                        self.settings_pending = None
                        self.report_health()
                        return
                    self.settings_phase = 'save'
                time.sleep(.75)
                with self.lock:
                    self.settings = proposed
                    self.settings_revision = (self.settings_revision + 1) & 0xffffffff
                    self.settings_status = 'ready'
                    self.settings_phase = 'ready'
                    self.settings_pending = None
                    self.settings_error = None
                    self.report_health()
            threading.Thread(target=run, daemon=True).start()
            return 202, self.settings_snapshot()

    def scenario(self, name):
        with self.lock:
            if name == 'SettingsFail':
                self.settings_fail_next = True
                return
            if name == 'SettingsConflict':
                self.settings_conflict_next = True
                return
            self.epoch += 1
            self.offline = name == 'Offline'
            self.expired = name == 'Expired'
            if self.offline:
                for client in self.clients:
                    client.put(None)
                return
            changes = {
                'binary_sensor/Radar Data Fresh': name != 'Unavailable',
                'binary_sensor/Radar Measurement Known': name not in ('Unknown', 'Unavailable'),
                'binary_sensor/TV Connected': name != 'Unavailable',
                'binary_sensor/Moving Target': name in ('Near', 'Far'),
                'binary_sensor/Still Target': False,
                'sensor/Moving Distance': 100 if name == 'Near' else 250 if name == 'Far' else 0,
                'sensor/Detection Distance': 100 if name == 'Near' else 250 if name == 'Far' else 0,
                'text_sensor/Near Zone': {'Near': 'Presence', 'Unknown': 'Unknown', 'Unavailable': 'Unavailable'}.get(name, 'Clear'),
                'text_sensor/Scene Presence': {'Near': 'Near', 'Far': 'Far', 'Unknown': 'Unknown', 'Unavailable': 'Unavailable'}.get(name, 'Absent'),
                'text_sensor/TV Status': {'Standby': 'Standby (will not wake)', 'PictureOff': 'Active / pictureOff', 'Unavailable': 'Unavailable / state expired'}.get(name, 'Active / picture visible'),
                'binary_sensor/Trial Owns Picture Off': (True if name == 'PictureOff' else False if name in ('Normal', 'Near', 'Far', 'Standby') else self.states['binary_sensor/Trial Owns Picture Off']),
            }
            if name in ('Normal', 'Near', 'Far', 'Standby'):
                self.recovery_pending = False
            self.update(changes)
            self.report_health()

    def switch(self, value):
        with self.lock:
            if not value and self.states['binary_sensor/Trial Owns Picture Off']:
                self.restore()
                return
            self.epoch += 1
            self.update({'switch/TV Trial': value})
            self.report_health()

    def restore(self):
        with self.lock:
            self.epoch += 1
            epoch = self.epoch
            self.recovery_pending = True
            self.update({'switch/TV Trial': False, 'binary_sensor/Trial Monitoring': False, 'text_sensor/Trial Status': 'OFF; picture recovery pending'})
        def finish():
            with self.lock:
                if (epoch == self.epoch and not self.offline
                        and self.states['text_sensor/TV Status'].startswith('Active / ')):
                    self.recovery_pending = False
                    self.update({'binary_sensor/Trial Owns Picture Off': False, 'text_sensor/TV Status': 'Active / picture visible', 'text_sensor/Trial Status': 'Trial OFF'})
        timer = threading.Timer(1.5, finish)
        timer.daemon = True
        timer.start()


FIXTURE_HTML = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>UI fixture controls</title><body><h1>Local UI fixture</h1><p>These controls change temporary simulated data only. <a href="/">Open app</a></p><div id="buttons"></div><p id="result" role="status"></p><script>for (const name of ['Normal','Near','Far','Standby','Unknown','Unavailable','PictureOff','Expired','Offline','SettingsFail','SettingsConflict']) {const b=document.createElement('button'); b.textContent=name; b.onclick=async()=>{const r=await fetch('/_fixture/'+name,{method:'POST'}); document.querySelector('#result').textContent=r.ok?'Scenario: '+name:'Failed: '+r.status}; document.querySelector('#buttons').append(b)}</script></body></html>'''


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        # Requests carry no user input worth logging; avoid ever logging credentials.
        pass

    def reply(self, status, body=b'', content_type='text/plain; charset=utf-8'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        fixture = self.server.fixture
        if path == '/':
            return self.reply(200, b'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/0.css"></head><body><esp-app></esp-app><script type="module" src="/0.js"></script></body></html>', 'text/html; charset=utf-8')
        if path == '/_fixture':
            return self.reply(200, FIXTURE_HTML.encode(), 'text/html; charset=utf-8')
        if path in ('/0.js', '/0.css'):
            file = ROOT / 'firmware/ui' / ('app.js' if path == '/0.js' else 'app.css')
            try:
                return self.reply(200, file.read_bytes(), 'text/javascript; charset=utf-8' if path.endswith('.js') else 'text/css; charset=utf-8')
            except FileNotFoundError:
                return self.reply(404)
        if path == '/events':
            return self.events()
        key = unquote(path.lstrip('/'))
        with fixture.lock:
            if fixture.offline:
                return self.reply(503, b'Fixture offline')
            if path == '/settings':
                return self.reply(200, json.dumps(fixture.settings_snapshot()).encode(), 'application/json')
            if key in fixture.states:
                return self.reply(200, json.dumps(fixture.entity(key)).encode(), 'application/json')
        self.reply(404)

    def do_POST(self):
        path = urlsplit(self.path).path
        fixture = self.server.fixture
        if path.startswith('/_fixture/'):
            name = path.removeprefix('/_fixture/')
            if name in ('Normal', 'Near', 'Far', 'Standby', 'Unknown', 'Unavailable', 'PictureOff', 'Expired', 'Offline', 'SettingsFail', 'SettingsConflict'):
                fixture.scenario(name)
                return self.reply(200)
            return self.reply(404)
        with fixture.lock:
            if fixture.offline:
                return self.reply(503, b'Fixture offline')
            if path == '/settings':
                try:
                    length = int(self.headers.get('Content-Length', '-1'))
                    if not 0 <= length <= 4096:
                        raise ValueError('invalid content length')
                    body = json.loads(self.rfile.read(length))
                    code, result = fixture.apply_settings(body)
                except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
                    code, result = 400, {'error': 'invalid'}
                    self.close_connection = True
                return self.reply(code, json.dumps(result).encode(), 'application/json')
            decoded = unquote(path)
            if decoded in ('/switch/TV Trial/turn_on', '/switch/TV Trial/turn_off'):
                fixture.switch(decoded.endswith('/turn_on'))
                return self.reply(200)
            if decoded == '/button/Restore Picture/press':
                fixture.restore()
                return self.reply(200)
        self.reply(404)

    def events(self):
        fixture = self.server.fixture
        with fixture.lock:
            if fixture.offline:
                return self.reply(503, b'Fixture offline')
            client = queue.Queue()
            fixture.clients.add(client)
            initial = [fixture.entity(k, True) for k in fixture.states]
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.close_connection = True
        try:
            for entity in initial:
                self.event('state_detail_all', entity)
            while True:
                try:
                    item = client.get(timeout=10)
                except queue.Empty:
                    with fixture.lock:
                        if fixture.offline:
                            break
                        if fixture.expired:
                            continue
                        item = ('ping', {'uptime': int(time.monotonic() - fixture.started)})
                if item is None:
                    break
                self.event(*item)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with fixture.lock:
                fixture.clients.discard(client)

    def event(self, name, data):
        self.wfile.write(('event: ' + name + '\ndata: ' + json.dumps(data, ensure_ascii=False) + '\n\n').encode())
        self.wfile.flush()


def serve(managed):
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    server.fixture = Fixture()
    address = 'http://127.0.0.1:' + str(server.server_port)
    if managed:
        record = {'pid': os.getpid(), 'created': identity(os.getpid()), 'root': str(ROOT), 'mode': 'fixture', 'address': address, 'log': str(LOG), 'script': str(SCRIPT), 'data': 'in-memory'}
        temp = STATE.with_suffix('.tmp')
        temp.write_text(json.dumps(record, indent=2) + '\n')
        temp.replace(STATE)
    print(address, flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('start', 'status', 'stop', 'serve'))
    parser.add_argument('--managed', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.command == 'serve':
        return serve(args.managed)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    status, record = record_status()
    if args.command == 'status':
        print(json.dumps({'status': status, 'record': record}, ensure_ascii=False, indent=2))
        return 0 if status == 'running' else 1
    if args.command == 'stop':
        if status != 'running':
            print('No verified running fixture; state retained.' if record else 'Already stopped.')
            return 1 if record else 0
        os.kill(record['pid'], signal.SIGTERM)
        for _ in range(50):
            if not matching(record):
                if read_record() == record:
                    STATE.unlink()
                print('Stopped fixture', record['address'])
                return 0
            time.sleep(.1)
        print('Process still present; state retained.', file=sys.stderr)
        return 1
    if status != 'stopped':
        print('Existing record is ' + status + '; inspect it before starting.', file=sys.stderr)
        return 1
    with LOG.open('a') as log:
        child = subprocess.Popen([sys.executable, str(SCRIPT), 'serve', '--managed'], cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
    for _ in range(50):
        time.sleep(.1)
        if child.poll() is not None:
            print('Fixture failed to start; see ' + str(LOG), file=sys.stderr)
            return 1
        status, record = record_status()
        if status == 'running' and record['pid'] == child.pid:
            print(record['address'])
            return 0
    print('Fixture startup unverified; inspect process and log.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main() or 0)
