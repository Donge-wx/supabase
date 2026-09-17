import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'scripts/manage.py'
spec = importlib.util.spec_from_file_location('manage', MODULE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class DeploymentTests(unittest.TestCase):
    def test_random_secrets_are_distinct_and_not_printed(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            first = m.new_environment('POSTGRES_PASSWORD=placeholder\n')
            second = m.new_environment('POSTGRES_PASSWORD=placeholder\n')
        self.assertEqual(out.getvalue(), '')
        self.assertNotEqual(m.parse_env(first)['POSTGRES_PASSWORD'], m.parse_env(second)['POSTGRES_PASSWORD'])
        m.validate_environment(first)
        m.validate_environment(second)

    def test_symmetric_jwts_have_correct_roles_and_valid_signatures(self):
        env = m.new_environment('')
        m.validate_environment(env)
        values = m.parse_env(env)
        self.assertNotEqual(values['ANON_KEY'], values['SERVICE_ROLE_KEY'])
        self.assertGreaterEqual(len(values['JWT_SECRET']), 32)

    def test_tampered_jwt_rejected(self):
        env = m.new_environment('')
        bad = m.replace_env(env, {'ANON_KEY': m.parse_env(env)['ANON_KEY'][:-4] + 'xxxx'})
        with self.assertRaises(RuntimeError): m.validate_environment(bad)

    def test_placeholders_and_weak_passwords_rejected(self):
        env = m.new_environment('')
        for value in ['your-super-secret', 'insecure-password', '1234']:
            with self.subTest(value=value):
                with self.assertRaises(RuntimeError):
                    m.validate_environment(m.replace_env(env, {'DASHBOARD_PASSWORD': value}))

    def test_safe_defaults_and_chinese_project_names(self):
        env = m.parse_env(m.new_environment(''))
        self.assertEqual(env['STUDIO_DEFAULT_ORGANIZATION'], '企业数据中心')
        self.assertEqual(env['STUDIO_DEFAULT_PROJECT'], '企业知识与数据')
        self.assertEqual(env['DISABLE_SIGNUP'], 'true')
        self.assertEqual(env['ENABLE_ANONYMOUS_USERS'], 'false')
        self.assertEqual(env['OPENAI_API_KEY'], '')
        self.assertEqual(env['API_EXTERNAL_URL'], 'http://localhost:8000/auth/v1')
        self.assertEqual(len(env['REALTIME_DB_ENC_KEY']), 16)
        self.assertEqual(len(env['VAULT_ENC_KEY']), 32)

    def test_env_update_has_no_duplicate_variables(self):
        updated = m.replace_env('A=one\n# comment\nA=two\nB=stay\n', {'A': 'three', 'C': 'four'})
        self.assertEqual(updated.count('A='), 1)
        self.assertEqual(m.parse_env(updated), {'A': 'three', 'B': 'stay', 'C': 'four'})
        self.assertIn('# comment', updated)

    def test_loopback_compose_configuration_accepted(self):
        m.validate_compose({'services': {
            'studio': {'image': m.LOCK['image']},
            'api-gw': {'ports': [{'host_ip': '127.0.0.1', 'published': '8000', 'target': 8000}]},
        }})

    def test_public_or_unspecified_ports_rejected(self):
        for host in ['0.0.0.0', '::', None, '192.168.1.1']:
            with self.subTest(host=host):
                with self.assertRaises(RuntimeError):
                    m.validate_compose({'services': {'studio': {'image': m.LOCK['image']},
                        'api-gw': {'ports': [{'host_ip': host, 'published': '8000'}]}}})

    def test_unlocalized_image_rejected(self):
        with self.assertRaises(RuntimeError):
            m.validate_compose({'services': {'studio': {'image': 'supabase/studio:latest'}}})

    def test_upstream_release_is_pinned_to_a_commit(self):
        self.assertEqual(m.LOCK['ref'], 'self-hosted/v0.8.1')
        self.assertRegex(m.LOCK['commit'], r'^[0-9a-f]{40}$')
        self.assertEqual(m.LOCK['framework'], 'next')


if __name__ == '__main__': unittest.main()
