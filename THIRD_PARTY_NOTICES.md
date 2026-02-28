Third-Party Notices

This project currently loads one third-party runtime dependency:

- `pako@2.1.0`
  - Upstream: https://github.com/nodeca/pako
  - Delivery: https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js
  - License: permissive upstream licensing (MIT for the package, with upstream notices covering included zlib-derived parts)

Notes:

- The application code in this repository is separate from `pako`.
- Browser APIs used by the app, such as Canvas, Web Workers, and URL APIs, are part of the browser platform and are not third-party code shipped in this repository.
- `run.bat` uses a locally installed Python interpreter only to serve static files during local development.
