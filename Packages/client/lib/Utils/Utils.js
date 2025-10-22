import DOMPurify from "../External-Scripts/DOM-purify.js";

function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

function checkPasswordStrength(password) {
  if (password.length < 8) return "Too Short";

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[\W_]/.test(password);

  const score = [hasLower, hasUpper, hasNumber, hasSymbol].filter(
    Boolean
  ).length;

  if (score <= 1) return "Weak";
  if (score === 2 || score === 3) return "Medium";
  return "Strong";
}

function sanitizeInput(input) {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

export { isValidEmail, checkPasswordStrength, sanitizeInput };
