"""With fwvamp not built (the README's install does not build it), the Vamp list is empty rather than an error, as the
plug-in catalogue is empty when fwhost is not built: every window load asked for it and logged a 503."""


def test_the_vamp_list_is_empty_when_fwvamp_is_not_built(client, tmp_path, monkeypatch):
    monkeypatch.setenv("FORMWAV_FWVAMP", str(tmp_path / "fwvamp-absent"))
    res = client.get("/api/vamp/plugins")
    assert res.status_code == 200 and res.json() == []
    made = client.post("/api/media/nope/vamp", json={"key": "a:b"})
    assert made.status_code in (404, 422)
