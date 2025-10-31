import zxcvbn from 'zxcvbn';;

function isValidEmail(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}

function isPasswordSafe(password) {
    const result = zxcvbn(password);
    return result.score >= 3;
}

function isValidEmailDomain(validDomains, userEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(userEmail)) {
        return false;
    }
    
    const emailDomain = userEmail.split('@')[1].toLowerCase();
    
    const normalizedValidDomains = validDomains.map(domain => domain.toLowerCase());
    
    return normalizedValidDomains.includes(emailDomain);
}


export { isValidEmail , isPasswordSafe , isValidEmailDomain }