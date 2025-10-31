import path from 'path';
import fs from 'fs';

const getSafePath = (filePath, baseDir = "orion-public-non-sensitives") => {
  const normalized = path.normalize(filePath);
  const resolved = path.resolve(`${process.cwd()}\\${baseDir}\\`, normalized);
  
  if (!resolved.startsWith(path.resolve(baseDir))) {
    return { error: true, errorCode: "PATH-TRAVERSAL-ATTEMPT" }
  }
  
  try {
    const realPath = fs.realpathSync.native(resolved);
    return realPath.startsWith(path.resolve(`${process.cwd()}\\${baseDir}\\`)) ? realPath : null;
  } catch(error) {
    return null;
  }
};

const fileExists = (filePath, baseDir = "orion-public-non-sensitives") => {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
};

export { getSafePath, fileExists }