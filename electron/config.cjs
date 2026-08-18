/**
 * Shared desktop constants.
 *
 * PORT IS FIXED ON PURPOSE.
 * The local SQLite database lives in OPFS, and OPFS is keyed by ORIGIN.
 * A random port on every launch would produce a new origin and therefore a
 * brand-new (empty) database each time. The desktop app must always serve the
 * built application from exactly the same origin:
 *
 *     http://localhost:43117
 *
 * `localhost` (not 127.0.0.1) is used because:
 *   * it is a secure context, so OPFS / crypto.subtle / service workers work
 *     exactly like in the browser build (file:// is NOT a secure context and
 *     would break the whole local database);
 *   * Google Cloud Console accepts `http://localhost:<port>` as an authorised
 *     JavaScript origin for the Google Drive backup sign-in.
 */
const DESKTOP_HOST = "localhost";
const DESKTOP_PORT = 43117;
const DESKTOP_ORIGIN = `http://${DESKTOP_HOST}:${DESKTOP_PORT}`;

/** Folder name under %APPDATA% that holds the persistent profile (OPFS + SQLite). */
const USER_DATA_DIR = "KhyberDeliciousFoodPOS";

const WINDOW = {
  title: "Khyber Delicious Food POS",
  width: 1440,
  height: 900,
  minWidth: 1024,
  minHeight: 640,
};

module.exports = { DESKTOP_HOST, DESKTOP_PORT, DESKTOP_ORIGIN, USER_DATA_DIR, WINDOW };
