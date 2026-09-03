/**
 * Password validation rules for ZyroFlow
 * 1. Minimum 8 characters
 * 2. At least ONE alphabetic character (A-Z or a-z)
 * 3. At least ONE number (0-9)
 * 4. At least ONE special character (!@#$%^&* etc.)
 */

const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
const PASSWORD_REQUIREMENT_MSG = 'Password must be at least 8 characters and contain at least one letter, one number, and one special character.';

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return {
      valid: false,
      message: PASSWORD_REQUIREMENT_MSG
    };
  }

  const str = String(password);
  if (str.length < 8) {
    return {
      valid: false,
      message: PASSWORD_REQUIREMENT_MSG
    };
  }

  if (!/[A-Za-z]/.test(str)) {
    return {
      valid: false,
      message: PASSWORD_REQUIREMENT_MSG
    };
  }

  if (!/\d/.test(str)) {
    return {
      valid: false,
      message: PASSWORD_REQUIREMENT_MSG
    };
  }

  if (!/[^A-Za-z\d]/.test(str)) {
    return {
      valid: false,
      message: PASSWORD_REQUIREMENT_MSG
    };
  }

  if (!PASSWORD_REGEX.test(str)) {
    return {
      valid: false,
      message: PASSWORD_REQUIREMENT_MSG
    };
  }

  return {
    valid: true,
    message: null
  };
}

module.exports = {
  PASSWORD_REGEX,
  PASSWORD_REQUIREMENT_MSG,
  validatePassword
};
