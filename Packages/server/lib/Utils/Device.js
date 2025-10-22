import { UAParser } from 'ua-parser-js';;

function getDeviceDetails(userAgent) {
  return new UAParser(userAgent).getResult();
}

export { getDeviceDetails }