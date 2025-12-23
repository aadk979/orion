function slugParser(path) {
    const parts = path.split('/').filter(part => part !== '');
    
    const resultParts = parts.slice(1);
    
    return resultParts.length > 0 ? '/' + resultParts.join('/') : '/';
}

export { slugParser }