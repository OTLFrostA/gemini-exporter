import json
import socket
import threading
import time
import unittest
from contextlib import contextmanager

from scripts.cdp_client import CDPConnection


@contextmanager
def websocket_server(mode):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        listener.settimeout(2)
        stopped = threading.Event()

        def serve():
            try:
                with listener.accept()[0] as peer:
                    peer.recv(4096)
                    peer.sendall(b"HTTP/1.1 101 Switching Protocols\r\n\r\n")
                    peer.recv(4096)
                    if mode == "reply":
                        payload = json.dumps({"id": 1, "result": {}}).encode()
                        peer.sendall(bytes([0x81, len(payload)]) + payload)
                    elif mode == "fragment":
                        peer.sendall(b"\x81\x20{")
                    elif mode == "reconnect":
                        peer.close()
                        with listener.accept()[0] as replacement:
                            replacement.recv(4096)
                            stopped.wait(0.7)
                        return
                    stopped.wait(0.7)
            except OSError:
                pass

        worker = threading.Thread(target=serve, daemon=True)
        worker.start()
        client = CDPConnection(f"ws://127.0.0.1:{listener.getsockname()[1]}/test")
        try:
            yield client
        finally:
            client.close()
            stopped.set()
            worker.join(3)


class TestCDPDeadline(unittest.TestCase):
    def assert_deadline(self, mode, timeout=0.2):
        with websocket_server(mode) as client:
            start = time.monotonic()
            with self.assertRaises(TimeoutError):
                client.call("Runtime.evaluate", timeout=timeout)
            elapsed = time.monotonic() - start
            print(f"{mode}: timeout={timeout:.3f}s elapsed={elapsed:.3f}s", flush=True)
            self.assertLess(elapsed, timeout + 0.15)

    def test_silent_command(self):
        self.assert_deadline("silent")

    def test_partial_frame(self):
        self.assert_deadline("fragment")

    def test_reconnect_handshake(self):
        self.assert_deadline("reconnect")

    def test_zero_timeout(self):
        self.assert_deadline("silent", timeout=0)

    def test_normal_response(self):
        with websocket_server("reply") as client:
            self.assertEqual(client.call("Browser.getVersion", timeout=0.2),
                             {"id": 1, "result": {}})


if __name__ == "__main__":
    unittest.main()
