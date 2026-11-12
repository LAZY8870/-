import tempfile
import unittest
from pathlib import Path

from qr_web import AssignmentError, build_qr, decode_image, generate_qr, validate_url


class QrWebTests(unittest.TestCase):
    def test_validate_accepts_http_and_https_and_rejects_relative_paths(self):
        self.assertEqual(validate_url("https://example.com/a"), "https://example.com/a")
        self.assertEqual(validate_url("http://192.168.1.5:8000/"), "http://192.168.1.5:8000/")
        with self.assertRaises(AssignmentError):
            validate_url("example.com")

    def test_make_and_decode_round_trip_for_each_error_level(self):
        target = "https://lazy8870.github.io/-/qrcode/"
        with tempfile.TemporaryDirectory() as directory:
            for level in ("L", "M", "Q", "H"):
                with self.subTest(level=level):
                    output = Path(directory) / f"{level}.png"
                    result = generate_qr(target, output, level, 10, 4, None)
                    self.assertTrue(result["verified"])
                    self.assertEqual(result["decoded_content"], target)
                    self.assertEqual(decode_image(output), target)

    def test_labeled_qr_remains_decodable(self):
        target = "https://lazy8870.github.io/-/qrcode/"
        image, stats = build_qr(target, "M", 10, 4, "QR Code assignment")
        self.assertGreater(image.height, image.width)
        self.assertGreater(stats["module_count"], 0)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "labeled.png"
            image.save(output, format="PNG")
            self.assertEqual(decode_image(output), target)


if __name__ == "__main__":
    unittest.main()
