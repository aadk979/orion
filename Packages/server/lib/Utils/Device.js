import { UAParser } from 'ua-parser-js';

function getDeviceDetails(userAgent) {
  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  result.device.model = getDescriptiveModel(result);
  
  return result;
}

function getDescriptiveModel(result) {
  const { device, os } = result;
  
  // Mobile device with vendor/model info
  if (device.type === 'mobile' && device.vendor && device.model) {
    return `${device.vendor} ${device.model}`;
  }
  
  // Tablet with vendor/model info
  if (device.type === 'tablet' && device.vendor && device.model) {
    return `${device.vendor} ${device.model}`;
  }
  
  // Desktop/Laptop - use OS as identifier
  if (!device.type) {
    if (os.name === 'Mac OS') return 'Mac Computer';
    if (os.name === 'Windows') return 'Windows PC';
    if (os.name === 'Linux') return 'Linux Computer';
    if (os.name === 'Chrome OS') return 'Chromebook';
    return `${os.name || 'Unknown'} Computer`;
  }
  
  // Fallback for any other device types
  return device.model || 'Unknown Device';
}

export { getDeviceDetails };