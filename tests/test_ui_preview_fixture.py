import unittest

from tools.ui_preview import Fixture


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


if __name__ == '__main__':
    unittest.main()
