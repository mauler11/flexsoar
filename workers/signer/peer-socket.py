#!/usr/bin/env python3
"""Unix-socket front end. SO_PEERCRED is checked before a request reaches Node."""
import json
import os
import socket
import socketserver
import struct
import subprocess
import sys
import threading

MAX_FRAME = 2 * 1024 * 1024

def read_exact(stream, length):
    chunks = bytearray()
    while len(chunks) < length:
        part = stream.recv(length - len(chunks))
        if not part:
            raise ValueError('truncated frame')
        chunks.extend(part)
    return bytes(chunks)

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            pid, uid, gid = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
            if uid != self.server.allowed_uid:
                return
            size = struct.unpack('>I', read_exact(self.request, 4))[0]
            if size < 2 or size > MAX_FRAME:
                return
            payload = read_exact(self.request, size)
            value = json.loads(payload)
            if not isinstance(value, dict) or value.get('kind') not in ('open-sale-pair', 'buy-sale'):
                response = {'error': 'SIGNER_TYPED_REQUEST_REQUIRED'}
            else:
                with self.server.worker_lock:
                    self.server.worker.stdin.write(payload.decode('utf-8') + '\n')
                    self.server.worker.stdin.flush()
                    response = json.loads(self.server.worker.stdout.readline())
            encoded = json.dumps(response, separators=(',', ':')).encode('utf-8')
            self.request.sendall(struct.pack('>I', len(encoded)) + encoded)
        except Exception:
            # Do not reflect request data, transaction bytes, or key material.
            try:
                encoded = b'{"error":"SIGNER_SOCKET_REQUEST_INVALID"}'
                self.request.sendall(struct.pack('>I', len(encoded)) + encoded)
            except Exception:
                pass

class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    allow_reuse_address = False

def main():
    if not sys.platform.startswith('linux') or not hasattr(socket, 'SO_PEERCRED'):
        raise RuntimeError('SIGNER_PEER_CREDENTIALS_UNAVAILABLE')
    if len(sys.argv) != 6:
        raise RuntimeError('usage: peer-socket.py socket allowed_uid group_gid node worker-script')
    path, uid, gid, node_path, worker_path = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
    if os.path.lexists(path):
        raise RuntimeError('SIGNER_SOCKET_PATH_EXISTS')
    worker = subprocess.Popen([node_path, worker_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr, text=True, bufsize=1, close_fds=True, env=os.environ.copy())
    ready = json.loads(worker.stdout.readline())
    if not isinstance(ready, dict) or ready.get('ready') is not True or ready.get('publicKey') != os.environ.get('ISSUER_SIGNER_EXPECTED_PUBLIC_KEY'):
        worker.terminate()
        raise RuntimeError('SIGNER_STARTUP_KEY_CHECK_FAILED')
    server = Server(path, Handler)
    server.allowed_uid = uid
    server.worker = worker
    server.worker_lock = threading.Lock()
    os.chown(path, os.getuid(), gid)
    os.chmod(path, 0o660)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        worker.terminate()
        worker.wait(timeout=5)
        if os.path.exists(path):
            os.unlink(path)

if __name__ == '__main__':
    main()
