import validator from 'validator';;

function sanitizeString(input) {
  let sanitized = validator.escape(input);
  return sanitized;
}

export { sanitizeString }