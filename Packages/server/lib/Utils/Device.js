const UAParser = require('ua-parser-js');

function getDeviceDetails(userAgent) {
  return new UAParser(userAgent).getResult();
}

module.exports = { getDeviceDetails }