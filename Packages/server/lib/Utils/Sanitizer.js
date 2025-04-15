const validator = require('validator');

function sanitizeString(input) {
  let sanitized = validator.escape(input);
  return sanitized;
}

module.exports = { sanitizeString }