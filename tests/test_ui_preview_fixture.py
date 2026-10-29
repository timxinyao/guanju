import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer

from tools.ui_preview import Fixture, Handler


class ManualScheduler:
    def __init__(self):
        self.callbacks = []

    def __call__(self, delay, callback):
        self.callbacks.append((delay, callback))

    def run_all(self):
        for _, callback in sorted(self.callbacks, key=lambda item: item[0]):
            callback()
        self.callbacks.clear()


class FixtureScenariosTest(unittest.TestCase):
    def setUp(self):
        self.scheduler = ManualScheduler()
        self.fixture = Fixture(schedule=self.scheduler)

    def test_transitions_begin_with_confirmed_state_and_end_after_unknown(self):
        for name, initial, final in (
            ('HideTransition', 'Active / picture visible', 'Active / pictureOff'),
            ('RestoreTransition', 'Active / pictureOff', 'Active / picture visible'),
        ):
            with self.subTest(name=name):
                self.fixture.scenario(name)
                self.assertEqual(self.fixture.states['text_sensor/TV Status'], initial)
                callbacks = sorted(self.scheduler.callbacks, key=lambda item: item[0])
                self.assertEqual(callbacks[1][0] - callbacks[0][0], 1.5)
                callbacks[0][1]()
                self.assertEqual(self.fixture.states['text_sensor/TV Status'], 'Unavailable / state expired')
                callbacks[1][1]()
                self.assertEqual(self.fixture.states['text_sensor/TV Status'], final)
                self.scheduler.callbacks.clear()

    def test_previous_transition_callbacks_cannot_override_new_scene(self):
        for name in ('HideTransition', 'RestoreTransition'):
            with self.subTest(name=name):
                self.fixture.scenario(name)
                callbacks = sorted(self.scheduler.callbacks, key=lambda item: item[0])
                callbacks[0][1]()  # Change scenes after the unknown phase starts.
                self.fixture.scenario('Standby')
                self.scheduler.run_all()
                self.assertEqual(self.fixture.states['text_sensor/TV Status'], 'Standby (will not wake)')
                self.assertFalse(self.fixture.states['binary_sensor/Trial Owns Picture Off'])

    def test_long_unknown_and_explicit_failure_are_distinct(self):
        self.fixture.scenario('TVUnknown')
        self.assertFalse(self.fixture.expired)
        self.assertFalse(self.fixture.offline)
        self.assertEqual(self.fixture.states['text_sensor/TV Status'], 'Unavailable / state expired')
        self.assertEqual(self.scheduler.callbacks, [])
        self.fixture.scenario('TVFailure')
        self.assertEqual(self.fixture.states['text_sensor/Trial Status'], 'ON; paused: TV communication failed')
        self.assertFalse(self.fixture.states['binary_sensor/Trial Monitoring'])

    def test_picture_controls_preserve_radar_state(self):
        radar_keys = (
            'binary_sensor/Radar Data Fresh', 'binary_sensor/Radar Measurement Known',
            'binary_sensor/Moving Target', 'binary_sensor/Still Target',
            'sensor/Moving Distance', 'sensor/Still Distance', 'sensor/Detection Distance',
            'text_sensor/Near Zone', 'text_sensor/Scene Presence',
        )
        for start, expected in (('Near', 'Near'), ('Far', 'Far'), ('Normal', 'Absent'),
                                ('Unknown', 'Unknown'), ('Unavailable', 'Unavailable')):
            for action in ('PictureOff', 'HideTransition', 'RestoreTransition'):
                with self.subTest(start=start, action=action):
                    self.fixture.scenario(start)
                    before = {key: self.fixture.states[key] for key in radar_keys}
                    self.assertEqual(before['text_sensor/Scene Presence'], expected)
                    self.fixture.scenario(action)
                    self.assertEqual({key: self.fixture.states[key] for key in radar_keys}, before)
                    for _, callback in sorted(self.scheduler.callbacks, key=lambda item: item[0]):
                        callback()
                        self.assertEqual({key: self.fixture.states[key] for key in radar_keys}, before)
                    self.scheduler.callbacks.clear()
                    self.assertEqual(self.fixture.states['text_sensor/TV Status'],
                                     'Active / picture visible' if action == 'RestoreTransition'
                                     else 'Active / pictureOff')

    def test_normal_can_clear_presence_after_picture_off(self):
        self.fixture.scenario('Near')
        self.fixture.scenario('PictureOff')
        self.fixture.scenario('Normal')
        self.assertEqual(self.fixture.states['text_sensor/Scene Presence'], 'Absent')
        self.assertFalse(self.fixture.states['binary_sensor/Moving Target'])


