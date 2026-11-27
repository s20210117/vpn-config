"""Validate local ad inputs without accepting wider patterns or IP rules."""

from pathlib import Path
import tempfile
import unittest

from build_merged import domain_payload


class LocalDomainTests(unittest.TestCase):
    def parse(self, text):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "domains.txt"
            path.write_text(text, encoding="utf-8")
            return domain_payload(path)

    def test_preserves_exact_and_suffix_scopes(self):
        self.assertEqual(self.parse("# comment\n\n ads.example.com \n+.banner.example.com\n"),
                         {"ads.example.com", "+.banner.example.com"})

    def test_rejects_wildcards_ip_addresses_rules_and_duplicates(self):
        for text in ("", "# no rules\n", "*.example.com", "ads.example.com/path",
                     "DOMAIN,ads.example.com,REJECT", "ads.Example.com", "192.0.2.1",
                     "+.192.0.2.1", "2001:db8::1", "ads..example.com", "localhost",
                     "ads.example.com\nads.example.com", "a" * 64 + ".example.com"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.parse(text)


if __name__ == "__main__":
    unittest.main()
