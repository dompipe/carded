/* Card Grader API configuration.
   The web server should reverse-proxy /upload, /crop, /grade, /assess,
   and /report-card to the Python service on 127.0.0.1:8000.
   Keep the browser API same-origin to avoid localhost and HTTPS mixed-content errors.
   If your API is hosted on a separate HTTPS origin, set CARD_GRADER_API to that origin.
*/
window.CARD_GRADER_API = window.CARD_GRADER_API || window.location.origin;
