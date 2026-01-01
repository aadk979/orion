function getRandomElement(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return undefined;

    const index = Math.floor(Math.random() * arr.length);
    return arr[index];
}

function generateNumberedStringsFromTemplate(template, number = 10) {
    const arr = [];

    for (let i = 0; i < number; i++) {
        arr.push(template.replace('<i>', i));
    }

    return arr;
}

export { getRandomElement, generateNumberedStringsFromTemplate };
