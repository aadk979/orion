import zxcvbn from 'zxcvbn';;

function isValidEmail(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}

function isPasswordSafe(password) {
    const result = zxcvbn(password);
    return result.score >= 3;
}

export { isValidEmail , isPasswordSafe }