"""Offline checks for hosted mode: the password guards the app, generated sites stay public and sandboxed."""

import base64
import http.client
import threading
from http.server import ThreadingHTTPServer

import pytest

from voicenav import server
from voicenav.projects import Store

HOST = "voicenav.example.com"


@pytest.fixture
def hosted(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "PUBLIC", f"https://{HOST}")
    monkeypatch.setattr(server, "ORIGIN", f"https://{HOST}")
    monkeypatch.setattr(server, "APP_HOST", HOST)
    monkeypatch.setattr(server, "SITES_HOST", HOST)
    monkeypatch.setattr(server, "STORE", Store(tmp_path))
    monkeypatch.setenv("VOICENAV_PASSWORD", "open sesame")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


def call(port, path, password=None, method="GET", headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Host": HOST, **(headers or {})}
    if password is not None:
        headers["Authorization"] = "Basic " + base64.b64encode(f"judge:{password}".encode()).decode()
    connection.request(method, path, body=b"{}" if method == "POST" else None, headers=headers)
    response = connection.getresponse()
    return response.status, response.getheader("WWW-Authenticate"), response.getheader("Content-Security-Policy"), \
        response.read().decode()


def test_hosted_app_asks_for_the_password(hosted):
    status, challenge, _, _ = call(hosted, "/")
    assert status == 401 and challenge.startswith("Basic")
    assert call(hosted, "/", "wrong")[0] == 401
    status, _, _, page = call(hosted, "/", "open sesame")
    assert status == 200 and server.TOKEN in page
    assert call(hosted, "/", "open sesame", headers={"Host": "elsewhere.example.com"})[0] == 403


def test_hosted_api_needs_token_and_password(hosted):
    token = {"X-Demo-Token": server.TOKEN, "Origin": f"https://{HOST}", "Content-Type": "application/json"}
    assert call(hosted, "/api/studio/list", method="POST", headers=token)[0] == 401
    assert call(hosted, "/api/studio/list", "open sesame", method="POST", headers={"Origin": f"https://{HOST}"})[0] \
        == 403
    status, _, _, body = call(hosted, "/api/studio/list", "open sesame", method="POST", headers=token)
    assert status == 200 and '"projects": []' in body


def test_hosted_sites_are_public_and_sandboxed(hosted):
    project = server.STORE.create("A bakery")
    server.STORE.add_version(project, "<html><body><h1>Fresh bread</h1></body></html>", "First build")
    status, _, policy, page = call(hosted, f"/sites/{project['id']}/v1")
    assert status == 200 and "Fresh bread" in page and "Navigate by voice" in page
    assert policy == server.SANDBOX
