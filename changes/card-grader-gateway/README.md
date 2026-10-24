# Card Grader gateway changes

This folder mirrors the small set of files needed for the same-origin gateway patch.

## Contents

- `server.js` — serves the frontend and proxies API calls to the Python service.
- `package.json` — Node start command.
- `config.js` — same-origin API configuration.
- `app.js.patch` — one-line API base URL patch for the existing root `app.js`.

## Apply

These files are also present at the repository root where applicable. Do not replace the existing full `app.js` with the patch file. From the repository root, apply the patch with:

```sh
patch -p1 < changes/card-grader-gateway/app.js.patch
```

Start the gateway with Node 18+:

```sh
CARD_GRADER_PYTHON=http://127.0.0.1:8000 npm start
```

The Python API must be running on the same host and listening on port 8000. Put the Node gateway behind the site's HTTPS/reverse-proxy setup. This bundle does not contain the Python backend or any secrets.