class ManualClock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class FixtureDiagnosticsTest(unittest.TestCase):
    def setUp(self):
        self.clock = ManualClock()
        self.scheduler = ManualScheduler()
        self.fixture = Fixture(schedule=self.scheduler, clock=self.clock)

    def test_snapshot_has_v1_contract_and_only_valid_target_distances(self):
        self.fixture.scenario('Near')
        snap = self.fixture.diagnostics_snapshot()
        self.assertEqual(set(snap), {
            'schema_version', 'session_id', 'sequence', 'uptime_ms', 'sample_sequence',
            'sample_at_ms', 'config_revision', 'near_threshold_cm', 'release_threshold_cm',
            'zone', 'distance', 'health', 'intent_enabled', 'monitoring', 'reason',
            'tv', 'snooze_remaining_ms', 'external_override', 'recent_events', 'events_dropped',
        })
        self.assertEqual(snap['schema_version'], 1)
        self.assertIsInstance(snap['session_id'], str)
        self.assertEqual(snap['zone'], 'near')
        self.assertEqual(snap['distance'], {'moving_cm': 100, 'still_cm': None,
                                         'moving_valid': True, 'still_valid': False})
        self.assertEqual(snap['near_threshold_cm'], 150)
        self.assertEqual(snap['release_threshold_cm'], 170)
        self.assertEqual(snap['health'], {'wifi_connected': True, 'radar_fresh': True,
                                         'measurement_known': True, 'tv_fresh': True,
                                         'settings_ready': True, 'parameter_audit': 'idle'})
        self.assertEqual(snap['tv'], {'power': 'active', 'mode': 'normal', 'owns_picture_off': False})
        for name, zone in [('Normal', 'absent'), ('Unknown', 'unknown'), ('Unavailable', 'unavailable')]:
            self.fixture.scenario(name)
            # Residual registers must never invent a target in absent/invalid samples.
            self.fixture.states['sensor/Moving Distance'] = 99
            self.fixture.states['sensor/Still Distance'] = 88
            self.clock.advance(1)
            snap = self.fixture.diagnostics_snapshot()
            self.assertEqual(snap['zone'], zone)
            self.assertEqual(snap['distance'], {'moving_cm': None, 'still_cm': None,
                                             'moving_valid': False, 'still_valid': False})

    def test_snapshot_is_cached_for_one_second_and_previous_payload_cannot_be_mutated(self):
        self.fixture.scenario('Near')
        first = self.fixture.diagnostics_snapshot()
        self.fixture.scenario('Far')
        first['distance']['moving_cm'] = 999
        second = self.fixture.diagnostics_snapshot()
        self.assertEqual(second['zone'], 'near')
        self.assertEqual(second['distance']['moving_cm'], 100)
        self.assertEqual(second['sequence'], first['sequence'])
        self.clock.advance(1)
        third = self.fixture.diagnostics_snapshot()
        self.assertEqual(third['zone'], 'far')
        self.assertGreater(third['sequence'], second['sequence'])
        self.assertGreater(third['sample_sequence'], second['sample_sequence'])
        self.assertEqual(third['sample_at_ms'], 1000)

    def test_diagnostic_rate_limit_is_global_and_does_not_block_entity_read(self):
        code, _ = self.fixture.diagnostics_request()
        self.assertEqual(code, 200)
        code, payload = self.fixture.diagnostics_request()
        self.assertEqual((code, payload), (429, {'error': 'rate_limited', 'retry_after_ms': 1000}))
        self.assertEqual(self.fixture.entity('switch/TV Trial')['value'], False)
        self.clock.advance(1)
        self.assertEqual(self.fixture.diagnostics_request()[0], 200)

    def test_expired_samples_keep_timestamp_but_never_show_distance_or_monitoring(self):
        self.fixture.switch(True)
        self.fixture.scenario('Near')
        before = self.fixture.diagnostics_snapshot()
        self.fixture.scenario('Expired')
        self.clock.advance(4)
        snap = self.fixture.diagnostics_snapshot()
        self.assertFalse(snap['health']['radar_fresh'])
        self.assertFalse(snap['health']['tv_fresh'])
        self.assertFalse(snap['monitoring'])
        self.assertEqual(snap['zone'], 'unavailable')
        self.assertIsNone(snap['distance']['moving_cm'])
        self.assertEqual(snap['sample_at_ms'], before['sample_at_ms'])
        self.fixture.scenario('Offline')
        self.assertEqual(self.fixture.diagnostics_request()[0], 503)

    def test_diagnostic_uptime_stays_monotonic_across_millis_wrap(self):
        self.clock.advance(4294967)
        before = self.fixture.diagnostics_snapshot()
        self.clock.advance(2)
        after = self.fixture.diagnostics_snapshot()
        self.assertGreater(after['uptime_ms'], before['uptime_ms'])
        self.assertEqual(after['uptime_ms'], 4294969000)
        self.assertEqual(after['sample_at_ms'], 4294969000)

    def test_recent_events_are_bounded_and_dropped_count_is_reported(self):
        for index in range(20):
            self.fixture.switch(index % 2 == 0)
        snap = self.fixture.diagnostics_snapshot()
        self.assertEqual(len(snap['recent_events']), 12)
        self.assertGreater(snap['events_dropped'], 0)
        sequences = [event['sequence'] for event in snap['recent_events']]
        self.assertEqual(sequences, sorted(set(sequences)))
        self.assertEqual(set(snap['recent_events'][0]), {'sequence', 'at_ms', 'type', 'detail'})
        self.assertLessEqual(len(json.dumps(snap).encode()), 4096)

    def test_pause_preserves_intent_restores_only_owned_picture_and_expires(self):
        self.fixture.switch(True)
        self.fixture.scenario('PictureOff')
        self.fixture.pause(10)
        self.assertTrue(self.fixture.states['switch/TV Trial'])
        self.assertFalse(self.fixture.states['binary_sensor/Trial Monitoring'])
        self.assertFalse(self.fixture.states['binary_sensor/Trial Owns Picture Off'])
        self.assertEqual(self.fixture.states['text_sensor/TV Status'], 'Active / picture visible')
        self.assertEqual(self.fixture.diagnostics_snapshot()['snooze_remaining_ms'], 600000)
        self.clock.advance(600)
        snap = self.fixture.diagnostics_snapshot()
        self.assertEqual(snap['snooze_remaining_ms'], 0)
        self.assertTrue(snap['monitoring'])
        self.fixture.scenario('PictureOff')
        self.fixture.states['binary_sensor/Trial Owns Picture Off'] = False
        self.fixture.pause(30)
        self.assertEqual(self.fixture.states['text_sensor/TV Status'], 'Active / pictureOff')
        self.fixture.resume()
        self.assertTrue(self.fixture.states['switch/TV Trial'])
        self.assertEqual(self.fixture.states['text_sensor/TV Status'], 'Active / pictureOff')

    def test_obsolete_pause_timer_cannot_end_a_new_pause(self):
        self.fixture.switch(True)
        self.fixture.pause(10)
        first_callback = self.scheduler.callbacks[-1][1]
        self.clock.advance(60)
        self.fixture.pause(30)
        self.clock.advance(540)
        first_callback()
        self.assertEqual(self.fixture.diagnostics_snapshot()['snooze_remaining_ms'], 1260000)
        self.assertFalse(self.fixture.states['binary_sensor/Trial Monitoring'])
        self.fixture.switch(False)
        self.clock.advance(1800)
        self.scheduler.run_all()
        self.assertFalse(self.fixture.states['switch/TV Trial'])
        self.assertFalse(self.fixture.states['binary_sensor/Trial Monitoring'])

    def test_pause_or_expiry_never_wakes_standby_and_off_intent_remains_off(self):
        self.fixture.scenario('Standby')
        self.fixture.pause(10)
        self.assertFalse(self.fixture.states['switch/TV Trial'])
        self.fixture.switch(True)
        self.fixture.pause(10)
        self.clock.advance(600)
        snap = self.fixture.diagnostics_snapshot()
        self.assertEqual(snap['tv']['power'], 'standby')
        self.assertFalse(snap['monitoring'])
        self.assertTrue(snap['intent_enabled'])

    def test_resume_does_not_clear_external_override_and_reports_controller_status(self):
        self.fixture.switch(True)
        self.fixture.scenario('PictureOff')
        self.fixture.scenario('ExternalRestore')
        self.assertFalse(self.fixture.states['binary_sensor/Trial Owns Picture Off'])
        self.fixture.pause(10)
        self.assertEqual(self.fixture.states['text_sensor/Trial Status'], 'ON; paused: snoozed')
        self.fixture.resume()
        self.assertTrue(self.fixture.external_override)
        self.assertEqual(self.fixture.states['text_sensor/Trial Status'],
                         'ON; paused: external picture change; waiting for clear zone')
        self.assertFalse(self.fixture.states['binary_sensor/Trial Monitoring'])

    def test_http_diagnostics_and_pause_buttons_match_firmware_routes(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.fixture = self.fixture
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        connection = http.client.HTTPConnection(*server.server_address, timeout=2)
        try:
            connection.request('GET', '/diagnostics')
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read())['schema_version'], 1)
            connection.request('GET', '/diagnostics')
            response = connection.getresponse()
            self.assertEqual(response.status, 429)
            self.assertEqual(response.getheader('Retry-After'), '1')
            self.assertEqual(json.loads(response.read())['retry_after_ms'], 1000)
            self.fixture.switch(True)
            for path, remaining in [('Pause%2010%20Minutes', 600000), ('Pause%2030%20Minutes', 1800000), ('Resume%20Monitoring', 0)]:
                connection.request('POST', '/button/' + path + '/press')
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                response.read()
                self.clock.advance(1)
                self.assertEqual(self.fixture.diagnostics_snapshot()['snooze_remaining_ms'], max(0, remaining - 1000))
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
